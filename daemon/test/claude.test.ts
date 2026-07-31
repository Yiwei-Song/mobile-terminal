import { describe, it, expect } from "vitest";
import { ClaudeSession } from "../src/sessions/claude.js";
import type { SessionEvent } from "../src/protocol.js";

// These fakes mirror the real SDK shapes from
// node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts — SDKSystemMessage,
// SDKAssistantMessage, SDKResultSuccess, and the 3-arg CanUseTool. If the SDK
// changes shape, this test is what should break.
const init = { type: "system", subtype: "init", session_id: "s1", uuid: "u0", cwd: "C:\\proj" };
const result = {
  type: "result",
  subtype: "success",
  session_id: "s1",
  uuid: "u9",
  is_error: false,
  total_cost_usd: 0.01,
  result: "ok",
};
const assistant = (content: unknown[]) => ({
  type: "assistant",
  session_id: "s1",
  uuid: "u1",
  parent_tool_use_id: null,
  message: { content },
});
const toolOpts = (requestId: string) => ({
  signal: new AbortController().signal,
  toolUseID: "tu_1",
  requestId,
});

const collector = () => {
  const events: SessionEvent[] = [];
  return { events, onEvent: (e: SessionEvent) => events.push(e) };
};

describe("ClaudeSession", () => {
  it("emits status, text, tool, permission flow, and done", async () => {
    const { events, onEvent } = collector();
    const asked: unknown[] = [];
    let permissionResult: unknown;
    const deps = {
      query: ({ options }: any) =>
        (async function* () {
          yield init;
          permissionResult = await options.canUseTool("Bash", { command: "echo hi" }, toolOpts("req-1"));
          yield assistant([
            { type: "text", text: "done!" },
            { type: "tool_use", id: "tu_1", name: "Read", input: { file_path: "C:\\proj\\a.ts" } },
          ]);
          yield result;
        })(),
    };

    const s = ClaudeSession.start(deps as any, {
      cwd: "C:\\proj",
      prompt: "hi there\nsecond line",
      onEvent,
      askPermission: async (req) => {
        asked.push(req);
        return true;
      },
    });

    expect(await s.id).toBe("s1");
    await s.done;

    // Permission round-tripped to the user, and the SDK got a real allow back.
    expect(asked).toEqual([
      { requestId: "req-1", toolName: "Bash", summary: "Bash: echo hi", cwd: "C:\\proj" },
    ]);
    expect(permissionResult).toEqual({ behavior: "allow", updatedInput: { command: "echo hi" } });

    const kinds = events.map((e) => e.kind);
    expect(kinds).toContain("session.permission");
    expect(kinds).toContain("session.text");
    expect(events).toContainEqual({ kind: "session.status", sessionId: "s1", status: "running", title: "hi there" });
    expect(events).toContainEqual({ kind: "session.text", sessionId: "s1", role: "assistant", text: "done!" });
    expect(events).toContainEqual({
      kind: "session.tool",
      sessionId: "s1",
      name: "Read",
      summary: "Read: C:\\proj\\a.ts",
    });
    expect(events).toContainEqual({ kind: "session.done", sessionId: "s1", ok: true, costUsd: 0.01 });
    expect(events.at(-1)).toMatchObject({ kind: "session.status", status: "idle" });

    // waiting_on_user wraps the permission event, and running is restored after.
    const at = kinds.indexOf("session.permission");
    expect(events[at - 1]).toMatchObject({ kind: "session.status", status: "waiting_on_user" });
    expect(events[at + 1]).toMatchObject({ kind: "session.status", status: "running" });
  });

  it("denies when the user says no", async () => {
    const { onEvent } = collector();
    let permissionResult: any;
    const deps = {
      query: ({ options }: any) =>
        (async function* () {
          yield init;
          permissionResult = await options.canUseTool("Bash", { command: "rm -rf /" }, toolOpts("req-2"));
          yield result;
        })(),
    };
    const s = ClaudeSession.start(deps as any, {
      cwd: "C:\\proj",
      prompt: "hi",
      onEvent,
      askPermission: async () => false,
    });
    await s.done;
    expect(permissionResult.behavior).toBe("deny");
    expect(permissionResult.message).toBeTruthy();
  });

  it("stays waiting_on_user until the last parallel permission is answered", async () => {
    const { events, onEvent } = collector();
    let release!: () => void;
    const held = new Promise<void>((r) => {
      release = r;
    });
    const deps = {
      query: ({ options }: any) =>
        (async function* () {
          yield init;
          const both = Promise.all([
            options.canUseTool("Bash", { command: "a" }, toolOpts("req-a")),
            options.canUseTool("Bash", { command: "b" }, toolOpts("req-b")),
          ]);
          release();
          await both;
          yield result;
        })(),
    };
    let answered = 0;
    const s = ClaudeSession.start(deps as any, {
      cwd: "C:\\proj",
      prompt: "hi",
      onEvent,
      askPermission: async () => {
        // Answer the first only after both have been asked.
        if (++answered === 1) await held;
        return true;
      },
    });
    await s.done;
    const statuses = events.filter((e) => e.kind === "session.status").map((e: any) => e.status);
    expect(statuses).toEqual(["running", "waiting_on_user", "waiting_on_user", "running", "idle"]);
  });

  it("streams follow-up input into the running query and interrupts it", async () => {
    const { onEvent } = collector();
    const sent: any[] = [];
    let interrupted = false;
    const deps = {
      query: ({ prompt }: any) => {
        const gen = (async function* () {
          const it = prompt[Symbol.asyncIterator]();
          yield init;
          sent.push((await it.next()).value); // the initial prompt
          sent.push((await it.next()).value); // whatever send() queues later
          yield result;
        })();
        return Object.assign(gen, {
          interrupt: async () => {
            interrupted = true;
          },
        });
      },
    };
    const s = ClaudeSession.start(deps as any, {
      cwd: "C:\\proj",
      prompt: "first",
      onEvent,
      askPermission: async () => true,
    });
    await s.id;
    s.send("second");
    s.interrupt();
    await s.done;
    expect(sent.map((m) => m.message.content)).toEqual(["first", "second"]);
    expect(sent.every((m) => m.type === "user" && m.message.role === "user")).toBe(true);
    expect(interrupted).toBe(true);
  });

  it("marks the session dead and rejects done when the SDK throws", async () => {
    const { events, onEvent } = collector();
    const boom = new Error("cli exploded");
    const deps = {
      query: () =>
        (async function* () {
          yield init;
          throw boom;
        })(),
    };
    const s = ClaudeSession.start(deps as any, {
      cwd: "C:\\proj",
      prompt: "hi",
      onEvent,
      askPermission: async () => true,
    });
    await expect(s.done).rejects.toThrow("cli exploded");
    expect(events.at(-1)).toMatchObject({ kind: "session.status", status: "dead" });
  });

  it("rejects id when the session ends without ever reporting one", async () => {
    const { onEvent } = collector();
    const deps = { query: () => (async function* () {})() };
    const s = ClaudeSession.start(deps as any, {
      cwd: "C:\\proj",
      prompt: "hi",
      onEvent,
      askPermission: async () => true,
    });
    await s.done;
    await expect(s.id).rejects.toThrow();
  });
});
