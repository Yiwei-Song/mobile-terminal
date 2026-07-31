import { describe, it, expect } from "vitest";
import { ClaudeSession } from "../src/sessions/claude.js";
import type { SessionEvent } from "../src/protocol.js";
import { assistant, init, result, tick, toolOpts } from "./fixtures.js";

const collector = () => {
  const events: SessionEvent[] = [];
  return { events, onEvent: (e: SessionEvent) => events.push(e) };
};

describe("ClaudeSession", () => {
  it("emits status, text, tool, permission flow, and done", async () => {
    const { events, onEvent } = collector();
    const asked: unknown[] = [];
    let permissionResult: unknown;
    let passed: any;
    const deps = {
      query: ({ options }: any) => {
        passed = options;
        return (async function* () {
          yield init;
          permissionResult = await options.canUseTool("Bash", { command: "echo hi" }, toolOpts("req-1"));
          yield assistant([
            { type: "text", text: "done!", citations: null },
            { type: "tool_use", id: "tu_1", name: "Read", input: { file_path: "C:\\proj\\a.ts" } },
          ]);
          yield result;
        })();
      },
    };

    const s = ClaudeSession.start(deps as any, {
      cwd: "C:\\proj",
      prompt: "hi there\r\nsecond line",
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
    // The turn ends idle; the stream ending afterwards means the CLI is gone.
    expect(events.at(-2)).toMatchObject({ kind: "session.status", status: "idle" });
    expect(events.at(-1)).toMatchObject({ kind: "session.status", status: "dead" });

    // waiting_on_user wraps the permission event, and running is restored after.
    const at = kinds.indexOf("session.permission");
    expect(events[at - 1]).toMatchObject({ kind: "session.status", status: "waiting_on_user" });
    expect(events[at + 1]).toMatchObject({ kind: "session.status", status: "running" });

    // The daemon adds no settings bypass: default settings sources apply.
    expect(passed.settingSources).toBeUndefined();
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
    expect(statuses).toEqual(["running", "waiting_on_user", "waiting_on_user", "running", "idle", "dead"]);
  });

  it("never reports running after the session is dead", async () => {
    const { events, onEvent } = collector();
    let answer!: (allow: boolean) => void;
    const deps = {
      query: ({ options }: any) =>
        (async function* () {
          yield init;
          // Ask, then let the stream end with the permission still outstanding.
          void options.canUseTool("Bash", { command: "a" }, toolOpts("req-x"));
        })(),
    };
    const s = ClaudeSession.start(deps as any, {
      cwd: "C:\\proj",
      prompt: "hi",
      onEvent,
      askPermission: () =>
        new Promise<boolean>((r) => {
          answer = r;
        }),
    });
    await s.done;
    answer(true); // the phone answers after the CLI is already gone
    await tick();

    const statuses = events.filter((e) => e.kind === "session.status").map((e: any) => e.status);
    expect(statuses).toEqual(["running", "waiting_on_user", "dead"]);
  });

  it("treats a rejected permission prompt as a deny", async () => {
    const { onEvent } = collector();
    let permissionResult: any;
    const deps = {
      query: ({ options }: any) =>
        (async function* () {
          yield init;
          permissionResult = await options.canUseTool("Bash", { command: "a" }, toolOpts("req-z"));
          yield result;
        })(),
    };
    const s = ClaudeSession.start(deps as any, {
      cwd: "C:\\proj",
      prompt: "hi",
      onEvent,
      askPermission: async () => {
        throw new Error("phone disconnected");
      },
    });
    await s.done;
    expect(permissionResult.behavior).toBe("deny");
  });

  it("streams follow-up input into the running query and interrupts it", async () => {
    const { onEvent } = collector();
    const sent: any[] = [];
    let interrupted = false;
    let queryClosed = false;
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
          close: () => {
            queryClosed = true;
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
    // Keyboard input must be stamped as human or it fails closed at trust gates.
    expect(sent.every((m) => m.origin?.kind === "human")).toBe(true);
    expect(interrupted).toBe(true);

    // close() must tear the subprocess down, not just end stdin.
    s.close();
    expect(queryClosed).toBe(true);
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

  it("rejects id and reports dead when the session ends without ever reporting one", async () => {
    const { events, onEvent } = collector();
    const deps = { query: () => (async function* () {})() };
    const s = ClaudeSession.start(deps as any, {
      cwd: "C:\\proj",
      prompt: "hi",
      onEvent,
      askPermission: async () => true,
    });
    await s.done;
    await expect(s.id).rejects.toThrow();
    // A silent stream end must still produce a terminal status, or the manifest
    // shows the session as running forever.
    expect(events).toEqual([{ kind: "session.status", sessionId: "", status: "dead", title: "hi" }]);
  });
});
