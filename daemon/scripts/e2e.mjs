// Real-SDK end-to-end gate: auth -> sessions.new -> approve -> done -> file on
// disk -> sessions.list idle. Deliberately NOT part of `npm test`: it needs a
// logged-in Claude CLI, costs real money and takes minutes. Run by hand:
//
//   npm run e2e
//
// Exit 0 = gate met. Anything else = broken, and the trace above says where.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, parse } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
// A plain top-level directory, and deliberately NOT os.tmpdir() nor a dot-dir
// inside the repo. Both have been observed to make the agent resolve the wrong
// path and write hello.txt somewhere else entirely (the Windows temp path is
// aliased; a nested dot-dir gets confused with the repo root). Boring path, and
// the daemon is launched from it below so nothing else competes as "the cwd".
const scratch = join(parse(root).root, "wb-e2e");
const dataDir = join(scratch, "data");
const cwd = join(scratch, "cwd");
const file = join(cwd, "hello.txt");
// Not 8791: a daemon the user actually runs sits there, and the two would fight
// over the port (or worse, this would drive the live one).
// `||` not `??`: an empty or non-numeric env var should fall back, and `??`
// would let "" through as 0.
const PORT = Number(process.env.WORKBENCH_E2E_PORT) || 18791;

const log = (s) => console.log(s);
const fail = (s) => { log(`FAIL: ${s}`); done(1); };

let daemon = null;
function done(code) {
  // kill() only reaps the node process; the Claude CLI it spawned is a
  // grandchild and would linger holding the scratch dir open.
  if (daemon) {
    if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(daemon.pid), "/T", "/F"], { stdio: "ignore" });
    else daemon.kill();
  }
  // A failed run keeps its scratch: hello.txt, the manifest and the config are
  // the evidence. A passing run has nothing left worth reading.
  if (code === 0) {
    try { rmSync(scratch, { recursive: true, force: true }); } catch { /* the CLI may still hold a handle; not worth failing a pass over */ }
  }
  process.exit(code);
}

// Fresh scratch every run: a leftover hello.txt turns the write into a
// read-then-write dance and changes what the run is actually testing.
rmSync(scratch, { recursive: true, force: true });
mkdirSync(dataDir, { recursive: true });
mkdirSync(cwd, { recursive: true });
// Pre-seeding the config is what makes the token knowable without scraping stdout.
const token = "e2e".padEnd(64, "0");
writeFileSync(join(dataDir, "config.json"), JSON.stringify({ token, port: PORT, ntfyTopic: null }, null, 2));

// Compiled, not tsx: one process to kill, and it proves dist/ actually runs.
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
if (spawnSync(npm, ["run", "build"], { cwd: root, stdio: "inherit", shell: true }).status !== 0) fail("build");

daemon = spawn(process.execPath, [join(root, "dist", "index.js")], {
  // Launched from the scratch dir on purpose: the CLI child inherits it, so the
  // repo checkout is not sitting there as a plausible-looking alternative cwd.
  cwd,
  env: { ...process.env, WORKBENCH_DATA_DIR: dataDir },
  stdio: ["ignore", "inherit", "inherit"],
});
daemon.on("exit", (c) => { if (c !== null) fail(`daemon exited early (${c})`); });

const bail = setTimeout(() => fail("timeout"), 300_000);

// The daemon needs a moment to bind; retry rather than guess a sleep.
const ws = await (async () => {
  for (let i = 0; i < 60; i++) {
    const sock = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
    const ok = await new Promise((r) => {
      sock.addEventListener("open", () => r(true), { once: true });
      sock.addEventListener("error", () => r(false), { once: true });
    });
    if (ok) return sock;
    await new Promise((r) => setTimeout(r, 250));
  }
  return fail("daemon never accepted a connection");
})();

let seq = 0;
const pend = new Map();
const rpc = (method, params) =>
  new Promise((res) => {
    const id = String(++seq);
    // A rejected RPC ends the run with a FAIL line. Rejecting for real would
    // surface as an unhandled-rejection stack instead: every caller is awaited
    // inside an event listener, so there is nothing up the stack to catch it.
    pend.set(id, { res, rej: (e) => fail(`${method} rejected: ${e.message}`) });
    ws.send(JSON.stringify({ type: "req", id, method, params }));
  });

let sessionId = null;
ws.addEventListener("close", (e) => { if (e.code === 4001) fail("unauthorized"); });
ws.addEventListener("message", async (ev) => {
  const m = JSON.parse(ev.data.toString());

  if (m.type === "auth.ok") {
    log(`auth.ok version=${m.version}`);
    // The path is spelled out on purpose. Task 8 established (by reproducing it
    // against query() directly, outside the daemon) that on Windows the agent
    // often resolves a bare "hello.txt" against $HOME rather than its cwd. That
    // is a model behaviour, not a daemon bug, and this gate is here to prove the
    // daemon's wire flow — not to re-litigate path resolution every run.
    const r = await rpc("sessions.new", { cwd, prompt: `create hello.txt in ${cwd} containing exactly: hi` });
    sessionId = r.sessionId;
    log(`sessions.new -> ${sessionId}`);
    return;
  }
  if (m.type === "res") {
    const p = pend.get(m.id);
    pend.delete(m.id);
    if (p) m.ok ? p.res(m.data) : p.rej(new Error(m.error));
    return;
  }

  const e = m.event;
  if (e.kind === "session.text") log(`  text ${e.role}: ${e.text.slice(0, 120).replace(/\s+/g, " ")}`);
  else if (e.kind === "session.tool") log(`  tool ${e.summary.slice(0, 120)}`);
  else if (e.kind === "session.status") log(`  status ${e.status} "${e.title}"`);
  else if (e.kind === "session.permission") {
    log(`  permission ${e.toolName} :: ${e.summary.slice(0, 120)} -> allow`);
    await rpc("sessions.approve", { sessionId: e.sessionId, requestId: e.requestId, allow: true });
  } else if (e.kind === "session.done") {
    clearTimeout(bail);
    log(`  done ok=${e.ok} cost=${e.costUsd}`);
    if (!e.ok) fail("session.done ok=false");

    if (!existsSync(file)) fail(`${file} was never written`);
    const content = readFileSync(file, "utf8").trim();
    log(`file ${file} = ${JSON.stringify(content)}`);
    if (content !== "hi") fail(`expected "hi", got ${JSON.stringify(content)}`);

    // status("idle") is emitted synchronously right after done, so the manifest
    // is already current by the time this round-trips.
    const list = await rpc("sessions.list");
    const row = list.find((s) => s.sessionId === sessionId);
    if (!row) fail("sessions.list is missing the session");
    if (row.status !== "idle") fail(`expected idle, got ${row.status}`);
    log(`sessions.list -> ${row.sessionId} ${row.status} "${row.title}"`);

    log("E2E PASS");
    done(0);
  }
});

ws.send(JSON.stringify({ type: "auth", token }));
