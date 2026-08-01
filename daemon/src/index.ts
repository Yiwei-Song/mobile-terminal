import { networkInterfaces } from "node:os";
import { spawn, exec } from "node:child_process";
import * as si from "systeminformation";
import { query } from "@anthropic-ai/claude-agent-sdk";
import qrcode from "qrcode-terminal";
import { loadConfig } from "./config.js";
import { startServer } from "./server.js";
import { notify, ntfyFor } from "./notify.js";
import { runBootResume, bootSideEffects } from "./boot.js";
import { KeepAwake, lockWorkstation } from "./power.js";
import { execFileText } from "./files.js";
import * as pty from "@lydell/node-pty";
import { PtyManager } from "./term.js";
import { ToolRunner, loadToolSpecs } from "./tools.js";
import type { PushEvent } from "./protocol.js";
import { Manifest } from "./sessions/manifest.js";
import { Registry } from "./sessions/registry.js";

// The optional dataDir argument exists so a test run can point at a scratch
// directory instead of the user's real %APPDATA%\workbench.
const cfg = loadConfig(process.env["WORKBENCH_DATA_DIR"]);
const manifest = new Manifest(cfg.dataDir);

// system/power singletons the daemon owns, with the real deps. KeepAwake is
// started at startup; the phone can toggle it (power.keepAwake) — the workbench
// must not sleep out from under a phone that's driving it.
const powerDeps = { spawn, exec };
const keepAwake = new KeepAwake(powerDeps);
keepAwake.start();
// Belt-and-suspenders: kill the keep-awake child if the daemon exits. The child
// also self-exits on stdin EOF (its pipe closes when we die), but this covers
// the clean-exit path synchronously so the machine can sleep again promptly.
process.on("exit", () => {
  keepAwake.stop();
  // Orphaned ptys keep running (and holding their cwd) after the daemon dies.
  terms.killAll();
  // Same for a `docker compose up` or a vite server the phone started.
  tools.stopAll();
});

// The user's declared dev services. No tools.json (the default) means an empty
// list and a Tools screen that explains how to opt in.
const tools = new ToolRunner({ spawn }, loadToolSpecs(cfg.dataDir));

// ponytail: single-push-ref; event bus if the daemon grows. The registry is
// built before the server (it *is* the server's handler), so its push starts as
// a no-op and is filled in by the first request.
let pushRef: (e: PushEvent) => void = () => {};
// The live terminals. Their output goes straight onto the event channel — the
// terminal WebView is just another authed client, so no ntfy, no manifest.
const terms = new PtyManager(
  { pty },
  (termId, data) => pushRef({ kind: "term.data", termId, data }),
  (termId, code) => pushRef({ kind: "term.exit", termId, code }),
);
// A raw uuid on a lock screen says nothing about which session it is; the
// manifest already holds the title the list shows, so read it back from there.
const titleOf = (sessionId: string) =>
  manifest.list().find((s) => s.sessionId === sessionId)?.title || sessionId;
const registry = new Registry(
  { query },
  manifest,
  (e) => {
    pushRef(e);
    // cfg.ntfyTopic is read per event, so a config.set takes effect immediately.
    const n = ntfyFor(e, "sessionId" in e ? titleOf(e.sessionId) : "");
    if (n) notify(cfg.ntfyTopic, n.title, n.body);
  },
  cfg,
  { system: { si }, keepAwake, power: powerDeps, pty: terms, execFile: execFileText, tools },
);

// After the manifest is normalized and before any client can read it: clear
// stale running rows, and — ONLY for the scheduled post-reboot start
// (WORKBENCH_LOCK_ON_START=1, nobody at the desk) — lock the screen (privacy)
// and tell the phone we're back. A manual start normalizes but never locks.
runBootResume(
  manifest,
  bootSideEffects(process.env["WORKBENCH_LOCK_ON_START"] === "1", {
    lock: () => void lockWorkstation(powerDeps),
    notify: (title, body) => notify(cfg.ntfyTopic, title, body),
  }),
);

const srv = await startServer(cfg, (method, params, push) => {
  pushRef = push;
  return registry.handle(method, params);
}).catch((e: any) => {
  // Port already in use is the everyday case (a second daemon). One line, not a stack.
  console.error(`Failed to start: ${e?.message ?? e}`);
  return process.exit(1);
});

// The address the phone on the same wifi can reach. "First non-internal IPv4"
// is wrong on Windows: WSL and Hyper-V vEthernet adapters are non-internal and
// usually enumerate first, so the QR would encode a host nothing can route to.
// Prefer the ranges a home router hands out; print every candidate so a bad
// pick is diagnosable in one glance.
const rank = (a: string): number => (a.startsWith("192.168.") ? 0 : a.startsWith("10.") ? 1 : 2);
const candidates = Object.entries(networkInterfaces())
  .flatMap(([name, addrs]) =>
    (addrs ?? []).filter((a) => !a.internal && a.family === "IPv4").map((a) => ({ name, address: a.address })),
  )
  // Stable sort: same-rank addresses keep OS enumeration order.
  .sort((a, b) => rank(a.address) - rank(b.address));
const ip = candidates[0]?.address ?? "127.0.0.1";

console.log(`LAN candidates (best first): ${candidates.map((c) => `${c.name}=${c.address}`).join("  ") || "(none)"}`);

console.log(
  `Workbench daemon on ws://${ip}:${srv.port}/ws  (debug page: http://${ip}:${srv.port}/, terminal: http://${ip}:${srv.port}/terminal)`,
);
console.log("Scan to pair:");
qrcode.generate(JSON.stringify({ host: ip, port: srv.port, token: cfg.token }), { small: true });
