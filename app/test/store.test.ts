import { rmSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, afterEach } from "vitest";

import { useWorkbench } from "../src/lib/store";
import { startDaemon, until, idle, type FakeQuery } from "./harness";
import { assistant, init, result, toolOpts } from "../../daemon/test/fixtures.js";

// The store is driven end to end by a real daemon: a fake client would only
// prove the store agrees with itself about the shape of an event.

const state = () => useWorkbench.getState();
const online = async (url: string, token: string) => {
  state().connect(url, token, { baseDelayMs: 10 });
  await until("online", () => state().connState === "online");
};

// A CLI that asks for one tool and then reports a successful turn.
const asksOnce = () => {
  const answers: string[] = [];
  const query: FakeQuery = ({ options }) =>
    (async function* () {
      yield init;
      answers.push((await options.canUseTool("Bash", { command: "ls" }, toolOpts("req-1"))).behavior);
      yield assistant([{ type: "text", text: "all done", citations: null }]);
      yield result;
    })();
  return { query, answers };
};

afterEach(() => state().disconnect());

describe("workbench store", () => {
  it("lists sessions and reads the machine's identity on connect", async () => {
    const d = await startDaemon(idle());
    await online(d.url, d.token);

    expect(state().sessions).toEqual([]);
    await until("machine", () => state().machine !== null);
    expect(state().machine?.hostname).toBeTruthy();
    expect(state().machine?.version).toBeTruthy();

    const id = await state().newSession("C:\\proj", "first thing\nsecond line");
    expect(id).toBe("s1");
    expect(state().sessions).toMatchObject([{ sessionId: "s1", cwd: "C:\\proj", title: "first thing", status: "running" }]);

    await d.close();
  });

  it("carries a permission to the user and an allow back into the SDK", async () => {
    const { query, answers } = asksOnce();
    const d = await startDaemon(query);
    await online(d.url, d.token);

    const id = await state().newSession("C:\\proj", "do the thing");
    await until("approval raised", () => (state().pendingApprovals[id] ?? []).length === 1);
    const ask = state().pendingApprovals[id]![0]!;
    expect(ask).toMatchObject({ toolName: "Bash", summary: "Bash: ls", cwd: "C:\\proj" });
    expect(state().sessions[0]!.status).toBe("waiting_on_user");

    const answered = state().approve(id, ask.requestId, true);
    // Not awaited: the card goes the moment the thumb lands, not a round-trip later.
    expect(state().pendingApprovals[id]).toEqual([]);
    await answered;
    await until("SDK answered", () => answers.length === 1);
    expect(answers).toEqual(["allow"]);

    await until("turn finished", () => (state().transcripts[id] ?? []).some((i) => i.kind === "done"));
    const items = state().transcripts[id]!;
    // The user's own prompt is in the transcript because the daemon echoed it —
    // the store never appends optimistically, so this is the only way it got here.
    expect(items[0]).toMatchObject({ kind: "text", role: "user", text: "do the thing" });
    expect(items).toContainEqual(expect.objectContaining({ kind: "text", role: "assistant", text: "all done" }));
    expect(items.at(-1)).toMatchObject({ kind: "done", ok: true, costUsd: 0.01 });

    await d.close();
  });

  it("carries a deny back into the SDK", async () => {
    const { query, answers } = asksOnce();
    const d = await startDaemon(query);
    await online(d.url, d.token);

    const id = await state().newSession("C:\\proj", "risky");
    await until("approval raised", () => (state().pendingApprovals[id] ?? []).length === 1);
    await state().approve(id, state().pendingApprovals[id]![0]!.requestId, false);

    await until("SDK answered", () => answers.length === 1);
    expect(answers).toEqual(["deny"]);

    await d.close();
  });

  it("drops outstanding approvals when the session dies", async () => {
    let kill!: () => void;
    const ended = new Promise<void>((r) => {
      kill = r;
    });
    const query: FakeQuery = ({ options }) =>
      (async function* () {
        yield init;
        // Never awaited: the stream is going to end with the answer still on the
        // phone, which is exactly what the daemon denies server-side.
        void options.canUseTool("Bash", { command: "rm -rf /" }, toolOpts("req-9")).catch(() => {});
        await ended;
      })();

    const d = await startDaemon(query);
    await online(d.url, d.token);
    const id = await state().newSession("C:\\proj", "risky");
    await until("approval raised", () => (state().pendingApprovals[id] ?? []).length === 1);

    kill();
    await until("session dead", () => state().sessions[0]?.status === "dead");
    // Leaving the card up would offer buttons that answer nothing.
    expect(state().pendingApprovals[id] ?? []).toEqual([]);

    await d.close();
  });

  it("re-sorts attention-first when a status event arrives", async () => {
    let ask!: () => void;
    const asked = new Promise<void>((r) => {
      ask = r;
    });
    let n = 0;
    const query: FakeQuery = ({ options }) => {
      const id = `s${++n}`;
      return (async function* () {
        yield { ...init, session_id: id };
        if (id === "s2") {
          await asked;
          void options.canUseTool("Bash", { command: "x" }, toolOpts("req-2")).catch(() => {});
        }
        await new Promise<void>(() => {});
      })();
    };

    const d = await startDaemon(query);
    await online(d.url, d.token);
    await state().newSession("C:\\proj", "one");
    await state().newSession("C:\\proj", "two");
    // Both running: the server's own order, untouched.
    expect(state().sessions.map((s) => s.sessionId)).toEqual(["s1", "s2"]);

    ask();
    // No sessions.list in between — the reorder comes from the status event alone.
    await until("s2 needs the user", () => state().sessions[0]?.sessionId === "s2");
    expect(state().sessions.map((s) => s.status)).toEqual(["waiting_on_user", "running"]);

    await d.close();
  });

  it("re-lists after the daemon restarts on the same port", async () => {
    const d = await startDaemon(idle());
    await online(d.url, d.token);
    await state().newSession("C:\\proj", "before the nap");
    expect(state().sessions).toHaveLength(1);

    await d.close();
    await until("offline", () => state().connState === "offline");
    // The row is deleted while we cannot see it, so a stale render and a genuine
    // re-list are not the same answer. config.json — and the token — stay put.
    rmSync(join(d.dir, "sessions.json"));

    const again = await startDaemon(idle(), { dir: d.dir, port: d.port });
    await until("back online", () => state().connState === "online");
    await until("re-listed", () => state().sessions.length === 0);

    await again.close();
  });

  it("refuses to act while offline", async () => {
    const d = await startDaemon(idle());
    await online(d.url, d.token);
    await d.close();
    await until("offline", () => state().connState === "offline");

    await expect(state().send("s1", "hi")).rejects.toThrow("offline");
    await expect(state().interrupt("s1")).rejects.toThrow("offline");
    await expect(state().newSession("C:\\proj", "nope")).rejects.toThrow("offline");
  });
});
