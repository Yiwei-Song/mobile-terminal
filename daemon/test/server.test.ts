import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import { loadConfig } from "../src/config.js";
import { startServer } from "../src/server.js";
import { VERSION } from "../src/version.js";
import { Manifest } from "../src/sessions/manifest.js";
import { Registry } from "../src/sessions/registry.js";

const open = (port: number) => new WebSocket(`ws://127.0.0.1:${port}/ws`);
// ws answers pings for you unless you ask it not to — the one supported way to
// simulate a phone whose radio died without also faking the socket.
const openDeaf = (port: number) => new WebSocket(`ws://127.0.0.1:${port}/ws`, { autoPong: false });
const next = (ws: WebSocket) => new Promise<any>(r => ws.once("message", d => r(JSON.parse(d.toString()))));
const closed = (ws: WebSocket) => new Promise<number>(r => ws.once("close", c => r(c)));
const opened = (ws: WebSocket) => new Promise(r => ws.once("open", r));
const cfgFor = () => ({ ...loadConfig(mkdtempSync(join(tmpdir(), "wb-"))), port: 0 });

describe("server", () => {
  it("rejects bad token with 4001, accepts good token, routes requests", async () => {
    const cfg = cfgFor();
    const srv = await startServer(cfg, async (method) => {
      if (method === "sessions.list") return ["stub"];
      throw new Error("unknown");
    });

    const bad = open(srv.port);
    await opened(bad);
    bad.send(JSON.stringify({ type: "auth", token: "wrong" }));
    expect(await closed(bad)).toBe(4001);

    const good = open(srv.port);
    await opened(good);
    good.send(JSON.stringify({ type: "auth", token: cfg.token }));
    expect((await next(good)).type).toBe("auth.ok");
    good.send(JSON.stringify({ type: "req", id: "7", method: "sessions.list" }));
    expect(await next(good)).toEqual({ type: "res", id: "7", ok: true, data: ["stub"] });
    good.close();
    await srv.close();
  });

  it("closes 4001 when the first message is not auth, and on a missing token", async () => {
    const srv = await startServer(cfgFor(), async () => "never");

    const jumper = open(srv.port);
    await opened(jumper);
    jumper.send(JSON.stringify({ type: "req", id: "1", method: "sessions.list" }));
    expect(await closed(jumper)).toBe(4001);

    const empty = open(srv.port);
    await opened(empty);
    empty.send(JSON.stringify({ type: "auth" }));
    expect(await closed(empty)).toBe(4001);

    await srv.close();
  });

  it("closes 4001 on a malformed first frame instead of throwing", async () => {
    const srv = await startServer(cfgFor(), async () => "never");

    const garbage = open(srv.port);
    await opened(garbage);
    garbage.send("not json");
    expect(await closed(garbage)).toBe(4001);

    await srv.close();
  });

  it("reports handler errors and broadcasts pushed events to authed sockets", async () => {
    const cfg = cfgFor();
    const srv = await startServer(cfg, async (method, _params, push) => {
      if (method === "sessions.interrupt") {
        push({ kind: "session.done", sessionId: "s1", ok: true, costUsd: null });
        return null;
      }
      throw new Error("boom");
    });

    const a = open(srv.port), b = open(srv.port);
    // Listen on both up front: awaiting them in sequence would miss the second
    // socket's "open", which fires while the first handshake is in flight.
    const ready = [a, b].map(async ws => {
      await opened(ws);
      ws.send(JSON.stringify({ type: "auth", token: cfg.token }));
      return next(ws);
    });
    await Promise.all(ready);

    a.send(JSON.stringify({ type: "req", id: "1", method: "sessions.list" }));
    expect(await next(a)).toEqual({ type: "res", id: "1", ok: false, error: "boom" });

    const onB = next(b);
    a.send(JSON.stringify({ type: "req", id: "2", method: "sessions.interrupt", params: { sessionId: "s1" } }));
    expect(await onB).toEqual({ type: "event", event: { kind: "session.done", sessionId: "s1", ok: true, costUsd: null } });

    a.close(); b.close();
    await srv.close();
  });

  it("never pushes to a socket that has not authenticated", async () => {
    const cfg = cfgFor();
    const srv = await startServer(cfg, async (method, _params, push) => {
      push({ kind: "session.done", sessionId: "s1", ok: true, costUsd: null });
      return null;
    });

    const a = open(srv.port), lurker = open(srv.port);
    let lurkerMsgs = 0;
    lurker.on("message", () => lurkerMsgs++);
    await Promise.all([opened(a), opened(lurker)]); // lurker authenticates never
    a.send(JSON.stringify({ type: "auth", token: cfg.token }));
    await next(a);

    const onA = next(a);
    a.send(JSON.stringify({ type: "req", id: "1", method: "sessions.interrupt", params: { sessionId: "s1" } }));
    expect(await onA).toEqual({ type: "event", event: { kind: "session.done", sessionId: "s1", ok: true, costUsd: null } });
    await new Promise((r) => setTimeout(r, 20)); // a leaked frame to the lurker needs a turn to land
    expect(lurkerMsgs).toBe(0);

    a.close(); lurker.close();
    await srv.close();
  });

  it("pings authed sockets, keeps the answering one and terminates the silent one", async () => {
    const cfg = cfgFor();
    // Same shape as production, three orders of magnitude faster.
    const srv = await startServer(cfg, async () => null, { pingMs: 25, pongMs: 15 });

    const live = openDeaf(srv.port), deaf = openDeaf(srv.port);
    // live answers by hand; deaf never does. Both sockets are otherwise identical,
    // so the only variable in the test is the pong.
    live.on("ping", () => live.pong());
    let pings = 0;
    live.on("ping", () => pings++);
    await Promise.all([live, deaf].map(async (ws) => {
      await opened(ws);
      ws.send(JSON.stringify({ type: "auth", token: cfg.token }));
      return next(ws);
    }));

    // terminate() destroys the socket without a close frame: 1006, not 1000.
    expect(await closed(deaf)).toBe(1006);
    expect(live.readyState).toBe(WebSocket.OPEN);
    expect(pings).toBeGreaterThan(0);

    live.close();
    await srv.close();
  });

  it("rejects instead of hanging when the port is taken", async () => {
    const first = await startServer(cfgFor(), async () => null);
    await expect(startServer({ ...cfgFor(), port: first.port }, async () => null)).rejects.toThrow();
    await first.close();
  });

  it("round-trips config.get/config.set through a real registry", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wb-"));
    // The one object the server authenticates with, the registry answers from,
    // and index.ts's notify closure reads — sharing it is what makes a topic
    // change take effect without a restart.
    const cfg = { ...loadConfig(dir), port: 0 };
    const registry = new Registry({ query: () => (async function* () {})() } as any, new Manifest(dir), () => {}, cfg);
    const srv = await startServer(cfg, (method, params) => registry.handle(method, params));

    const ws = open(srv.port);
    await opened(ws);
    ws.send(JSON.stringify({ type: "auth", token: cfg.token }));
    await next(ws);

    const call = async (id: string, method: string, params?: unknown) => {
      const res = next(ws);
      ws.send(JSON.stringify({ type: "req", id, method, params }));
      return (await res).data;
    };

    expect(await call("1", "config.get")).toEqual({ ntfyTopic: null, version: VERSION, hostname: hostname() });
    expect(await call("2", "config.set", { ntfyTopic: "wb-abc" })).toEqual({
      ntfyTopic: "wb-abc",
      version: VERSION,
      hostname: hostname(),
    });
    expect(await call("3", "config.get")).toMatchObject({ ntfyTopic: "wb-abc" });
    expect(cfg.ntfyTopic).toBe("wb-abc");

    const onDisk = JSON.parse(readFileSync(join(dir, "config.json"), "utf8"));
    expect(onDisk).toMatchObject({ ntfyTopic: "wb-abc", token: cfg.token, port: 8790 });

    expect(await call("4", "config.set", { ntfyTopic: null })).toMatchObject({ ntfyTopic: null });
    expect(loadConfig(dir).ntfyTopic).toBeNull();

    ws.close();
    await srv.close();
  });

  it("serves the debug page at /", async () => {
    const srv = await startServer(cfgFor(), async () => null);
    const res = await fetch(`http://127.0.0.1:${srv.port}/`);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(await res.text()).toContain("<h1>");
    expect((await fetch(`http://127.0.0.1:${srv.port}/nope`)).status).toBe(404);
    await srv.close();
  });
});
