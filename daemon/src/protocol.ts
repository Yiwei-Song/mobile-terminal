// Single source of truth for every WebSocket message shape.

// Client → daemon. Every request has a client-chosen id echoed in the response.
export type ClientMsg =
  | { type: "auth"; token: string }
  | { type: "req"; id: string; method: "sessions.list" }
  | { type: "req"; id: string; method: "sessions.new"; params: { cwd: string; prompt: string; title?: string } }
  | { type: "req"; id: string; method: "sessions.send"; params: { sessionId: string; text: string } }
  | { type: "req"; id: string; method: "sessions.interrupt"; params: { sessionId: string } }
  | { type: "req"; id: string; method: "sessions.approve"; params: { sessionId: string; requestId: string; allow: boolean } };

// Daemon → client.
export type ServerMsg =
  | { type: "auth.ok"; version: string }
  | { type: "res"; id: string; ok: true; data: unknown }
  | { type: "res"; id: string; ok: false; error: string }
  | { type: "event"; event: SessionEvent };

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

export type SessionEvent =
  | { kind: "session.status"; sessionId: string; status: SessionStatus; title: string }
  | { kind: "session.text"; sessionId: string; role: "assistant" | "user"; text: string }
  | { kind: "session.tool"; sessionId: string; name: string; summary: string }
  | { kind: "session.permission"; sessionId: string; requestId: string; toolName: string; summary: string; cwd: string }
  | { kind: "session.done"; sessionId: string; ok: boolean; costUsd: number | null };

const str = (v: unknown): boolean => typeof v === "string";

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
