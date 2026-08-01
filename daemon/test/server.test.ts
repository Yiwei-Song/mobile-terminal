import { describe, it, expect } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { hostname, networkInterfaces, tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import { loadConfig } from "../src/config.js";
import { startServer } from "../src/server.js";
import { VERSION } from "../src/version.js";
import { Manifest } from "../src/sessions/manifest.js";
import { Registry } from "../src/sessions/registry.js";
import { fakeMachine } from "./fixtures.js";

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

  // Everything below is what stops the daemon being a free resource for anyone
  // who can reach the port — which, behind a tunnel, is the whole internet.
  it("closes a socket that never authenticates, and leaves an authed one alone", async () => {
    const cfg = cfgFor();
    const srv = await startServer(cfg, async () => null, { authMs: 30 });

    const silent = open(srv.port);
    await opened(silent);
    expect(await closed(silent)).toBe(4001);

    // The same timer must not fire behind a socket that did authenticate.
    const good = open(srv.port);
    await opened(good);
    good.send(JSON.stringify({ type: "auth", token: cfg.token }));
    await next(good);
    await new Promise((r) => setTimeout(r, 90)); // several auth deadlines
    expect(good.readyState).toBe(WebSocket.OPEN);

    good.close();
    await srv.close();
  });

  it("caps concurrent sockets", async () => {
    const cfg = cfgFor();
    // Unauthenticated sockets count: holding them open is the attack.
    const srv = await startServer(cfg, async () => null, { authMs: 5_000 });

    const socks: WebSocket[] = [];
    for (let i = 0; i < 8; i++) {
      const ws = open(srv.port);
      await opened(ws);
      socks.push(ws);
    }
    const extra = open(srv.port);
    await opened(extra);
    expect(await closed(extra)).toBe(4002);
    expect(socks.every((ws) => ws.readyState === WebSocket.OPEN)).toBe(true);

    for (const ws of socks) ws.close();
    await srv.close();
  });

  it("drops an oversized frame instead of buffering it", async () => {
    const cfg = cfgFor();
    const srv = await startServer(cfg, async () => null);

    const hog = open(srv.port);
    await opened(hog);
    // Inbound frames are auth + small JSON requests; 2 MiB is over the 1 MiB cap.
    hog.send(JSON.stringify({ type: "auth", token: "x".repeat(2 * 1024 * 1024) }));
    // 1006, not ws's 1009: the payload cap raises an "error", and this daemon's
    // error handler terminates rather than politely closing. Either way the
    // frame was never buffered and the socket is gone.
    expect(await closed(hog)).toBe(1006);

    // …and the daemon itself is untouched by it.
    const good = open(srv.port);
    await opened(good);
    good.send(JSON.stringify({ type: "auth", token: cfg.token }));
    expect((await next(good)).type).toBe("auth.ok");

    good.close();
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
    const registry = new Registry({ query: () => (async function* () {})() } as any, new Manifest(dir), () => {}, cfg, fakeMachine().machine);
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

  // The phone reaches this machine over the tailnet's IPv6 address, so an
  // IPv4-only listener ("0.0.0.0") would answer on the LAN and nowhere else.
  // Every other test in this file already covers the IPv4 side of the same
  // dual-stack socket by connecting to 127.0.0.1.
  const hasIPv6 = Object.values(networkInterfaces()).flat().some((a) => a?.address === "::1");
  it.skipIf(!hasIPv6)("answers on IPv6 loopback too, not just IPv4", async () => {
    const cfg = cfgFor();
    const srv = await startServer(cfg, async () => null);

    expect((await fetch(`http://[::1]:${srv.port}/`)).status).toBe(200);
    const ws = new WebSocket(`ws://[::1]:${srv.port}/ws`);
    await opened(ws);
    ws.send(JSON.stringify({ type: "auth", token: cfg.token }));
    expect((await next(ws)).type).toBe("auth.ok");

    ws.close();
    await srv.close();
  });

  // Behind a tunnel, cloudflared connects over loopback — narrowing bindHost is
  // what makes the tunnel the ONLY way in.
  it("binds only where bindHost says", async () => {
    const srv = await startServer({ ...cfgFor(), bindHost: "127.0.0.1" }, async () => null);

    expect((await fetch(`http://127.0.0.1:${srv.port}/`)).status).toBe(200);
    // A different address on the same machine is now refused, not answered.
    await expect(fetch(`http://[::1]:${srv.port}/`)).rejects.toThrow();

    await srv.close();
  });

  it("serves the debug page at /debug, and at / when there is no app build", async () => {
    // A directory with no index.html is what a checkout that never ran the
    // export looks like — / must still be something, not a 404.
    const srv = await startServer(cfgFor(), async () => null, { appDist: mkdtempSync(join(tmpdir(), "wb-nodist-")) });
    const get = (p: string) => fetch(`http://127.0.0.1:${srv.port}${p}`);

    for (const p of ["/", "/debug"]) {
      const res = await get(p);
      expect(res.headers.get("content-type"), p).toContain("text/html");
      expect(await res.text(), p).toContain("<h1>");
    }
    expect((await get("/nope")).status).toBe(404);
    await srv.close();
  });

  // The tunnel's whole point: what a phone browser opens at / is the real app,
  // not the debug page — and a deep link into a client-side route has to boot it
  // too, or every reload on /files is a 404.
  describe("the app's web build", () => {
    const fixture = () => {
      const dir = mkdtempSync(join(tmpdir(), "wb-dist-"));
      writeFileSync(join(dir, "index.html"), "<!doctype html><title>workbench app</title>");
      writeFileSync(join(dir, "settings.html"), "<!doctype html><title>settings route</title>");
      mkdirSync(join(dir, "_expo"));
      writeFileSync(join(dir, "_expo", "bundle.js"), "console.log(1)");
      return dir;
    };

    it("serves it at /, falls back to index.html for routes, and keeps the daemon's own routes", async () => {
      const srv = await startServer(cfgFor(), async () => null, { appDist: fixture() });
      const get = (p: string) => fetch(`http://127.0.0.1:${srv.port}${p}`);

      const root = await get("/");
      expect(root.headers.get("content-type")).toContain("text/html");
      expect(await root.text()).toContain("workbench app");

      // Static export writes one html per route; the sibling wins over the fallback.
      expect(await (await get("/settings")).text()).toContain("settings route");
      // …and a route it did not write still boots the app (SPA fallback).
      expect(await (await get("/files")).text()).toContain("workbench app");

      const js = await get("/_expo/bundle.js");
      expect(js.headers.get("content-type")).toContain("application/javascript");
      expect(await js.text()).toBe("console.log(1)");
      // An asset request is NOT a route: a missing bundle must stay a 404 rather
      // than become index.html served as javascript.
      expect((await get("/_expo/gone.js")).status).toBe(404);

      // The daemon's own pages take precedence over anything in the export.
      expect(await (await get("/debug")).text()).toContain("<h1>");
      expect(await (await get("/terminal")).text()).toContain("xterm");
      expect((await get("/vendor/xterm.js")).status).toBe(200);
      await srv.close();
    });

    it("refuses to serve anything outside the build directory", async () => {
      const srv = await startServer(cfgFor(), async () => null, { appDist: fixture() });
      // Both spellings: the raw path, and the one that only becomes a traversal
      // after decoding — the check runs on the decoded, resolved path.
      for (const p of ["/../../package.json", "/..%2f..%2fpackage.json", "/%2e%2e/%2e%2e/package.json"]) {
        const res = await fetch(`http://127.0.0.1:${srv.port}${p}`);
        expect([200, 404], p).toContain(res.status);
        expect(await res.text(), p).not.toContain("workbench-daemon");
      }
      await srv.close();
    });
  });

  it("serves the terminal page and the vendored xterm assets", async () => {
    const srv = await startServer(cfgFor(), async () => null);
    const get = (p: string) => fetch(`http://127.0.0.1:${srv.port}${p}`);

    const page = await get("/terminal");
    expect(page.status).toBe(200);
    expect(page.headers.get("content-type")).toContain("text/html");
    const html = await page.text();
    expect(html).toContain("xterm");
    // The page must never take the token off the URL — assert the vendored
    // scripts it loads are the local ones and the token comes by message.
    expect(html).toContain("/vendor/xterm.js");
    expect(html).toContain("ReactNativeWebView");

    const js = await get("/vendor/xterm.js");
    expect(js.status).toBe(200);
    expect(js.headers.get("content-type")).toContain("application/javascript");
    expect((await js.text()).length).toBeGreaterThan(1000);

    const css = await get("/vendor/xterm.css");
    expect(css.status).toBe(200);
    expect(css.headers.get("content-type")).toContain("text/css");
    expect(await css.text()).toContain(".xterm");

    // A query string is the ?dev=1 desktop entry, not a different route.
    expect((await get("/terminal?dev=1")).status).toBe(200);
    await srv.close();
  });
});
