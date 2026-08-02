import type { SessionRow } from "@shared/protocol";

// The sessions list, as three questions rather than one flat feed: what needs
// me, what is running for me, what is over. Pure — the screen only renders it.
// Type-only import, so nothing here needs a bundler to run under vitest.

export interface Groups {
  needsYou: SessionRow[];
  working: SessionRow[];
  recent: SessionRow[];
}

const groupOf = (s: SessionRow): keyof Groups =>
  s.status === "waiting_on_user" ? "needsYou" : s.status === "running" ? "working" : "recent";

// ISO-8601 with a fixed offset sorts lexically, which is the whole point of the
// format: no Date.parse per comparison.
const newestFirst = (a: SessionRow, b: SessionRow): number => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0);

/** The rows split three ways, each newest-first. Empty groups stay empty arrays;
 *  the screen decides that an empty group has no section header. */
export function groupSessions(rows: SessionRow[]): Groups {
  const out: Groups = { needsYou: [], working: [], recent: [] };
  for (const r of rows) out[groupOf(r)].push(r);
  out.needsYou.sort(newestFirst);
  out.working.sort(newestFirst);
  out.recent.sort(newestFirst);
  return out;
}

/**
 * Has this session moved since you last looked at it? A session you are reading
 * right now (`openId`) is never unread — the dot would appear the moment its
 * own event arrived, on the screen already showing that event.
 *
 * No mark at all reads as "" — everything sorts after it, so an unseen session
 * with any timestamp is unread.
 */
export const isUnread = (row: SessionRow, lastSeen: Record<string, string>, openId?: string): boolean =>
  row.sessionId !== openId && row.updatedAt > (lastSeen[row.sessionId] ?? "");

/** Case-insensitive substring over what a person would type: the title, or the
 *  folder. A blank query is not a filter. */
export function filterSessions(rows: SessionRow[], query: string): SessionRow[] {
  const q = query.trim().toLowerCase();
  if (q === "") return rows;
  return rows.filter((r) => r.title.toLowerCase().includes(q) || r.cwd.toLowerCase().includes(q));
}

/**
 * Age at a glance: "now" under a minute, then "5m", "3h", "2d". `now` is passed
 * in rather than read, so the boundaries are testable and a list can render
 * every row against one clock. A future timestamp reads as "now".
 */
export function relativeTime(iso: string, now: Date): string {
  const sec = Math.floor((now.getTime() - Date.parse(iso)) / 1000);
  if (!Number.isFinite(sec) || sec < 60) return "now";
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}
