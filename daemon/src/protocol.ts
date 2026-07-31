// Single source of truth for every WebSocket message shape.

// Client → daemon. Every request has a client-chosen id echoed in the response.
export type ClientMsg =
  | { type: "auth"; token: string }
  | { type: "req"; id: string; method: "sessions.list" }
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
  | { type: "req"; id: string; method: "power.abortReboot" };

// Daemon → client.
export type ServerMsg =
  | { type: "auth.ok"; version: string }
  | { type: "res"; id: string; ok: true; data: unknown }
  | { type: "res"; id: string; ok: false; error: string }
  | { type: "event"; event: PushEvent };

export type SessionStatus = "running" | "waiting_on_user" | "idle" | "dead";

// A row of sessions.list — also the on-disk manifest entry shape.
export interface SessionRow {
  sessionId: string;
  agent: "claude";
  cwd: string;
  title: string;
  status: SessionStatus;
  updatedAt: string; // ISO
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

// Everything the daemon can push over the "event" channel.
export type PushEvent = SessionEvent | MachineEvent;

const str = (v: unknown): boolean => typeof v === "string";
const num = (v: unknown): boolean => typeof v === "number";

// Method whitelist and params validator in one: an unlisted method has no entry,
// and a listed one must match its shape or the ClientMsg type would be a lie.
// A Map, not an object — a plain object would resolve method: "constructor" to
// an inherited callable and wave the request through.
const METHODS = new Map<string, (p: any) => boolean>([
  ["sessions.list", () => true],
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
