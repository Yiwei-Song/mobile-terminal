import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import { loadConfig } from "../src/config.js";
import { startServer } from "../src/server.js";
import type { PushEvent, TermInfo } from "../src/protocol.js";
import { Manifest } from "../src/sessions/manifest.js";
import { Registry } from "../src/sessions/registry.js";
import { fakeMachine } from "./fixtures.js";

// A real server + a real registry + a real PtyManager over a fake pty: the only
// thing that isn't production here is the shell. No test in this file may spawn
// one — term.test.ts already proves the native binding.
async function harness() {
  const dir = mkdtempSync(join(tmpdir(), "wb-"));
  const cfg = { ...loadConfig(dir), port: 0 };
  const fake = fakeMachine();
  // Same wiring as index.ts: one push ref, filled in by the server, fed by both
  // the registry and the pty manager's two callbacks.
  let pushRef: (e: PushEvent) => void = () => {};
  fake.onTerm.data = (termId, data) => pushRef({ kind: "term.data", termId, data });
  fake.onTerm.exit = (termId, code) => pushRef({ kind: "term.exit", termId, code });
  const registry = new Registry(
    { query: () => (async function* () {})() } as any,
    new Manifest(dir),
    (e) => pushRef(e),
    cfg,
    fake.machine,
  );
  const srv = await startServer(cfg, (method, params, push) => {
    pushRef = push;
    return registry.handle(method, params);
  });

  const ws = new WebSocket(`ws://127.0.0.1:${srv.port}/ws`);
  const pending = new Map<string, (m: any) => void>();
  const events: any[] = [];
  const watchers = new Set<() => void>();
  let seq = 0;
  const authed = new Promise<void>((resolve) => {
    ws.on("message", (d) => {
      const m = JSON.parse(d.toString());
      if (m.type === "auth.ok") return resolve();
      if (m.type === "res") return pending.get(m.id)?.(m);
      if (m.type === "event") {
        events.push(m.event);
        for (const w of [...watchers]) w();
      }
    });
  });
  await new Promise((r) => ws.once("open", r));
  ws.send(JSON.stringify({ type: "auth", token: cfg.token }));
  await authed;

  return {
    events,
    // Correlated by id: term.data events interleave with responses, so "the
    // next frame" is not an answer to anything in particular.
    call: (method: string, params?: unknown): Promise<any> =>
      new Promise((resolve) => {
        const id = String(++seq);
        pending.set(id, resolve);
        ws.send(JSON.stringify({ type: "req", id, method, params }));
      }),
    send: (raw: unknown) => ws.send(JSON.stringify(raw)),
    fake,
    waitEvent: (pred: (e: any) => boolean, ms = 1000): Promise<any> =>
      new Promise((resolve, reject) => {
        const check = () => {
          const hit = events.find(pred);
          if (!hit) return;
          watchers.delete(check);
          clearTimeout(timer);
          resolve(hit);
        };
        const timer = setTimeout(() => {
          watchers.delete(check);
          reject(new Error("no matching event"));
        }, ms);
        watchers.add(check);
        check();
      }),
    close: async () => {
      ws.close();
      await srv.close();
    },
  };
}

const CREATE = { cwd: "C:\\work", cols: 80, rows: 24 };

describe("term RPCs over the wire", () => {
  it("create -> list -> write -> resize -> scrollback -> kill", async () => {
    const h = await harness();

    expect((await h.call("term.list")).data).toEqual([]);

    const info: TermInfo = (await h.call("term.create", CREATE)).data;
    expect(info).toMatchObject({ cwd: "C:\\work", cols: 80, rows: 24 });
    expect(info.termId).toMatch(/^[0-9a-f-]{36}$/);
    expect(h.fake.ptyFake.spawns).toHaveLength(1);

    expect((await h.call("term.list")).data).toEqual([info]);

    expect(await h.call("term.write", { termId: info.termId, data: "dir\r" })).toMatchObject({ ok: true });
    expect(h.fake.ptyFake.children[0].write).toHaveBeenCalledWith("dir\r");

    await h.call("term.resize", { termId: info.termId, cols: 100, rows: 30 });
    expect(h.fake.ptyFake.children[0].resize).toHaveBeenCalledWith(100, 30);
    expect((await h.call("term.list")).data[0]).toMatchObject({ cols: 100, rows: 30 });

    // Scrollback is whatever the pty has printed so far, replayed on attach.
    h.fake.ptyFake.children[0].emit("C:\\work> ");
    expect((await h.call("term.scrollback", { termId: info.termId })).data).toEqual({ data: "C:\\work> " });

    await h.call("term.kill", { termId: info.termId });
    expect(h.fake.ptyFake.children[0].kill).toHaveBeenCalledOnce();
    // Removal waits for the pty's own exit, not the kill call.
    expect((await h.call("term.list")).data).toHaveLength(1);
    h.fake.ptyFake.children[0].fireExit(0);
    expect((await h.call("term.list")).data).toEqual([]);

    await h.close();
  });

  it("pushes term.data for pty output and term.exit when it dies", async () => {
    const h = await harness();
    const { termId } = (await h.call("term.create", CREATE)).data as TermInfo;

    h.fake.ptyFake.children[0].emit("hello\r\n");
    expect(await h.waitEvent((e) => e.kind === "term.data")).toEqual({ kind: "term.data", termId, data: "hello\r\n" });

    h.fake.ptyFake.children[0].fireExit(3);
    expect(await h.waitEvent((e) => e.kind === "term.exit")).toEqual({ kind: "term.exit", termId, code: 3 });

    await h.close();
  });

  it("answers unknown termIds instead of erroring (ids come off the wire)", async () => {
    const h = await harness();
    // A client can race a terminal that just exited; every one of these is a
    // no-op on the manager, so none of them may fail the request.
    expect(await h.call("term.write", { termId: "gone", data: "x" })).toMatchObject({ ok: true });
    expect(await h.call("term.resize", { termId: "gone", cols: 10, rows: 10 })).toMatchObject({ ok: true });
    expect(await h.call("term.kill", { termId: "gone" })).toMatchObject({ ok: true });
    expect((await h.call("term.scrollback", { termId: "gone" })).data).toEqual({ data: "" });
    await h.close();
  });

  it("drops malformed term requests without answering them", async () => {
    const h = await harness();
    // Invalid params never reach the registry — parseClientMsg refuses them and
    // the server drops the frame. Prove nothing was spawned and the socket is
    // still usable for the next (valid) request.
    h.send({ type: "req", id: "bad1", method: "term.create", params: { cwd: "C:\\x", cols: 0, rows: 24 } });
    h.send({ type: "req", id: "bad2", method: "term.write", params: { data: "x" } });
    expect((await h.call("term.list")).data).toEqual([]);
    expect(h.fake.ptyFake.spawns).toHaveLength(0);
    await h.close();
  });
});
