import { closeSync, fstatSync, openSync, readdirSync, readSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { SessionStatus } from "../protocol.js";
import type { Agent, Project, Thread } from "../protocol.js";

// Every Claude and Codex session on this machine, read from the stores the
// desktop apps themselves write. Nothing here is invented: the daemon is a
// second reader of the same files, so the phone and the desktop can never
// disagree about what exists.
//
// The load-bearing fact, verified against months of real transcripts on OMEN16:
// **both agents fork on resume.** Resuming writes a NEW file under a NEW id and
// copies the parent's history into it. Two writers therefore never share a file,
// which is why this module needs no lock and no ownership handshake — and why it
// must stitch forks back together, or one conversation reads as four.

// Head/tail window per transcript. A transcript can be 14 MB; everything this
// module needs lives at one end or the other, so it never parses the middle.
const CHUNK = 64 * 1024;

// Machine-made working directories: scratchpads, worktrees, per-agent workspace
// copies. Real, reachable, but they must not be what the list opens on.
const GENERATED = /[\\/](?:AppData[\\/]Local[\\/]Temp|\.claude-worktrees|data[\\/]workspaces|node_modules)(?:[\\/]|$)/i;

/** First and last `CHUNK` bytes of a file, as text. They overlap on a small
 *  file, which costs one duplicate read and keeps the callers branch-free. */
function edges(file: string): { head: string; tail: string } {
  const fd = openSync(file, "r");
  try {
    const size = fstatSync(fd).size;
    const len = Math.min(CHUNK, size);
    const head = Buffer.alloc(len);
    readSync(fd, head, 0, len, 0);
    const tail = Buffer.alloc(len);
    readSync(fd, tail, 0, len, size - len);
    return { head: head.toString("utf8"), tail: tail.toString("utf8") };
  } finally {
    closeSync(fd);
  }
}

// Field readers work on raw text, not JSON.parse: a 64 KB window slices lines in
// half, and one truncated line must not lose the whole window. The value is
// captured *with* its quotes and parsed as a JSON string, so `D:\\Mobile-access`
// unescapes correctly instead of arriving with literal backslash pairs.
const QUOTED = (key: string) => new RegExp(`"${key}":("(?:[^"\\\\]|\\\\.)*")`, "g");

function firstOf(text: string, key: string): string | null {
  const m = QUOTED(key).exec(text);
  return m ? safeParse(m[1]) : null;
}

function lastOf(text: string, key: string): string | null {
  let last: string | null = null;
  for (const m of text.matchAll(QUOTED(key))) last = m[1];
  return last === null ? null : safeParse(last);
}

// A window can end mid-escape, leaving an unparseable fragment. That is a
// truncation artefact, not corruption — drop the value rather than the file.
function safeParse(quoted: string): string | null {
  try {
    const v: unknown = JSON.parse(quoted);
    return typeof v === "string" ? v : null;
  } catch {
    return null;
  }
}

/** Sessions Claude has open right now, keyed by sessionId.
 *
 *  `~/.claude/sessions/<pid>.json` is the registry the desktop app and CLI both
 *  maintain, and it carries the status *and* the display name the desktop shows
 *  — so a live session's title needs no guessing. A file whose pid is gone is a
 *  crash leftover: the process died without cleaning up, so it is not liveness. */
export function liveClaudeSessions(home: string): Map<string, LiveClaude> {
  const out = new Map<string, LiveClaude>();
  const dir = join(home, ".claude", "sessions");
  for (const name of safeReaddir(dir)) {
    if (!name.endsWith(".json")) continue;
    const { head } = tryEdges(join(dir, name)) ?? {};
    if (head === undefined) continue;
    const sessionId = firstOf(head, "sessionId");
    const pid = Number(/"pid":(\d+)/.exec(head)?.[1]);
    if (sessionId === null || !Number.isInteger(pid) || !alive(pid)) continue;
    out.set(sessionId, {
      pid,
      name: firstOf(head, "name"),
      // "waiting" is the desktop's own word for "this session wants you".
      status: firstOf(head, "status") === "waiting" ? "waiting_on_user" : "running",
    });
  }
  return out;
}

export interface LiveClaude {
  pid: number;
  name: string | null;
  status: SessionStatus;
}

// Signal 0 tests existence without delivering anything. EPERM means the pid
// exists under another user — still alive, still not ours to claim.
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

const safeReaddir = (dir: string, recursive = false): string[] => {
  try {
    return readdirSync(dir, { recursive, encoding: "utf8" });
  } catch {
    return []; // A store that does not exist is an agent that is not installed.
  }
};

const tryEdges = (file: string): { head: string; tail: string } | null => {
  try {
    return edges(file);
  } catch {
    return null; // Deleted or locked between readdir and open.
  }
};

const mtime = (file: string): string => {
  try {
    return statSync(file).mtime.toISOString();
  } catch {
    return new Date(0).toISOString();
  }
};

// One transcript file, before forks are stitched together.
interface Leaf {
  agent: Agent;
  rootId: string;
  sessionId: string;
  cwd: string;
  title: string | null;
  status: SessionStatus;
  updatedAt: string;
}

/**
 * Claude: `~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl`.
 *
 * Lineage comes free from the fork behaviour. Because a fork copies its parent's
 * history in, the file's FIRST line carries the oldest ancestor's id and its LAST
 * line carries its own — so two 64 KB reads recover the whole chain without
 * touching the megabytes between. Verified on this machine: `632a1acb.jsonl`
 * opens on `ddd92b61` and closes on `632a1acb`.
 */
export function scanClaude(home: string, live: Map<string, LiveClaude>): Leaf[] {
  const root = join(home, ".claude", "projects");
  const out: Leaf[] = [];
  for (const project of safeReaddir(root)) {
    const dir = join(root, project);
    for (const name of safeReaddir(dir)) {
      if (!name.endsWith(".jsonl")) continue;
      const file = join(dir, name);
      const e = tryEdges(file);
      if (e === null) continue;
      // The filename is the id of record; the tail only confirms it. A file
      // whose tail was truncated mid-escape still identifies itself.
      const sessionId = basename(name, ".jsonl");
      // The FIRST cwd, not the last: a transcript records a cwd per message, and
      // a session that ran `cd` into a subfolder writes that one late. Taking the
      // last split this repo's own sessions across `D:\Mobile-access` and
      // `D:\Mobile-access\daemon` as if they were two projects. The opening cwd
      // is where the session was started, which is the project it belongs to.
      const cwd = firstOf(e.head, "cwd") ?? lastOf(e.tail, "cwd");
      // No cwd anywhere in either window means no project to file it under.
      // The directory name is a lossy encoding (a real dash and a path
      // separator both became `-`), so decoding it would invent a path.
      if (cwd === null) continue;
      const l = live.get(sessionId);
      out.push({
        agent: "claude",
        rootId: firstOf(e.head, "sessionId") ?? sessionId,
        sessionId,
        cwd: normalizeCwd(cwd),
        // Live sessions get the desktop's own display name. Otherwise the last
        // title the app wrote, then the opening prompt, then nothing — and a
        // thread with no title anywhere falls back at the stitching step.
        title: l?.name ?? lastOf(e.tail, "customTitle") ?? firstOf(e.head, "lastPrompt"),
        status: l?.status ?? "idle",
        updatedAt: mtime(file),
      });
    }
  }
  return out;
}

/**
 * Codex, from the desktop app's own thread table.
 *
 * `~/.codex/state_5.sqlite` is what the Codex UI lists from: authoritative
 * titles, the real cwd, and the `archived` flag that decides what the desktop
 * shows. Reading it is the difference between the phone agreeing with the laptop
 * and merely resembling it — 258 rows here against 1749 rollout files on disk,
 * because most rollouts are the agent's own subagent fan-out.
 *
 * Read-only, and via Node 24's built-in `node:sqlite` — no new dependency for
 * something the runtime already ships. Any failure (missing file, locked db,
 * a schema that moved under us) falls back to `scanCodexRollouts`, which reads
 * the same facts more slowly from the rollout headers.
 */
export function scanCodex(home: string): Leaf[] {
  return codexFromDb(home) ?? scanCodexRollouts(home);
}

function codexFromDb(home: string): Leaf[] | null {
  let db: DatabaseSync;
  try {
    db = new DatabaseSync(join(home, ".codex", "state_5.sqlite"), { readOnly: true });
  } catch {
    return null;
  }
  try {
    const rows = db
      .prepare(
        // `thread_source` is null on older rows, which predate subagents and are
        // therefore the owner's own threads — excluding them would hide history.
        // COALESCE because the ms columns were added later than the second ones.
        `SELECT id, rollout_path, cwd, title, name,
                COALESCE(updated_at_ms, updated_at * 1000) AS ms
           FROM threads
          WHERE archived = 0
            AND (thread_source IS NULL OR thread_source != 'subagent')`,
      )
      .all() as { id: string; rollout_path: string; cwd: string; title: string; name: string | null; ms: number }[];

    return rows.map((r) => {
      // The rollout header is the only place Codex records which thread a resume
      // grew out of — `thread_spawn_edges` exists but is empty in practice. Only
      // the threads the table lists are opened, so this is ~180 small reads and
      // not the whole store.
      const e = tryEdges(r.rollout_path);
      return {
        agent: "codex" as const,
        rootId: (e === null ? null : firstOf(e.head, "session_id")) ?? r.id,
        sessionId: r.id,
        cwd: normalizeCwd(r.cwd),
        // `name` is a name the owner typed; `title` is the one Codex derived.
        title: (r.name ?? "").trim() || r.title.trim() || null,
        status: "idle" as const,
        updatedAt: new Date(r.ms).toISOString(),
      };
    });
  } catch {
    return null;
  } finally {
    db.close();
  }
}

// Windows extended-length paths (`\\?\D:\proj`) are a Win32 API escape, not part
// of the path the owner knows — and `\\?\D:\proj` and `D:\proj` must group as one
// project, not two. Codex stores the prefixed form; Claude does not.
const normalizeCwd = (p: string): string => p.replace(/^\\\\\?\\/, "");

/**
 * Codex fallback: `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`.
 *
 * Every rollout's `session_meta` carries `session_id` (the root thread), `id`
 * (this thread) and `thread_source`. Slower and less authoritative than the
 * thread table — it cannot know what the owner archived — but it keeps the phone
 * working when the schema moves.
 */
export function scanCodexRollouts(home: string): Leaf[] {
  const root = join(home, ".codex", "sessions");
  const titles = codexTitles(home);
  const out: Leaf[] = [];
  for (const rel of safeReaddir(root, true)) {
    const name = basename(rel);
    if (!name.startsWith("rollout-") || !name.endsWith(".jsonl")) continue;
    const file = join(root, rel);
    const e = tryEdges(file);
    if (e === null) continue;
    if (firstOf(e.head, "thread_source") === "subagent") continue;
    const cwd = firstOf(e.head, "cwd");
    const sessionId = firstOf(e.head, "id");
    if (cwd === null || sessionId === null) continue;
    out.push({
      agent: "codex",
      rootId: firstOf(e.head, "session_id") ?? sessionId,
      sessionId,
      cwd,
      title: titles.get(sessionId) ?? null,
      // Codex keeps no live-pid registry the way Claude does, so a rollout on
      // disk is history. A Codex session the daemon itself owns is tracked by
      // the registry and overrides this.
      status: "idle",
      updatedAt: mtime(file),
    });
  }
  return out;
}

/** `~/.codex/session_index.jsonl`: one `{id, thread_name, updated_at}` per line.
 *  Later lines win, so a renamed thread reads under its current name. */
function codexTitles(home: string): Map<string, string> {
  const out = new Map<string, string>();
  const e = tryEdges(join(home, ".codex", "session_index.jsonl"));
  if (e === null) return out;
  // Head and tail both, so a long index still yields its newest entries.
  for (const text of new Set([e.head, e.tail])) {
    for (const line of text.split("\n")) {
      const id = firstOf(line, "id");
      const name = firstOf(line, "thread_name");
      if (id !== null && name !== null) out.set(id, name);
    }
  }
  return out;
}

/**
 * Every session on the machine, grouped by project and stitched by lineage.
 *
 * Two collapses happen here, and both exist because the raw stores answer a
 * different question than the owner asks:
 *
 * - **Forks collapse into one thread.** The desktop app lists `x`, `x (fork)`
 *   and `x (fork 2)` as three rows; they are one conversation continued three
 *   times, and the owner thinks of them as one. `resumeId` is the newest leaf,
 *   which is the only one it is meaningful to continue from.
 * - **Generated projects collapse to the bottom.** Scratchpads and worktrees are
 *   real and stay reachable, but they must not bury the dozen folders the owner
 *   actually works in.
 */
export function discover(home: string, live = liveClaudeSessions(home)): Project[] {
  const leaves = [...scanClaude(home, live), ...scanCodex(home)];

  // Stitch: agent + root id is the thread identity that survives forking.
  const threads = new Map<string, Thread>();
  for (const l of leaves) {
    const key = `${l.agent}:${l.rootId}`;
    const t = threads.get(key);
    if (t === undefined) {
      threads.set(key, {
        threadId: l.rootId,
        agent: l.agent,
        cwd: l.cwd,
        title: l.title ?? "Untitled",
        status: l.status,
        updatedAt: l.updatedAt,
        resumeId: l.sessionId,
        sessionIds: [l.sessionId],
      });
      continue;
    }
    t.sessionIds.push(l.sessionId);
    // A thread is as alive as its liveliest fork, and as recent as its newest
    // one. Title and resume target follow the newest leaf: an older fork's
    // title is a stale name for a conversation that has moved on.
    if (l.status !== "idle") t.status = l.status;
    if (l.updatedAt > t.updatedAt) {
      t.updatedAt = l.updatedAt;
      t.resumeId = l.sessionId;
      t.cwd = l.cwd;
      if (l.title !== null) t.title = l.title;
    }
  }

  // Group by working directory. Case-insensitive: Windows hands back the same
  // folder under whatever casing the caller typed, and `d:\proj` and `D:\proj`
  // are one project.
  const projects = new Map<string, Project>();
  for (const t of threads.values()) {
    const key = t.cwd.toLowerCase();
    let p = projects.get(key);
    if (p === undefined) {
      p = { path: t.cwd, name: basename(t.cwd) || t.cwd, generated: GENERATED.test(t.cwd), threadCount: 0, threads: [] };
      projects.set(key, p);
    }
    p.threads.push(t);
  }

  for (const p of projects.values()) {
    p.threads.sort(newestFirst);
    p.threadCount = p.threads.length;
  }
  return [...projects.values()].sort(
    (a, b) =>
      // Generated projects sink as a block; within a block, the project touched
      // most recently leads.
      Number(a.generated) - Number(b.generated) || newestFirst(a.threads[0], b.threads[0]),
  );
}

// ISO-8601 with a fixed offset sorts lexically — the same trick the app's
// groups.ts relies on, and the reason nothing here calls Date.parse per compare.
const newestFirst = (a: { updatedAt: string }, b: { updatedAt: string }): number =>
  a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0;

/** Absolute path of every project found, for `allowedRoots`. Sessions the owner
 *  can see must also be sessions whose files the owner can open. */
export const discoveredRoots = (projects: Project[]): string[] => projects.map((p) => p.path);
