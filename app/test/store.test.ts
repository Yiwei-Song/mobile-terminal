import { rmSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, afterEach, beforeEach } from "vitest";

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
    // The key goes with it — an empty array is a session that still renders a
    // (blank) approval area to anything that checks for presence.
    expect(state().pendingApprovals).toEqual({});
    await answered;
    await until("SDK answered", () => answers.length === 1);
    expect(answers).toEqual(["allow"]);

    await until("turn finished", () => (state().transcripts[id] ?? []).some((i) => i.kind === "done"));
    const items = state().transcripts[id]!;
    // The user's own prompt is in the transcript because the daemon echoed it —
    // the store never appends optimistically, so this is the only way it got here.
    // Presence, not position: the echo awaits the CLI's real session id, so the
    // daemon explicitly does not promise it lands before the first assistant
    // event (see daemon/src/sessions/registry.ts, echo()).
    expect(items).toContainEqual(expect.objectContaining({ kind: "text", role: "user", text: "do the thing" }));
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

  it("repopulates a pending approval after a reconnect that missed the push", async () => {
    const { query } = asksOnce();
    const d = await startDaemon(query);
    await online(d.url, d.token);

    const id = await state().newSession("C:\\proj", "do the thing");
    await until("approval raised", () => (state().pendingApprovals[id] ?? []).length === 1);
    const before = state().pendingApprovals[id]![0]!;

    // The phone drops the socket while the daemon still blocks on canUseTool —
    // the notification-then-reopen case. The daemon keeps running on the same port.
    state().disconnect();
    await until("offline after drop", () => state().connState === "offline");
    expect(state().pendingApprovals).toEqual({});

    // Reopen: refreshSessions runs on reconnect and now also pulls sessions.pending.
    await online(d.url, d.token);
    await until("card recovered", () => (state().pendingApprovals[id] ?? []).length === 1);
    const after = state().pendingApprovals[id]![0]!;
    // Same card, intact — everything ApprovalCard needs to redraw.
    expect(after).toEqual(before);
    expect(after).toMatchObject({ toolName: "Bash", summary: "Bash: ls", cwd: "C:\\proj" });

    // And it still answers the SDK, so the round trip is genuinely healed.
    await state().approve(id, after.requestId, true);
    await until("SDK answered", () => (state().transcripts[id] ?? []).some((i) => i.kind === "done"));

    await d.close();
  });

  it("restores the approval when the approve request fails", async () => {
    const { query } = asksOnce();
    const d = await startDaemon(query);
    await online(d.url, d.token);

    const id = await state().newSession("C:\\proj", "do the thing");
    await until("approval raised", () => (state().pendingApprovals[id] ?? []).length === 1);
    const ask = state().pendingApprovals[id]![0]!;

    // Kill the connection the instant before answering: the request rejects.
    await d.close();
    await until("offline", () => state().connState === "offline");
    await expect(state().approve(id, ask.requestId, true)).rejects.toThrow();

    // The daemon is still waiting; the card must come back rather than dead-end.
    expect(state().pendingApprovals[id]).toEqual([ask]);
    expect(state().lastError).toBeTruthy();
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

  // What Home's pull-to-refresh does while offline. Without the nudge a stale
  // list could only recover by waiting out the backoff — the gesture the user
  // reaches for first would do nothing visible.
  it("recovers a stale list when a refresh nudges the connection", async () => {
    const d = await startDaemon(idle());
    // Long enough that only the explicit nudge can reconnect inside this test.
    state().connect(d.url, d.token, { baseDelayMs: 60_000 });
    await until("online", () => state().connState === "online");
    await state().newSession("C:\\proj", "before the nap");
    expect(state().sessions).toHaveLength(1);

    await d.close();
    await until("offline", () => state().connState === "offline");
    // Deleted while we cannot see it: a stale render and a real re-list differ.
    rmSync(join(d.dir, "sessions.json"));
    const again = await startDaemon(idle(), { dir: d.dir, port: d.port });

    state().connect(d.url, d.token, { baseDelayMs: 60_000 });
    await state().refreshSessions(true).catch(() => {});

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

  it("forgets the transcript and approvals of a session the daemon no longer lists", async () => {
    const { query } = asksOnce();
    const d = await startDaemon(query);
    await online(d.url, d.token);

    const id = await state().newSession("C:\\proj", "do the thing");
    await until("approval raised", () => (state().pendingApprovals[id] ?? []).length === 1);
    expect(state().transcripts[id]).toBeTruthy();

    // The session is deleted on the laptop while the phone holds its transcript.
    await d.close();
    await until("offline", () => state().connState === "offline");
    rmSync(join(d.dir, "sessions.json"));
    const again = await startDaemon(idle(), { dir: d.dir, port: d.port });
    await until("re-listed", () => state().connState === "online" && state().sessions.length === 0);

    // Left behind, these grow for the life of the app and would repopulate a
    // detail screen for a session that no longer exists.
    expect(state().transcripts).toEqual({});
    expect(state().pendingApprovals).toEqual({});

    await again.close();
  });

  // Home calls connect() on every focus. Counting sockets is how "it did not
  // tear the live one down" becomes observable — same Proxy trap the pairing
  // tests use.
  describe("connect", () => {
    const RealWS = globalThis.WebSocket;
    let opened = 0;

    beforeEach(() => {
      opened = 0;
      globalThis.WebSocket = new Proxy(RealWS, {
        construct: (t, a) => {
          opened++;
          return Reflect.construct(t, a) as object;
        },
      });
    });
    afterEach(() => {
      globalThis.WebSocket = RealWS;
    });

    it("is a no-op for the pairing it is already on, and a rebuild for a new one", async () => {
      const d = await startDaemon(idle());
      await online(d.url, d.token);
      await state().newSession("C:\\proj", "on the first machine");
      expect(opened).toBe(1);

      // The screen re-focuses twice: no new socket, and the session list — which
      // disconnect() would have emptied — is still there.
      state().connect(d.url, d.token, { baseDelayMs: 10 });
      state().connect(d.url, d.token, { baseDelayMs: 10 });
      expect(opened).toBe(1);
      expect(state().connState).toBe("online");
      expect(state().sessions).toHaveLength(1);

      // Re-paired to a different daemon: the old connection must not survive it.
      const e = await startDaemon(idle());
      state().connect(e.url, e.token, { baseDelayMs: 10 });
      await until("online on the new machine", () => state().connState === "online");
      await until("listed the new machine's sessions", () => state().sessions.length === 0);
      expect(opened).toBe(2);

      await d.close();
      await e.close();
    });
  });

  it("keeps the reason a user-initiated action failed", async () => {
    const d = await startDaemon(idle());
    await online(d.url, d.token);
    expect(state().lastError).toBeNull();

    await d.close();
    await until("offline", () => state().connState === "offline");

    await expect(state().send("s1", "hi")).rejects.toThrow();
    expect(state().lastError).toContain("offline");
    // A pull-to-refresh reports; the automatic re-list on reconnect does not.
    useWorkbench.setState({ lastError: null });
    await expect(state().refreshSessions(true)).rejects.toThrow();
    expect(state().lastError).toContain("offline");

    const again = await startDaemon(idle(), { dir: d.dir, port: d.port });
    await until("back online", () => state().connState === "online");
    await state().newSession("C:\\proj", "works now");
    expect(state().lastError).toBeNull();

    await again.close();
  });

  // What deep-linking to /files while the socket is still coming up does: the
  // first read rejects, the screen swallows it, and nothing but a second read on
  // connState=online can fill the list — the effect files.tsx now has.
  it("re-reads the file roots after one failed while offline", async () => {
    const d = await startDaemon(idle());
    await online(d.url, d.token);
    // A session's cwd is a root, so the daemon has one to answer with.
    await state().newSession("C:\\proj", "gives the tree a root");
    await state().refreshRoots();
    const roots = state().roots;
    expect(roots).toHaveLength(1);

    await d.close();
    await until("offline", () => state().connState === "offline");
    // The screen mounted with nothing — this is the empty state the bug stuck on.
    useWorkbench.setState({ roots: [] });
    await expect(state().refreshRoots()).rejects.toThrow();
    expect(state().roots).toEqual([]);

    const again = await startDaemon(idle(), { dir: d.dir, port: d.port });
    await until("back online", () => state().connState === "online");
    await state().refreshRoots();
    expect(state().roots).toEqual(roots);

    await again.close();
  });

  // The bytes never come here — the WebView holds its own socket — so what the
  // store owns is exactly the list the terminal screen renders.
  describe("terminals", () => {
    it("creates, lists and kills against the real daemon", async () => {
      const d = await startDaemon(idle());
      await online(d.url, d.token);

      await state().refreshTerminals();
      expect(state().terminals).toEqual([]);

      const t = await state().createTerminal("C:\\proj");
      // Optimistic append: the screen navigates into it on the next line.
      expect(state().terminals).toEqual([t]);
      expect(t.cwd).toBe("C:\\proj");

      // …and the daemon really has it, not just this store.
      state().disconnect();
      await online(d.url, d.token);
      await state().refreshTerminals();
      expect(state().terminals.map((x) => x.termId)).toEqual([t.termId]);

      // The row goes on the kill, not on the term.exit push: that event belongs
      // to the WebView's socket and this store deliberately ignores it. (The
      // daemon only drops its own entry when the pty really exits, which a fake
      // pty never does — so the list here is the store's, and that is the one
      // the screen renders.)
      await state().killTerminal(t.termId);
      expect(state().terminals).toEqual([]);

      await d.close();
    });

    it("reports a failed create and leaves the list alone", async () => {
      const d = await startDaemon(idle());
      await online(d.url, d.token);
      await d.close();
      await until("offline", () => state().connState === "offline");

      await expect(state().createTerminal("C:\\proj")).rejects.toThrow();
      expect(state().lastError).toContain("offline");
      expect(state().terminals).toEqual([]);
      // The refresh rejects rather than blanking the list on a blip; the screen
      // is the one that swallows it (no banner for an automatic read).
      await expect(state().refreshTerminals()).rejects.toThrow();
      expect(state().terminals).toEqual([]);
    });
  });
});
