import { describe, it, expect } from "vitest";
import type { SessionRow } from "@shared/protocol";

import { filterSessions, groupSessions, isUnread, relativeTime } from "../src/lib/groups";

const row = (sessionId: string, status: SessionRow["status"], updatedAt: string, extra: Partial<SessionRow> = {}): SessionRow => ({
  sessionId,
  agent: "claude",
  cwd: "D:\\projects\\api-server",
  title: "Add refresh-token rotation",
  status,
  updatedAt,
  ...extra,
});

describe("groupSessions", () => {
  it("splits by status and sorts each group newest-first", () => {
    const g = groupSessions([
      row("a", "idle", "2026-08-02T10:00:00.000Z"),
      row("b", "waiting_on_user", "2026-08-02T09:00:00.000Z"),
      row("c", "running", "2026-08-02T08:00:00.000Z"),
      row("d", "dead", "2026-08-02T11:00:00.000Z"),
      row("e", "running", "2026-08-02T12:00:00.000Z"),
      row("f", "waiting_on_user", "2026-08-02T13:00:00.000Z"),
    ]);
    expect(g.needsYou.map((s) => s.sessionId)).toEqual(["f", "b"]);
    expect(g.working.map((s) => s.sessionId)).toEqual(["e", "c"]);
    // idle and dead share the group; only recency orders them.
    expect(g.recent.map((s) => s.sessionId)).toEqual(["d", "a"]);
  });

  it("gives empty groups rather than missing keys", () => {
    expect(groupSessions([])).toEqual({ needsYou: [], working: [], recent: [] });
  });

  it("does not mutate the input order", () => {
    const rows = [row("a", "idle", "2026-08-02T10:00:00.000Z"), row("b", "idle", "2026-08-02T11:00:00.000Z")];
    groupSessions(rows);
    expect(rows.map((s) => s.sessionId)).toEqual(["a", "b"]);
  });
});

describe("isUnread", () => {
  const r = row("a", "running", "2026-08-02T10:00:00.000Z");

  it("is true when there is no mark for the session", () => {
    expect(isUnread(r, {})).toBe(true);
  });

  it("compares ISO strings lexically", () => {
    // Same instant, one digit apart in the string: the comparison is textual.
    expect(isUnread(r, { a: "2026-08-02T09:59:59.999Z" })).toBe(true);
    expect(isUnread(r, { a: "2026-08-02T10:00:00.000Z" })).toBe(false);
    expect(isUnread(r, { a: "2026-08-02T10:00:00.001Z" })).toBe(false);
    // Year/month/day carry the ordering too, not just the time part.
    expect(isUnread(r, { a: "2026-07-31T23:59:59.999Z" })).toBe(true);
    expect(isUnread(r, { a: "2026-08-03T00:00:00.000Z" })).toBe(false);
  });

  it("never marks the session you are looking at", () => {
    expect(isUnread(r, {}, "a")).toBe(false);
    expect(isUnread(r, {}, "b")).toBe(true);
  });

  it("ignores marks belonging to other sessions", () => {
    expect(isUnread(r, { b: "2027-01-01T00:00:00.000Z" })).toBe(true);
  });
});

describe("filterSessions", () => {
  const rows = [
    row("a", "running", "2026-08-02T10:00:00.000Z", { title: "Fix the flaky checkout spec", cwd: "D:\\projects\\web-dashboard" }),
    row("b", "idle", "2026-08-02T10:00:00.000Z", { title: "Move staging onto the new node pool", cwd: "D:\\infra\\terraform" }),
  ];

  it("returns the rows unchanged for an empty or whitespace query", () => {
    expect(filterSessions(rows, "")).toBe(rows);
    expect(filterSessions(rows, "   ")).toBe(rows);
  });

  it("matches title and cwd case-insensitively", () => {
    expect(filterSessions(rows, "CHECKOUT").map((s) => s.sessionId)).toEqual(["a"]);
    expect(filterSessions(rows, "terraform").map((s) => s.sessionId)).toEqual(["b"]);
    expect(filterSessions(rows, "projects").map((s) => s.sessionId)).toEqual(["a"]);
    expect(filterSessions(rows, "nothing here").map((s) => s.sessionId)).toEqual([]);
  });
});

describe("relativeTime", () => {
  const now = new Date("2026-08-02T12:00:00.000Z");
  const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();

  it("pins the boundaries", () => {
    expect(relativeTime(ago(0), now)).toBe("now");
    expect(relativeTime(ago(59_000), now)).toBe("now");
    expect(relativeTime(ago(60_000), now)).toBe("1m");
    expect(relativeTime(ago(59 * 60_000), now)).toBe("59m");
    expect(relativeTime(ago(60 * 60_000), now)).toBe("1h");
    expect(relativeTime(ago(23 * 3_600_000), now)).toBe("23h");
    expect(relativeTime(ago(24 * 3_600_000), now)).toBe("1d");
    expect(relativeTime(ago(90 * 3_600_000), now)).toBe("3d");
  });

  it("reads a clock-skewed future timestamp as now, never a negative age", () => {
    expect(relativeTime(new Date(now.getTime() + 60_000).toISOString(), now)).toBe("now");
  });

  it("says now rather than NaN for an unparseable timestamp", () => {
    expect(relativeTime("not a date", now)).toBe("now");
  });
});
