import { networkInterfaces } from "node:os";
import { query } from "@anthropic-ai/claude-agent-sdk";
import qrcode from "qrcode-terminal";
import { loadConfig } from "./config.js";
import { startServer } from "./server.js";
import { notify } from "./notify.js";
import type { SessionEvent } from "./protocol.js";
import { Manifest } from "./sessions/manifest.js";
import { Registry } from "./sessions/registry.js";

// The optional dataDir argument exists so a test run can point at a scratch
// directory instead of the user's real %APPDATA%\workbench.
const cfg = loadConfig(process.env["WORKBENCH_DATA_DIR"]);
const manifest = new Manifest(cfg.dataDir);

// ponytail: single-push-ref; event bus if the daemon grows. The registry is
// built before the server (it *is* the server's handler), so its push starts as
// a no-op and is filled in by the first request.
let pushRef: (e: SessionEvent) => void = () => {};
const registry = new Registry({ query }, manifest, (e) => {
  pushRef(e);
  // The two moments worth waking a phone for: a blocked session, and a finished one.
  if (e.kind === "session.permission") notify(cfg.ntfyTopic, "Approval needed", e.summary);
  if (e.kind === "session.done") notify(cfg.ntfyTopic, "Session finished", e.sessionId);
});

const srv = await startServer(cfg, (method, params, push) => {
  pushRef = push;
  return registry.handle(method, params);
});

// First non-internal IPv4 — the address the phone on the same wifi can reach.
const ip =
  Object.values(networkInterfaces())
    .flat()
    .find((i) => i && !i.internal && i.family === "IPv4")?.address ?? "127.0.0.1";

console.log(`Workbench daemon on ws://${ip}:${srv.port}/ws  (debug page: http://${ip}:${srv.port}/)`);
console.log("Scan to pair:");
qrcode.generate(JSON.stringify({ host: ip, port: srv.port, token: cfg.token }), { small: true });
