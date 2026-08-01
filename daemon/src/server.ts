import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { timingSafeEqual } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
import type { Config } from "./config.js";
import { parseClientMsg, type ServerMsg, type PushEvent } from "./protocol.js";
import { VERSION } from "./version.js";

// A thrown Error becomes { ok: false, error: message } — handlers signal failure by throwing.
export type RequestHandler = (method: string, params: any, push: (e: PushEvent) => void) => Promise<unknown>;

// Injectable only so the liveness test can run in milliseconds instead of a minute.
export interface ServerOpts {
  pingMs?: number;
  pongMs?: number;
}

export function startServer(cfg: Config, handler: RequestHandler, opts: ServerOpts = {}) {
  const pingMs = opts.pingMs ?? 30_000;
  const pongMs = opts.pongMs ?? 10_000;
  // dist is flat (rootDir src), so ".." is daemon/ from both src/ (tsx) and
  // dist/ (built). Everything served is therefore an uncompiled sibling of
  // src/: debug/, web/, and node_modules/ — no copy step, one resolution.
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const xterm = join(root, "node_modules", "@xterm", "xterm");
  const HTML = "text/html; charset=utf-8";
  // The whole static surface. A fixed table, not a path join off req.url —
  // that is also why there is no traversal check to get wrong.
  const routes = new Map<string, [file: string, type: string]>([
    ["/", [join(root, "debug", "index.html"), HTML]],
    ["/terminal", [join(root, "web", "terminal.html"), HTML]],
    ["/vendor/xterm.js", [join(xterm, "lib", "xterm.js"), "application/javascript; charset=utf-8"]],
    ["/vendor/xterm.css", [join(xterm, "css", "xterm.css"), "text/css; charset=utf-8"]],
  ]);
  const expected = Buffer.from(cfg.token);
  // Length check first: timingSafeEqual throws on a length mismatch, and the
  // comparison itself must not leak the token one byte at a time via ===.
  const tokenOk = (given: string) => {
    const got = Buffer.from(given);
    return got.length === expected.length && timingSafeEqual(got, expected);
  };

  const authed = new Set<WebSocket>();
  const push = (event: PushEvent) => {
    const msg = JSON.stringify({ type: "event", event } satisfies ServerMsg);
    for (const ws of authed) if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  };
  const send = (ws: WebSocket, msg: ServerMsg) => ws.send(JSON.stringify(msg));

  const http = createServer((req, res) => {
    // Query stripped: /terminal?dev=1 is the desktop-debug entry to the same page.
    const route = routes.get(req.url?.split("?")[0] ?? "");
    let body: Buffer | null = null;
    // Read per request so the pages can be edited without a daemon restart; a
    // missing file is a 404, not an uncaught throw that takes the daemon down.
    if (route) try { body = readFileSync(route[0]); } catch { /* 404 below */ }
    if (!route || !body) { res.statusCode = 404; res.end(); return; }
    res.setHeader("content-type", route[1]);
    res.end(body);
  });
  const wss = new WebSocketServer({ server: http, path: "/ws" });
  // ws mirrors the http server's "error" onto itself, and an unlistened "error"
  // event throws out of the emit loop — before the http listener below can run.
  // The real handling is on http; this only keeps the mirror quiet.
  wss.on("error", () => {});

  wss.on("connection", (ws) => {
    // A socket that dies mid-send (ECONNRESET from a phone leaving wifi) emits
    // "error"; unhandled, an EventEmitter error event would take the daemon down.
    ws.on("error", () => ws.terminate());
    // Auth-first: nothing else is even parsed until the first message authenticates.
    ws.once("message", (raw) => {
      const m = parseClientMsg(raw.toString());
      if (m?.type !== "auth" || !tokenOk(m.token)) return ws.close(4001, "unauthorized");
      authed.add(ws);
      // A phone that walks out of wifi range never sends a FIN: the daemon would
      // hold a dead socket and broadcast into it forever. No client-side timer
      // answers this — React Native's and the browser's WebSocket both reply to
      // pings in the runtime, below any JS we could write.
      let alive = true;
      let deadline: NodeJS.Timeout | undefined;
      ws.on("pong", () => { alive = true; });
      const ping = setInterval(() => {
        alive = false;
        ws.ping();
        deadline = setTimeout(() => { if (!alive) ws.terminate(); }, pongMs);
      }, pingMs);
      ws.on("close", () => { authed.delete(ws); clearInterval(ping); clearTimeout(deadline); });
      send(ws, { type: "auth.ok", version: VERSION });
      ws.on("message", async (r) => {
        const msg = parseClientMsg(r.toString());
        if (msg?.type !== "req") return; // ponytail: malformed input is dropped, not answered
        try {
          const data = await handler(msg.method, (msg as any).params, push);
          send(ws, { type: "res", id: msg.id, ok: true, data });
        } catch (e: any) {
          send(ws, { type: "res", id: msg.id, ok: false, error: String(e?.message ?? e) });
        }
      });
    });
  });

  return new Promise<{ close(): Promise<void>; port: number }>((resolve, reject) => {
    // Port already taken (a second daemon) must reject, not hang forever on a
    // promise while an uncaught "error" event kills the process.
    http.once("error", reject);
    http.listen(cfg.port, "0.0.0.0", () => resolve({
      port: (http.address() as any).port,
      close: () => new Promise<void>((r) => { for (const ws of wss.clients) ws.terminate(); wss.close(); http.close(() => r()); }),
    }));
  });
}
