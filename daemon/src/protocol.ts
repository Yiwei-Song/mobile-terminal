// Single source of truth for every WebSocket message shape.

// Client → daemon. Every request has a client-chosen id echoed in the response.
export type ClientMsg =
  | { type: "auth"; token: string }
  | { type: "req"; id: string; method: "sessions.list" }
  | { type: "req"; id: string; method: "sessions.projects" }
  | { type: "req"; id: string; method: "sessions.new"; params: { cwd: string; prompt: string; title?: string } }
  | { type: "req"; id: string; method: "sessions.send"; params: { sessionId: string; text: string } }
  | { type: "req"; id: string; method: "sessions.interrupt"; params: { sessionId: string } }
  | { type: "req"; id: string; method: "sessions.approve"; params: { sessionId: string; requestId: string; allow: boolean } }
  | { type: "req"; id: string; method: "sessions.pending" }
  | { type: "req"; id: string; method: "config.get" }
  | { type: "req"; id: string; method: "config.set"; params: { ntfyTopic: string | null } }
  | { type: "req"; id: string; method: "system.metrics" }
  | { type: "req"; id: string; method: "system.processes" }
  | { type: "req"; id: string; method: "system.kill"; params: { pid: number } }
  | { type: "req"; id: string; method: "power.state" }
  | { type: "req"; id: string; method: "power.keepAwake"; params: { on: boolean } }
  | { type: "req"; id: string; method: "power.lock" }
  | { type: "req"; id: string; method: "power.reboot"; params: { delaySec: number } }
  | { type: "req"; id: string; method: "power.abortReboot" }
  | { type: "req"; id: string; method: "term.list" }
  | { type: "req"; id: string; method: "term.create"; params: { cwd: string; cols: number; rows: number } }
  | { type: "req"; id: string; method: "term.write"; params: { termId: string; data: string } }
  | { type: "req"; id: string; method: "term.resize"; params: { termId: string; cols: number; rows: number } }
  | { type: "req"; id: string; method: "term.kill"; params: { termId: string } }
  | { type: "req"; id: string; method: "term.scrollback"; params: { termId: string } }
  | { type: "req"; id: string; method: "files.roots" }
  | { type: "req"; id: string; method: "files.list"; params: { dir: string } }
  | { type: "req"; id: string; method: "files.read"; params: { path: string } }
  | { type: "req"; id: string; method: "git.status"; params: { cwd: string } }
  | { type: "req"; id: string; method: "git.diff"; params: { cwd: string; file?: string } }
  | { type: "req"; id: string; method: "ports.list" }
  | { type: "req"; id: string; method: "tools.list" }
  | { type: "req"; id: string; method: "tools.start"; params: { name: string } }
  | { type: "req"; id: string; method: "tools.stop"; params: { name: string } };

// Daemon → client.
export type ServerMsg =
  | { type: "auth.ok"; version: string }
  | { type: "res"; id: string; ok: true; data: unknown }
  | { type: "res"; id: string; ok: false; error: string }
  | { type: "event"; event: PushEvent };

export type SessionStatus = "running" | "waiting_on_user" | "idle" | "dead";

export type Agent = "claude" | "codex";

// A row of sessions.list — also the on-disk manifest entry shape.
export interface SessionRow {
  sessionId: string;
  agent: Agent;
  cwd: string;
  title: string;
  status: SessionStatus;
  updatedAt: string; // ISO
}

// One conversation, however many times it has been resumed.
//
// Both agents fork on resume — a resumed session is a new file under a new id
// with its parent's history copied in — so the ids that make up one continuous
// conversation are a chain, not a single value. `threadId` is the oldest
// ancestor and never moves; `resumeId` is the newest leaf and is the only id it
// is meaningful to continue from. See sessions/discover.ts.
export interface Thread {
  threadId: string;
  agent: Agent;
  cwd: string;
  title: string;
  status: SessionStatus;
  updatedAt: string; // ISO
  resumeId: string;
  sessionIds: string[];
}

