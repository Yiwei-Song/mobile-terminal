import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { timingSafeEqual } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
import type { Config } from "./config.js";
import { parseClientMsg, type ServerMsg, type SessionEvent } from "./protocol.js";
import { VERSION } from "./version.js";

// A thrown Error becomes { ok: false, error: message } — handlers signal failure by throwing.
export type RequestHandler = (method: string, params: any, push: (e: SessionEvent) => void) => Promise<unknown>;

export function startServer(cfg: Config, handler: RequestHandler) {
  const debugHtml = join(dirname(fileURLToPath(import.meta.url)), "..", "debug", "index.html");
  const expected = Buffer.from(cfg.token);
  // Length check first: timingSafeEqual throws on a length mismatch, and the
  // comparison itself must not leak the token one byte at a time via ===.
  const tokenOk = (given: string) => {
    const got = Buffer.from(given);
    return got.length === expected.length && timingSafeEqual(got, expected);
  };

  const authed = new Set<WebSocket>();
  const push = (event: SessionEvent) => {
    const msg = JSON.stringify({ type: "event", event } satisfies ServerMsg);
    for (const ws of authed) if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  };
  const send = (ws: WebSocket, msg: ServerMsg) => ws.send(JSON.stringify(msg));

  const http = createServer((req, res) => {
    let html: Buffer | null = null;
    // Read per request so Task 8 can edit the page without a daemon restart; a
    // missing file is a 404, not an uncaught throw that takes the daemon down.
    if (req.url === "/") try { html = readFileSync(debugHtml); } catch { /* 404 below */ }
    if (!html) { res.statusCode = 404; res.end(); return; }
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.end(html);
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
      ws.on("close", () => authed.delete(ws));
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
