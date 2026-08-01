// Long-running dev services the phone can start and stop: a docker compose
// stack, a vite server, a headless-browser server. Declared by the user in
// <dataDir>/tools.json (see daemon/tools.example.json) — absent by default, so
// nothing here runs unless someone opted in.
//
// spawn is injected for the same reason power.ts injects it: these commands
// start real containers and servers, and a unit test must capture the command
// line without ever running one.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { spawn as Spawn, spawnSync as SpawnSync, ChildProcess } from "child_process";
import type { ToolSpec, ToolStatus } from "./protocol.js";

// The wire shapes live in protocol.ts (the app re-exports it); re-exported here
// so this module's public surface still reads as a whole.
export type { ToolSpec, ToolStatus };

export interface ToolDeps {
  spawn: typeof Spawn;
  // The kill is SYNC — see killTree. Injected separately because it is a
  // different function, not because the tests want two knobs.
  spawnSync: typeof SpawnSync;
}

export class ToolRunner {
  // Only the RUNNING ones. A spec with no entry here is stopped, which is what
  // makes "did it die on its own?" a lookup rather than a poll.
  private readonly children = new Map<string, ChildProcess>();

  constructor(
    private readonly deps: ToolDeps,
    private readonly specs: ToolSpec[],
  ) {}

  /** Idempotent: an already-running tool answers with its current status and no
   *  second child is spawned. Throws on a name that is not in tools.json. */
  start(name: string): ToolStatus {
    const spec = this.spec(name);
    if (this.children.has(name)) return this.statusOf(spec);
    // shell: true because the everyday command on Windows is a .cmd shim (npm,
    // npx, docker-compose) and Node refuses to spawn those without one. The
    // string is assembled from the user's own tools.json, never from the wire —
    // `name` is the only thing a client supplies and it only ever indexes.
    //
    // FOOTGUN: with shell: true Node does NOT quote the args — command and args
    // are joined with spaces and handed to cmd.exe/sh as one line. So an arg
    // containing a space splits into two, and one containing & | > splits the
    // command in half. Whoever writes tools.json must quote it themselves:
    // "args": ["--dir", "\"C:\\Program Files\\x\""]. Documented in
    // tools.example.json; not escaped here because the file is the user's own
    // and escaping would break the shell syntax people legitimately put in it.
    const child = this.deps.spawn(spec.command, spec.args ?? [], {
      cwd: spec.cwd,
      shell: true,
      windowsHide: true,
      stdio: "ignore",
    });
    this.children.set(name, child);
    // Identity-guarded, like KeepAwake's: a stop()→start() replaces the entry
    // before the dead child's exit fires, and that late event must not mark the
    // live successor stopped. `error` too — a command that fails to spawn emits
    // error and NEVER exit, so without this it would read as running forever
    // (and an unhandled "error" on a ChildProcess throws).
    const clear = (): void => {
      if (this.children.get(name) === child) this.children.delete(name);
    };
    child.on("exit", clear);
    child.on("error", clear);
    return this.statusOf(spec);
  }

  /** Stops the tool and everything it started. A stopped tool is a no-op. */
  stop(name: string): ToolStatus {
    const spec = this.spec(name);
    const child = this.children.get(name);
    // Dropped before the kill, not in the exit handler: taskkill is a separate
    // process and the tool is stopped as far as the phone is concerned now.
    this.children.delete(name);
    if (child !== undefined) this.killTree(child);
    return this.statusOf(spec);
  }

  status(): ToolStatus[] {
    return this.specs.map((s) => this.statusOf(s));
  }

  /** Daemon exit. Without it a `docker compose up` outlives the daemon.
   *  Safe to call from `process.on("exit")`: fully synchronous, all the way
   *  down — see killTree for why that is the whole point. */
  stopAll(): void {
    for (const name of [...this.children.keys()]) this.stop(name);
  }

  private killTree(child: ChildProcess): void {
    if (child.pid === undefined) return;
    // Every interesting tool spawns children (the shell above, then docker's or
    // node's own), and on Windows killing the parent orphans them — same
    // reasoning as power.ts. /T is the tree, /F is "do not ask".
    //
    // spawnSYNC, not spawn: stopAll() runs from process.on("exit"), and an async
    // spawn there is never scheduled — Node exits first. libuv then closes the
    // job object, which kills our cmd.exe shell while the REAL tool (docker, a
    // node server) silently breaks away and survives, invisible to the next
    // daemon. Sync taskkill runs while the shell is still alive, so /T has a
    // tree to walk.
    // ponytail: the interactive stop() RPC shares this path rather than keeping
    // an async twin — taskkill /F is tens of ms and does not wait on the target.
    // Its non-zero exit for an already-dead pid is the outcome we wanted, and
    // spawnSync reports a failed spawn in its return value instead of throwing
    // or emitting an unhandled "error", so there is nothing to handle.
    if (process.platform === "win32") {
      this.deps.spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
      return;
    }
    child.kill();
  }

  private statusOf(spec: ToolSpec): ToolStatus {
    const child = this.children.get(spec.name);
    return { name: spec.name, running: child !== undefined, pid: child?.pid, port: spec.port };
  }

  private spec(name: string): ToolSpec {
    const spec = this.specs.find((s) => s.name === name);
    if (spec === undefined) throw new Error(`unknown tool: ${name}`);
    return spec;
  }
}

/**
 * The user's `<dataDir>/tools.json`. Absent is the normal state — this feature
 * is opt-in — so that answers with an empty list and says nothing. Anything
 * present but malformed warns and also answers empty: a daemon that will not
 * start because of a typo'd side feature is worse than one with no dev tools.
 */
export function loadToolSpecs(dataDir: string): ToolSpec[] {
  const file = join(dataDir, "tools.json");
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    return []; // absent (or unreadable): the documented default, not a problem
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.every(isSpec)) throw new Error("expected an array of {name, command}");
    // start()/stop() index by name; two specs sharing one would make the second
    // unreachable and its child untrackable.
    if (new Set(parsed.map((s) => s.name)).size !== parsed.length) throw new Error("duplicate tool names");
    return parsed;
  } catch (e) {
    console.warn(`${file}: ${e instanceof Error ? e.message : String(e)} — no dev tools loaded`);
    return [];
  }
}

const isSpec = (v: unknown): v is ToolSpec => {
  if (typeof v !== "object" || v === null) return false;
  const s = v as Record<string, unknown>;
  return (
    typeof s["name"] === "string" &&
    s["name"] !== "" &&
    typeof s["command"] === "string" &&
    s["command"] !== "" &&
    (s["args"] === undefined || (Array.isArray(s["args"]) && s["args"].every((a) => typeof a === "string"))) &&
    (s["cwd"] === undefined || typeof s["cwd"] === "string") &&
    (s["port"] === undefined || typeof s["port"] === "number")
  );
};
