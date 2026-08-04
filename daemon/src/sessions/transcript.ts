import { closeSync, existsSync, fstatSync, openSync, readdirSync, readSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Agent, TranscriptEntry } from "../protocol.js";
import { summarize } from "./claude.js";

// Conversation history, read from the agents' own transcript files.
//
// Until now a transcript existed only as the events this daemon happened to
// push, so a daemon restart showed an empty conversation and a session started
// on the desktop showed nothing at all. The history was never missing — it was
// on disk the whole time, in the file the agent writes as it goes.
//
// Read from the END. A transcript is opened to see what just happened, and the
// newest turn is the last line; paging backwards is what LOAD OLDER is for.

// Bytes of tail to parse per request. A single turn with a big tool result runs
// to tens of KB, so this comfortably covers the ~50 entries a phone renders
// without pulling a 14 MB file through memory.
const TAIL = 1024 * 1024;

/** Last `bytes` of a file as text, with the leading partial line dropped —
 *  a window that starts mid-line would otherwise fail one JSON.parse and, worse,
 *  could half-parse into a wrong-looking entry. */
function tailLines(file: string, bytes: number): string[] {
  const fd = openSync(file, "r");
  try {
    const size = fstatSync(fd).size;
    const len = Math.min(bytes, size);
    const buf = Buffer.alloc(len);
    readSync(fd, buf, 0, len, size - len);
    const lines = buf.toString("utf8").split("\n");
    // Only when the window actually cut the file: a full read starts on a real
    // line boundary and dropping its first line would lose the opening turn.
    if (len < size) lines.shift();
    return lines;
  } finally {
    closeSync(fd);
  }
}

/**
 * The newest `limit` entries of a session's transcript, oldest-first for
 * rendering. Returns [] for a session with no readable file — a conversation
 * that cannot be read is empty, not an error, and the screen already has an
 * empty state.
 */
export function readTranscript(home: string, agent: Agent, sessionId: string, limit = 50): TranscriptEntry[] {
  const file = agent === "claude" ? claudeFile(home, sessionId) : codexFile(home, sessionId);
  if (file === null) return [];
  let lines: string[];
  try {
    lines = tailLines(file, TAIL);
  } catch {
    return [];
  }
  const parse = agent === "claude" ? claudeEntry : codexEntry;
  const out: TranscriptEntry[] = [];
  for (const line of lines) {
    if (line.trim() === "") continue;
    let o: unknown;
    try {
      o = JSON.parse(line);
    } catch {
      continue; // A torn last line while the agent is mid-write. Skip it, keep the rest.
    }
    out.push(...parse(o as Record<string, any>));
  }
  return out.slice(-limit);
}

/** `~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl`. The directory name is a
 *  lossy encoding of the cwd, so the file is found by looking rather than by
 *  reconstructing a path that would be wrong for any folder containing a dash. */
function claudeFile(home: string, sessionId: string): string | null {
  const root = join(home, ".claude", "projects");
  let dirs: string[];
  try {
    dirs = readdirSync(root);
  } catch {
    return null;
  }
  for (const d of dirs) {
    const f = join(root, d, `${sessionId}.jsonl`);
    if (existsSync(f)) return f;
  }
  return null;
}

/** Codex records the rollout path in its own thread table, which saves walking a
 *  date-partitioned tree of ~1700 files. The walk is the fallback. */
function codexFile(home: string, sessionId: string): string | null {
  try {
    const db = new DatabaseSync(join(home, ".codex", "state_5.sqlite"), { readOnly: true });
    try {
      const row = db.prepare("SELECT rollout_path FROM threads WHERE id = ?").get(sessionId) as { rollout_path: string } | undefined;
      if (row !== undefined && existsSync(row.rollout_path)) return row.rollout_path;
    } finally {
      db.close();
    }
  } catch {
    // Fall through to the walk.
  }
  const root = join(home, ".codex", "sessions");
  try {
    for (const rel of readdirSync(root, { recursive: true, encoding: "utf8" })) {
      if (rel.endsWith(`${sessionId}.jsonl`)) return join(root, rel);
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * One Claude transcript line.
 *
 * Thinking blocks and tool results are dropped: thinking is the model talking to
 * itself, and a tool result is the output the tool call above it already
 * announced — on a phone both are scroll, not information. Tool *calls* stay,
 * rendered by the same `summarize` the live event path uses, so replayed history
 * and a live turn are indistinguishable.
 */
function claudeEntry(o: Record<string, any>): TranscriptEntry[] {
  const content = o?.["message"]?.["content"];
  if (o?.["type"] === "user") {
    // A string is a real prompt; an array is tool results the SDK folds into a
    // user turn, which is machine output wearing the user's name.
    return typeof content === "string" && content.trim() !== "" ? [{ kind: "text", role: "user", text: content }] : [];
  }
  if (o?.["type"] !== "assistant" || !Array.isArray(content)) return [];
  const out: TranscriptEntry[] = [];
  for (const b of content as Record<string, any>[]) {
    if (b["type"] === "text" && typeof b["text"] === "string" && b["text"].trim() !== "") {
      out.push({ kind: "text", role: "assistant", text: b["text"] });
    } else if (b["type"] === "tool_use" && typeof b["name"] === "string") {
      out.push({ kind: "tool", name: b["name"], summary: summarize(b["name"], b["input"] as Record<string, unknown>) });
    }
  }
  return out;
}

/**
 * One Codex rollout line.
 *
 * `role: "developer"` is Codex's own preamble (app context, permissions,
 * collaboration mode) — instructions the harness injected, not anything the
 * owner said, so it is not conversation. Reasoning and token-count events are
 * dropped for the same reason thinking is on the Claude side.
 */
function codexEntry(o: Record<string, any>): TranscriptEntry[] {
  const p = o?.["payload"];
  if (o?.["type"] !== "response_item" || p == null) return [];

  if (p["type"] === "message") {
    const role: unknown = p["role"];
    if (role !== "user" && role !== "assistant") return [];
    const text = (Array.isArray(p["content"]) ? (p["content"] as Record<string, any>[]) : [])
      .filter((c) => c["type"] === "input_text" || c["type"] === "output_text")
      .map((c) => (typeof c["text"] === "string" ? c["text"] : ""))
      .join("")
      .trim();
    // Codex also injects preambles as `user` input_text, always wrapped in an
    // XML-ish tag (`<app-context>`, `<permissions instructions>`). A real prompt
    // starting with "<" is rare enough that dropping it beats showing every
    // session's boilerplate as the owner's own words.
    if (text === "" || (role === "user" && text.startsWith("<"))) return [];
    return [{ kind: "text", role, text }];
  }

  if (p["type"] === "custom_tool_call" || p["type"] === "function_call") {
    const name = typeof p["name"] === "string" ? p["name"] : "tool";
    const input: unknown = p["input"] ?? p["arguments"];
    return [{ kind: "tool", name, summary: summarize(name, typeof input === "string" ? { command: input } : (input as Record<string, unknown>)) }];
  }
  return [];
}