// A working directory and every thread in it. `generated` marks the machine-made
// ones — scratchpads, worktrees, per-agent workspace copies — which stay
// reachable but must not be what the list opens on.
export interface Project {
  path: string;
  name: string;
  generated: boolean;
  // How many threads this project really has. `threads` may be truncated to the
  // newest few for the wire — one folder on this machine holds 1532 sessions from
  // an automation run — so the count is carried separately and the app can say
  // "showing 50 of 1532" instead of quietly pretending fifty is all of them.
  threadCount: number;
  threads: Thread[];
}

// Machine metrics for the mobile System screen. Defined here (not in system.ts)
// because system.ts type-imports `systeminformation`, and the app re-exports the
// wire protocol through shared/ — pulling that hardware dep into the phone's type
// graph would break its build. system.ts imports these back from here.
export interface Metrics {
  cpuPct: number; // 0-100 overall
  mem: { usedGb: number; totalGb: number; pct: number };
  disks: { mount: string; usedGb: number; totalGb: number; pct: number }[];
  uptimeSec: number;
}
export interface Proc {
  pid: number;
  name: string;
  cpuPct: number;
  memMb: number;
}

// The reply to both config.get and config.set — a set answers with the state it
// produced, so the phone never has to ask twice.
export interface ConfigInfo {
  ntfyTopic: string | null;
  version: string;
  hostname: string;
}

export type SessionEvent =
  | { kind: "session.status"; sessionId: string; status: SessionStatus; title: string }
  | { kind: "session.text"; sessionId: string; role: "assistant" | "user"; text: string }
  | { kind: "session.tool"; sessionId: string; name: string; summary: string }
  | PermissionEvent
  | { kind: "session.done"; sessionId: string; ok: boolean; costUsd: number | null };

// The one event that outlives its push: fired once, but a phone that was away
// recovers it via sessions.pending. Named so both the daemon's recoverable set
// and that RPC's return share a shape.
export type PermissionEvent = { kind: "session.permission"; sessionId: string; requestId: string; toolName: string; summary: string; cwd: string };

// Not a session event — it has no sessionId, it's about the host. Pushed once
// when power.reboot schedules a shutdown so the app can count down. The event
// channel carries both; ntfyFor ignores it (nothing to notify — the phone that
// asked for the reboot already knows).
export type MachineEvent = { kind: "machine.reboot"; delaySec: number };

// A row of term.list / term.create's answer. Lives here, not in term.ts, for the
// same reason Metrics does: shared/protocol.ts re-exports this file into the
// app's type graph, and term.ts's node imports have no business going there.
// term.ts imports it back.
export interface TermInfo {
  termId: string;
  title: string;
  cwd: string;
  cols: number;
  rows: number;
}

// A row of files.list and of ports.list. Same reason as Metrics/TermInfo: the
// app re-exports this file, and files.ts/ports.ts import node builtins that have
// no place in the phone's type graph. Those modules import these back.
export interface Entry {
  name: string;
  path: string;
  dir: boolean;
  size: number; // 0 for directories
}
export interface Port {
  port: number;
  pid: number;
  process: string; // "?" when the pid has no tasklist row
  // False for Windows' own plumbing (RPC, SMB, lsass/svchost/System, the
  // ephemeral RPC range) — none of it speaks HTTP, so a phone that taps it gets
  // a blank frame. The picker leads with the true ones and hides the rest
  // behind "show all"; see ports.ts for the rule.
  dev: boolean;
}

// A long-running dev service the phone can start/stop: the spec is what the user
// declared in <dataDir>/tools.json, the status is what tools.* answers with.
// Here for the same reason as the three above — tools.ts imports them back.
export interface ToolSpec {
  name: string;
  command: string;
  args?: string[];
  cwd?: string;
  port?: number; // what it will be listening on, when the user knows
}
export interface ToolStatus {
  name: string;
  running: boolean;
  pid?: number;
  port?: number;
}

