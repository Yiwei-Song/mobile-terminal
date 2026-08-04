import { describe, it, expect } from "vitest";
import type { Project, Thread } from "@shared/protocol";
import {
  filterProjects,
  hiddenThreads,
  initialExpanded,
  PREVIEW_THREADS,
  previewThreads,
  projectNeedsYou,
  projectRunning,
  resumeCount,
  splitProjects,
} from "../src/lib/projects";

const thread = (o: Partial<Thread> & { threadId: string }): Thread => ({
  agent: "claude",
  cwd: "D:\\Proj",
  title: o.threadId,
  status: "idle",
  updatedAt: "2026-08-04T10:00:00.000Z",
  resumeId: o.threadId,
  sessionIds: [o.threadId],
  ...o,
});

const project = (o: Partial<Project> & { path: string }): Project => ({
  name: o.path.split("\\").pop() ?? o.path,
  generated: false,
  threads: [],
  threadCount: o.threads?.length ?? 0,
  ...o,
});

describe("projects", () => {
  it("splits real projects from machine-generated ones", () => {
    const s = splitProjects([
      project({ path: "D:\\Real" }),
      project({ path: "C:\\Temp\\scratch", generated: true }),
    ]);
    expect(s.real.map((p) => p.path)).toEqual(["D:\\Real"]);
    expect(s.generated.map((p) => p.path)).toEqual(["C:\\Temp\\scratch"]);
  });

  // Matching the folder means "show me this project", so its threads all stay.
  it("keeps every thread when the project name matches", () => {
    const p = project({ path: "D:\\Mobile-access", threads: [thread({ threadId: "a" }), thread({ threadId: "b" })], threadCount: 2 });
    const [out] = filterProjects([p], "mobile");
    expect(out.threads).toHaveLength(2);
  });

  // Matching only through a thread narrows to the hit — otherwise the thing you
  // searched for is buried among siblings that did not match.
  it("narrows to matching threads when only a thread matches, and tells the truth about the count", () => {
    const p = project({
      path: "D:\\Proj",
      threads: [thread({ threadId: "a", title: "Fix login bug" }), thread({ threadId: "b", title: "Write docs" })],
      threadCount: 40,
    });
    const [out] = filterProjects([p], "login");
    expect(out.threads.map((t) => t.threadId)).toEqual(["a"]);
    // Not 40: "1 of 40" would be a lie about a filtered view.
    expect(out.threadCount).toBe(1);
  });

  it("drops a project nothing in it matched, and treats a blank query as no filter", () => {
    const ps = [project({ path: "D:\\Proj", threads: [thread({ threadId: "a", title: "Docs" })], threadCount: 1 })];
    expect(filterProjects(ps, "nothing here")).toEqual([]);
    expect(filterProjects(ps, "   ")).toEqual(ps);
  });

  it("matches case-insensitively on the path as well as the name", () => {
    const ps = [project({ path: "D:\\Authenry\\Projects\\Pilot" })];
    expect(filterProjects(ps, "AUTHENRY")).toHaveLength(1);
  });

  it("summarises what is happening inside a collapsed project", () => {
    const p = project({
      path: "D:\\Proj",
      threads: [thread({ threadId: "a", status: "waiting_on_user" }), thread({ threadId: "b", status: "running" }), thread({ threadId: "c" })],
      threadCount: 3,
    });
    expect(projectNeedsYou(p)).toBe(true);
    expect(projectRunning(p)).toBe(1);
    expect(projectNeedsYou(project({ path: "D:\\Q" }))).toBe(false);
  });

  // Opening on sixty collapsed rows makes the user work before they can read
  // anything; opening all of them buries the top.
  it("expands anything waiting, plus the first real project", () => {
    const ps = [
      project({ path: "D:\\First", threads: [thread({ threadId: "a" })], threadCount: 1 }),
      project({ path: "D:\\Quiet", threads: [thread({ threadId: "b" })], threadCount: 1 }),
      project({ path: "D:\\Waiting", threads: [thread({ threadId: "c", status: "waiting_on_user" })], threadCount: 1 }),
    ];
    expect(initialExpanded(ps, false)).toEqual(new Set(["D:\\Waiting", "D:\\First"]));
  });

  it("expands everything while searching, and skips generated when picking the default", () => {
    const ps = [
      project({ path: "C:\\Temp\\gen", generated: true, threads: [thread({ threadId: "g" })], threadCount: 1 }),
      project({ path: "D:\\Real", threads: [thread({ threadId: "r" })], threadCount: 1 }),
    ];
    expect(initialExpanded(ps, true)).toEqual(new Set(["C:\\Temp\\gen", "D:\\Real"]));
    // The generated project sorts first here but must not be the one opened.
    expect(initialExpanded(ps, false)).toEqual(new Set(["D:\\Real"]));
  });

  it("falls back to a generated project only when there is no real one", () => {
    const ps = [project({ path: "C:\\Temp\\gen", generated: true, threads: [thread({ threadId: "g" })], threadCount: 1 })];
    expect(initialExpanded(ps, false)).toEqual(new Set(["C:\\Temp\\gen"]));
    expect(initialExpanded([], false)).toEqual(new Set());
  });

  // The daemon sends the newest few and the true total; the gap must be owned up
  // to, not silently presented as everything.
  it("reports how many threads the daemon truncated", () => {
    expect(hiddenThreads(project({ path: "D:\\P", threads: [thread({ threadId: "a" })], threadCount: 1532 }))).toBe(1531);
    expect(hiddenThreads(project({ path: "D:\\P", threads: [thread({ threadId: "a" })], threadCount: 1 }))).toBe(0);
  });

  // A 63-thread project pushed every other project off the screen, which is the
  // one thing a browse surface may not do.
  it("previews a busy project and offers the rest, counting against the true total", () => {
    const threads = Array.from({ length: 20 }, (_, i) => thread({ threadId: `t${i}` }));
    const p = project({ path: "D:\\Busy", threads, threadCount: 63 });

    const preview = previewThreads(p, false);
    expect(preview.shown).toHaveLength(PREVIEW_THREADS);
    // 63 total minus the 8 on screen — not 20 minus 8. The remainder the user
    // cares about includes what the daemon never sent.
    expect(preview.rest).toBe(55);
    expect(preview.expandable).toBe(true);

    const full = previewThreads(p, true);
    expect(full.shown).toHaveLength(20);
    expect(full.rest).toBe(43);
    // Nothing left this screen can reveal: the rest is behind the daemon's cap,
    // and a control that cannot do anything is worse than a label.
    expect(full.expandable).toBe(false);
  });

  it("offers nothing to expand when a project fits in the preview", () => {
    const p = project({ path: "D:\\Small", threads: [thread({ threadId: "a" })], threadCount: 1 });
    expect(previewThreads(p, false)).toEqual({ shown: p.threads, rest: 0, expandable: false });
  });

  // Both agents fork on resume, so one conversation is several files. The count
  // is resumes *behind* the current leaf — three files is "resumed 2×".
  it("counts resumes behind the current leaf, never negative", () => {
    expect(resumeCount(thread({ threadId: "a", sessionIds: ["a", "b", "c"] }))).toBe(2);
    expect(resumeCount(thread({ threadId: "a", sessionIds: ["a"] }))).toBe(0);
    expect(resumeCount(thread({ threadId: "a", sessionIds: [] }))).toBe(0);
  });
});
