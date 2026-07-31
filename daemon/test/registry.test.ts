import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config.js";
import { Manifest } from "../src/sessions/manifest.js";
import { Registry } from "../src/sessions/registry.js";
import type { SessionEvent } from "../src/protocol.js";
import { init, result, tick, toolOpts } from "./fixtures.js";

const setup = (query: unknown) => {
  const events: SessionEvent[] = [];
  const dir = mkdtempSync(join(tmpdir(), "wb-"));
  const manifest = new Manifest(dir);
  const registry = new Registry({ query } as any, manifest, (e) => events.push(e), loadConfig(dir));
  return { registry, manifest, events };
};

// The fake SDK runs on its own microtasks, so assertions wait for the condition
// rather than guessing a tick count.
const until = async (what: string, fn: () => boolean) => {
  for (let i = 0; i < 200 && !fn(); i++) await tick();
  expect(fn(), what).toBe(true);
};

describe("Registry", () => {
  it("routes a permission to the phone and returns sessions.approve to the SDK", async () => {
    let permissionResult: any;
    const { registry, manifest, events } = setup(({ options }: any) =>
      (async function* () {
        yield init;
        permissionResult = await options.canUseTool("Bash", { command: "rm -rf /" }, toolOpts("req-1"));
        yield result;
      })(),
    );

    const started = await registry.handle("sessions.new", { cwd: "C:\\proj", prompt: "do a thing" });
    expect(started).toEqual({ sessionId: "s1" });

    // The prompt reached the phone, and the manifest says who we're waiting on.
    await until("permission pushed", () => events.some((e) => e.kind === "session.permission"));
    expect(events).toContainEqual({
      kind: "session.permission",
      sessionId: "s1",
      requestId: "req-1",
      toolName: "Bash",
      summary: "Bash: rm -rf /",
      cwd: "C:\\proj",
    });
    expect(await registry.handle("sessions.list", {})).toEqual(manifest.list());
    expect(manifest.list()).toMatchObject([
      { sessionId: "s1", agent: "claude", cwd: "C:\\proj", title: "do a thing", status: "waiting_on_user" },
    ]);

    await registry.handle("sessions.approve", { sessionId: "s1", requestId: "req-1", allow: false });
    await until("SDK answered", () => permissionResult !== undefined);
    expect(permissionResult.behavior).toBe("deny");

    // The turn finishing, then the stream ending, both land in the manifest.
    await until("session dead", () => manifest.list()[0]?.status === "dead");
  });

  it("sends to the live session, and restarts a stopped one with resume", async () => {
    const opts: any[] = [];
    const sent: string[] = [];
    let interrupted = false;
    let endTurn!: () => void;
    const firstTurn = new Promise<void>((r) => {
      endTurn = r;
    });
    const { registry, manifest } = setup((o: any) => {
      opts.push(o.options);
      const first = opts.length === 1;
      const gen = (async function* () {
        const input = o.prompt[Symbol.asyncIterator]();
        yield o.options.resume ? { ...init, session_id: o.options.resume } : init;
        sent.push((await input.next()).value.message.content);
        if (first) {
          sent.push((await input.next()).value.message.content);
          await firstTurn;
        }
        yield result;
      })();
      return Object.assign(gen, {
        interrupt: async () => {
          interrupted = true;
        },
      });
    });

    await registry.handle("sessions.new", { cwd: "C:\\proj", prompt: "first" });
    await registry.handle("sessions.send", { sessionId: "s1", text: "second" });
    await until("live send delivered", () => sent.length === 2);
    expect(opts).toHaveLength(1); // reused the running CLI, no restart

    await registry.handle("sessions.interrupt", { sessionId: "s1" });
    expect(interrupted).toBe(true);
    endTurn();
    await until("session dead", () => manifest.list()[0]?.status === "dead");

    // Not live any more: same id, restarted with --resume, text becomes the prompt.
    await registry.handle("sessions.send", { sessionId: "s1", text: "third" });
    await until("resumed send delivered", () => sent.length === 3);
    expect(opts).toHaveLength(2);
    expect(opts[1].resume).toBe("s1");
    expect(opts[1].cwd).toBe("C:\\proj");
    expect(sent).toEqual(["first", "second", "third"]);
    // Still one row under the original title: a resume updates the session it
    // resumed, it does not add a second one or rename it to the new prompt.
    expect(manifest.list()).toMatchObject([{ sessionId: "s1", title: "first" }]);
  });

  it("re-keys the row when a resume comes back under a fresh session id", async () => {
    const ids = ["s1", "s2"];
    const { registry, manifest } = setup((o: any) =>
      (async function* () {
        yield { ...init, session_id: ids.shift()! };
        await o.prompt[Symbol.asyncIterator]().next();
        yield result;
      })(),
    );
    await registry.handle("sessions.new", { cwd: "C:\\proj", prompt: "first" });
    await until("session dead", () => manifest.list()[0]?.status === "dead");

    await registry.handle("sessions.send", { sessionId: "s1", text: "again" });
    // One row, not two: the forked id replaces the one it resumed, so the phone
    // is never offered a session id the CLI has abandoned.
    expect(manifest.list()).toMatchObject([{ sessionId: "s2", title: "first" }]);
  });

  it("throws unknown session for an id in neither the live map nor the manifest", async () => {
    const { registry } = setup(() => (async function* () {})());
    await expect(registry.handle("sessions.send", { sessionId: "nope", text: "hi" })).rejects.toThrow("unknown session");
    await expect(registry.handle("sessions.interrupt", { sessionId: "nope" })).rejects.toThrow("unknown session");
    await expect(
      registry.handle("sessions.approve", { sessionId: "nope", requestId: "r", allow: true }),
    ).rejects.toThrow("unknown session");
  });

  it("writes no manifest row when the session dies before reporting an id", async () => {
    const { registry, manifest, events } = setup(() =>
      (async function* () {
        throw new Error("cli exploded");
      })(),
    );
    await expect(registry.handle("sessions.new", { cwd: "C:\\proj", prompt: "hi" })).rejects.toThrow("cli exploded");
    await tick();
    // The dead event carries an empty sessionId; keying the manifest off it
    // would write a junk row that boot-resume then tries to resume.
    expect(events).toEqual([{ kind: "session.status", sessionId: "", status: "dead", title: "hi" }]);
    expect(manifest.list()).toEqual([]);
  });

  it("keeps two sessions' prompts apart when the CLIs emit the same requestId", async () => {
    const answered: [string, string][] = [];
    const ids = ["s1", "s2"];
    let killFirst!: () => void;
    const firstEnds = new Promise<void>((r) => {
      killFirst = r;
    });
    const { registry, events } = setup((o: any) => {
      const id = ids.shift()!;
      return (async function* () {
        yield { ...init, session_id: id };
        // Separate CLI processes, so their control-request ids can collide.
        void o.options
          .canUseTool("Bash", { command: id }, toolOpts("req-1"))
          .then((r: any) => answered.push([id, r.behavior]));
        // The second session never ends: it must outlive the first's teardown.
        await (id === "s1" ? firstEnds : new Promise<void>(() => {}));
        yield result;
      })();
    });

    await registry.handle("sessions.new", { cwd: "C:\\proj", prompt: "one" });
    await registry.handle("sessions.new", { cwd: "C:\\proj", prompt: "two" });
    await until("both prompts pushed", () => events.filter((e) => e.kind === "session.permission").length === 2);

    killFirst();
    await until("s1 settled by its own teardown", () => answered.length === 1);
    // Only the dead session's prompt was denied — s2's resolver was never
    // overwritten by the colliding key, so it is still outstanding.
    expect(answered).toEqual([["s1", "deny"]]);

    await registry.handle("sessions.approve", { sessionId: "s2", requestId: "req-1", allow: true });
    await until("s2 answered", () => answered.length === 2);
    expect(answered[1]).toEqual(["s2", "allow"]);
  });

  it("denies when allow is not exactly true", async () => {
    let permissionResult: any;
    const { registry, events } = setup(({ options }: any) =>
      (async function* () {
        yield init;
        permissionResult = options.canUseTool("Bash", { command: "a" }, toolOpts("req-1"));
        // Stay alive, so a deny here can only have come from the approve below.
        await new Promise<void>(() => {});
      })(),
    );
    await registry.handle("sessions.new", { cwd: "C:\\proj", prompt: "hi" });
    await until("permission pushed", () => events.some((e) => e.kind === "session.permission"));
    // A truthy non-boolean off the wire must not approve a tool.
    await registry.handle("sessions.approve", { sessionId: "s1", requestId: "req-1", allow: "yes" });
    expect((await permissionResult).behavior).toBe("deny");
  });

  it("passes the sessions.new title through instead of the prompt", async () => {
    const { registry, manifest } = setup(() =>
      (async function* () {
        yield init;
        await new Promise<void>(() => {});
      })(),
    );
    const args = { cwd: "C:\\proj", prompt: "a prompt nobody wants as a title", title: "Deploy" };
    await registry.handle("sessions.new", args);
    expect(manifest.list()).toMatchObject([{ sessionId: "s1", title: "Deploy" }]);
  });

  it("echoes submitted user text so other clients see it", async () => {
    const { registry, events } = setup((o: any) =>
      (async function* () {
        yield init;
        await o.prompt[Symbol.asyncIterator]().next();
        await new Promise<void>(() => {});
      })(),
    );
    const text = (i: number) => events.filter((e) => e.kind === "session.text")[i];

    await registry.handle("sessions.new", { cwd: "C:\\proj", prompt: "first" });
    // Carries the real id: a client keying its transcript by session must be
    // able to file the echo, so it cannot be pushed before `system.init`.
    expect(text(0)).toEqual({ kind: "session.text", sessionId: "s1", role: "user", text: "first" });

    await registry.handle("sessions.send", { sessionId: "s1", text: "second" });
    expect(text(1)).toEqual({ kind: "session.text", sessionId: "s1", role: "user", text: "second" });
    expect(events.filter((e) => e.kind === "session.text")).toHaveLength(2);
  });

  it("echoes a resumed send under the id the resume came back with", async () => {
    const ids = ["s1", "s2"];
    const { registry, events } = setup((o: any) =>
      (async function* () {
        yield { ...init, session_id: ids.shift()! };
        await o.prompt[Symbol.asyncIterator]().next();
        yield result;
      })(),
    );
    await registry.handle("sessions.new", { cwd: "C:\\proj", prompt: "first" });
    await until("session dead", () => events.some((e) => e.kind === "session.status" && e.status === "dead"));

    await registry.handle("sessions.send", { sessionId: "s1", text: "again" });
    // s2, not the s1 the phone asked for: the fork is the session that now owns
    // the text, and the manifest row was re-keyed to match.
    expect(events).toContainEqual({ kind: "session.text", sessionId: "s2", role: "user", text: "again" });
  });

  it("re-delivers outstanding permissions via sessions.pending, and drops them once answered", async () => {
    const { registry, events } = setup(({ options }: any) =>
      (async function* () {
        yield init;
        void options.canUseTool("Bash", { command: "rm -rf /" }, toolOpts("req-1")).catch(() => {});
        await new Promise<void>(() => {});
      })(),
    );

    await registry.handle("sessions.new", { cwd: "C:\\proj", prompt: "hi" });
    await until("permission pushed", () => events.some((e) => e.kind === "session.permission"));
    // The full payload the phone first saw — everything the card needs to redraw
    // after a reconnect that missed the one-shot push.
    expect(await registry.handle("sessions.pending", {})).toEqual([
      { kind: "session.permission", sessionId: "s1", requestId: "req-1", toolName: "Bash", summary: "Bash: rm -rf /", cwd: "C:\\proj" },
    ]);

    await registry.handle("sessions.approve", { sessionId: "s1", requestId: "req-1", allow: true });
    expect(await registry.handle("sessions.pending", {})).toEqual([]);
  });

  it("drops a recovered permission from sessions.pending when the session dies", async () => {
    let kill!: () => void;
    const ended = new Promise<void>((r) => {
      kill = r;
    });
    const { registry, manifest, events } = setup(({ options }: any) =>
      (async function* () {
        yield init;
        void options.canUseTool("Bash", { command: "a" }, toolOpts("req-9")).catch(() => {});
        await ended;
      })(),
    );
    await registry.handle("sessions.new", { cwd: "C:\\proj", prompt: "hi" });
    await until("permission pushed", () => events.some((e) => e.kind === "session.permission"));
    expect((await registry.handle("sessions.pending", {}) as unknown[])).toHaveLength(1);

    kill();
    await until("session dead", () => manifest.list()[0]?.status === "dead");
    // The teardown sweep denied it; it must also leave the recoverable set.
    expect(await registry.handle("sessions.pending", {})).toEqual([]);
  });

  it("fails a permission left outstanding when the session dies", async () => {
    let permissionResult: any;
    const { registry, events } = setup(({ options }: any) =>
      (async function* () {
        yield init;
        // Ask, then let the stream end with the answer still on the phone.
        permissionResult = options.canUseTool("Bash", { command: "a" }, toolOpts("req-9"));
      })(),
    );
    await registry.handle("sessions.new", { cwd: "C:\\proj", prompt: "hi" });
    await until("permission pushed", () => events.some((e) => e.kind === "session.permission"));
    // No approve ever arrives; the dying session must settle its own prompts or
    // the SDK's canUseTool never returns and the resolver leaks forever.
    expect((await permissionResult).behavior).toBe("deny");
  });
});