// Terminal output and death. Not session events — a pty has no sessionId, and
// only the WebView terminal page consumes these.
export type TermEvent =
  | { kind: "term.data"; termId: string; data: string }
  | { kind: "term.exit"; termId: string; code: number };

// Everything the daemon can push over the "event" channel.
export type PushEvent = SessionEvent | MachineEvent | TermEvent;

const str = (v: unknown): boolean => typeof v === "string";
const num = (v: unknown): boolean => typeof v === "number";
// A terminal dimension: a pty rejects fractions and a bogus 100_000 would make
// it allocate a screen buffer nobody asked for. Bounded here, at the wire.
const dim = (v: unknown): boolean => Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 1000;

// Method whitelist and params validator in one: an unlisted method has no entry,
// and a listed one must match its shape or the ClientMsg type would be a lie.
// A Map, not an object — a plain object would resolve method: "constructor" to
// an inherited callable and wave the request through.
const METHODS = new Map<string, (p: any) => boolean>([
  ["sessions.list", () => true],
  ["sessions.projects", () => true],
  ["sessions.new", (p) => str(p?.cwd) && str(p?.prompt) && (p.title === undefined || str(p.title))],
  ["sessions.send", (p) => str(p?.sessionId) && str(p?.text)],
  ["sessions.interrupt", (p) => str(p?.sessionId)],
  ["sessions.approve", (p) => str(p?.sessionId) && str(p?.requestId) && typeof p?.allow === "boolean"],
  ["sessions.pending", () => true],
  ["config.get", () => true],
  // Explicit null clears the topic; an absent key is a malformed request, not
  // a silent "leave it alone" — the ClientMsg type promises the field is there.
  ["config.set", (p) => p?.ntfyTopic === null || str(p?.ntfyTopic)],
  ["system.metrics", () => true],
  ["system.processes", () => true],
  ["system.kill", (p) => num(p?.pid)],
  ["power.state", () => true],
  ["power.keepAwake", (p) => typeof p?.on === "boolean"],
  ["power.lock", () => true],
  // Any number passes the wire check; the handler clamps out-of-range/NaN. JSON
  // can't carry NaN, so a real request only ever sends a finite delaySec here.
  ["power.reboot", (p) => num(p?.delaySec)],
  ["power.abortReboot", () => true],
  ["term.list", () => true],
  ["term.create", (p) => str(p?.cwd) && dim(p?.cols) && dim(p?.rows)],
  ["term.write", (p) => str(p?.termId) && str(p?.data)],
  ["term.resize", (p) => str(p?.termId) && dim(p?.cols) && dim(p?.rows)],
  ["term.kill", (p) => str(p?.termId)],
  ["term.scrollback", (p) => str(p?.termId)],
  // The path itself is only checked for being a string here; whether it is
  // *reachable* is files.ts's guard, which needs the roots this layer has not
  // got. A non-string would crash path.resolve before ever reaching it.
  ["files.roots", () => true],
  ["files.list", (p) => str(p?.dir)],
  ["files.read", (p) => str(p?.path)],
  ["git.status", (p) => str(p?.cwd)],
  ["git.diff", (p) => str(p?.cwd) && (p.file === undefined || str(p.file))],
  ["ports.list", () => true],
  // The name indexes a spec the USER wrote into tools.json — an unknown one is
  // refused by the runner, so nothing off the wire ever becomes a command line.
  ["tools.list", () => true],
  ["tools.start", (p) => str(p?.name)],
  ["tools.stop", (p) => str(p?.name)],
]);

export function parseClientMsg(raw: string): ClientMsg | null {
  let m: any;
  try {
    m = JSON.parse(raw);
  } catch {
    return null;
  }
  if (m?.type === "auth" && str(m.token)) return m;
  if (m?.type === "req" && str(m.id) && METHODS.get(m.method)?.(m.params) === true) return m;
  return null;
}
