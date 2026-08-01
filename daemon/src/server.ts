import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname, resolve, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { timingSafeEqual } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
import type { Config } from "./config.js";
import { parseClientMsg, type ServerMsg, type PushEvent } from "./protocol.js";
import { VERSION } from "./version.js";

// A thrown Error becomes { ok: false, error: message } — handlers signal failure by throwing.
export type RequestHandler = (method: string, params: any, push: (e: PushEvent) => void) => Promise<unknown>;

// Injectable only so the liveness test can run in milliseconds instead of a
// minute, and so the static-serving tests can point at a fixture build.
export interface ServerOpts {
  pingMs?: number;
  pongMs?: number;
  authMs?: number;
  appDist?: string;
}

// Inbound frames are an auth handshake and small JSON requests; the big payloads
// (a git.diff, a terminal scrollback) are RESPONSES, which this does not cap.
// The largest thing a client sends is a file write, orders of magnitude under
// this — and ws's 100 MiB default is a free OOM for anyone who reaches the port.
const MAX_PAYLOAD = 1024 * 1024;
// A phone, its terminal WebView, a desktop debug tab, a spare. Counted before
// auth, because holding unauthenticated sockets open is the exhaustion attack.
const MAX_SOCKETS = 8;

const HTML = "text/html; charset=utf-8";
// Enough for what an Expo web export emits. Anything else is served as bytes
// rather than guessed at.
const TYPES: Record<string, string> = {
  ".html": HTML,
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
};

export function startServer(cfg: Config, handler: RequestHandler, opts: ServerOpts = {}) {
  const pingMs = opts.pingMs ?? 30_000;
  const pongMs = opts.pongMs ?? 10_000;
  // Long enough for a phone on a bad tunnel to get its first frame in, short
  // enough that an unauthenticated socket is never a resource anyone can hold.
  const authMs = opts.authMs ?? 5_000;
  // dist is flat (rootDir src), so ".." is daemon/ from both src/ (tsx) and
  // dist/ (built). Everything served is therefore an uncompiled sibling of
  // src/: debug/, web/, and node_modules/ — no copy step, one resolution.
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const xterm = join(root, "node_modules", "@xterm", "xterm");
  const debugPage = join(root, "debug", "index.html");
  // The daemon's own pages. A fixed table, not a path join off req.url — that is
  // also why there is no traversal check to get wrong. It is consulted BEFORE
  // the app build below, so /ws, /terminal and /vendor/* keep their meaning
  // whatever the export happens to contain.
  const routes = new Map<string, [file: string, type: string]>([
    ["/debug", [debugPage, HTML]],
    ["/terminal", [join(root, "web", "terminal.html"), HTML]],
    ["/vendor/xterm.js", [join(xterm, "lib", "xterm.js"), "application/javascript; charset=utf-8"]],
    ["/vendor/xterm.css", [join(xterm, "css", "xterm.css"), "text/css; charset=utf-8"]],
  ]);

  // The app's web export. Sibling of daemon/, so "../app/dist" resolves the same
  // from src/ (tsx) and dist/ (built) — see the `root` note above.
  const dist = resolve(opts.appDist ?? join(root, "..", "app", "dist"));
  const hasApp = existsSync(join(dist, "index.html"));
  // No export, no silent blank page: / stays the debug page and the hint says
  // exactly how to get the real UI.
  if (!hasApp) {
    routes.set("/", [debugPage, HTML]);
    console.log(`No web app build at ${dist} — serving the debug page at /. Run "npm run build:app" to serve the app.`);
  }
  // Unlike the table above this one DOES join a path off req.url, so the
  // resolved file is checked to be inside dist before anything is read.
  const appFiles = (path: string): string[] => {
    if (!hasApp) return [];
    let p: string;
    try { p = decodeURIComponent(path); } catch { return []; } // %zz — not a path
    const file = resolve(dist, `.${p}`);
    if (file !== dist && !file.startsWith(dist + sep)) return [];
    // Extension-less means a route: expo's static export writes one html per
    // route (/settings -> settings.html), and index.html last is the SPA
    // fallback so a deep link boots the app instead of 404ing. A request WITH an
    // extension is an asset — a missing hashed bundle must stay a 404, not
    // become an html page served as javascript.
    return extname(file) === "" ? [join(file, "index.html"), `${file}.html`, join(dist, "index.html")] : [file];
  };
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
    const path = req.url?.split("?")[0] ?? "";
    const route = routes.get(path);
    let body: Buffer | null = null;
    let type = route?.[1] ?? HTML;
    // Read per request so the pages can be edited without a daemon restart; a
    // missing file is a 404, not an uncaught throw that takes the daemon down.
    if (route) try { body = readFileSync(route[0]); } catch { /* 404 below */ }
    else for (const f of appFiles(path)) {
      // A directory throws EISDIR here, which is the same "try the next
      // candidate" as a missing file — no separate stat call.
      try { body = readFileSync(f); } catch { continue; }
      type = TYPES[extname(f).toLowerCase()] ?? "application/octet-stream";
      break;
    }
    if (!body) { res.statusCode = 404; res.end(); return; }
    res.setHeader("content-type", type);
    res.end(body);
  });
  const wss = new WebSocketServer({ server: http, path: "/ws", maxPayload: MAX_PAYLOAD });
  // ws mirrors the http server's "error" onto itself, and an unlistened "error"
  // event throws out of the emit loop — before the http listener below can run.
  // The real handling is on http; this only keeps the mirror quiet.
  wss.on("error", () => {});

  wss.on("connection", (ws) => {
    // A socket that dies mid-send (ECONNRESET from a phone leaving wifi) emits
    // "error"; unhandled, an EventEmitter error event would take the daemon down.
    ws.on("error", () => ws.terminate());
    // clients already includes this socket. Counted before auth on purpose: an
    // unauthenticated socket costs the same to hold as an authenticated one, and
    // over a tunnel anyone can open them.
    if (wss.clients.size > MAX_SOCKETS) return ws.close(4002, "too many connections");
    // The ping watchdog below only starts AFTER auth, so without this an
    // unauthenticated socket is held forever for free. Cleared on the first
    // frame — good or bad, the auth branch decides from there.
    const authTimer = setTimeout(() => ws.close(4001, "auth timeout"), authMs);
    ws.once("close", () => clearTimeout(authTimer));
    // Auth-first: nothing else is even parsed until the first message authenticates.
    ws.once("message", (raw) => {
      clearTimeout(authTimer);
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
    // "::", not "0.0.0.0": on Windows 0.0.0.0 is IPv4-ONLY, and the address the
    // phone reaches this machine on from outside the house is the tailnet IPv6
    // one (Mullvad's always-on firewall blocks Tailscale's IPv4 range but
    // allows fc00::/7). A dual-stack "::" socket still accepts IPv4 via
    // IPv4-mapped addresses, so localhost and the LAN keep working unchanged.
    // Behind a Cloudflare tunnel, set config.json's bindHost to "::1": cloudflared
    // connects over loopback, so nothing else on any network can reach the port.
    http.listen(cfg.port, cfg.bindHost ?? "::", () => resolve({
      port: (http.address() as any).port,
      close: () => new Promise<void>((r) => { for (const ws of wss.clients) ws.terminate(); wss.close(); http.close(() => r()); }),
    }));
  });
}
