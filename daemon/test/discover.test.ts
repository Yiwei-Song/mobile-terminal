import { describe, it, expect } from "vitest";
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { discover, liveClaudeSessions, scanClaude, scanCodex, scanCodexRollouts } from "../src/sessions/discover.js";

// The fixtures below mirror the real line shapes on OMEN16 — a Claude fork
// opening on its ancestor's id and closing on its own, a Codex session_meta with
// session_id/id/parent_thread_id/thread_source. If an agent changes its format,
// these stop matching reality and the tests that depend on them are the warning.

function home(): string {
  return mkdtempSync(join(tmpdir(), "wb-disc-"));
}

/** One Claude transcript. `ancestors` are the ids whose history a fork copied in;
 *  they lead, exactly as they do on disk, so the first line carries the root. */
function claudeFile(h: string, project: string, id: string, o: { cwd: string; ancestors?: string[]; title?: string; prompt?: string }): void {
  const dir = join(h, ".claude", "projects", project);
  mkdirSync(dir, { recursive: true });
  const lines: string[] = [];
  for (const a of o.ancestors ?? []) {
    lines.push(JSON.stringify({ type: "user", sessionId: a, cwd: o.cwd }));
  }
  if (o.prompt !== undefined) lines.push(JSON.stringify({ type: "last-prompt", lastPrompt: o.prompt, sessionId: id }));
  if (o.title !== undefined) lines.push(JSON.stringify({ type: "custom-title", customTitle: o.title, sessionId: id }));
  lines.push(JSON.stringify({ type: "assistant", sessionId: id, cwd: o.cwd }));
  writeFileSync(join(dir, `${id}.jsonl`), lines.join("\n"));
}

function codexFile(h: string, date: string, id: string, o: { cwd: string; root?: string; subagent?: boolean }): void {
  const dir = join(h, ".codex", "sessions", ...date.split("-"));
  mkdirSync(dir, { recursive: true });
  const payload = {
    session_id: o.root ?? id,
    id,
    ...(o.root === undefined ? {} : { parent_thread_id: o.root }),
    cwd: o.cwd,
    thread_source: o.subagent === true ? "subagent" : "user",
  };
  writeFileSync(join(dir, `rollout-${date}T00-00-00-${id}.jsonl`), JSON.stringify({ type: "session_meta", payload }));
}

/** A minimal `state_5.sqlite`: only the columns discover.ts reads, in the shapes
 *  the real table uses (ms timestamps, 0/1 flags, nullable thread_source). */
function codexDb(h: string, rows: { id: string; cwd: string; title: string; name?: string; ms: number; archived?: number; thread_source?: string }[]): void {
  mkdirSync(join(h, ".codex"), { recursive: true });
  const db = new DatabaseSync(join(h, ".codex", "state_5.sqlite"));
  db.exec(`CREATE TABLE threads (
    id TEXT PRIMARY KEY, rollout_path TEXT NOT NULL, cwd TEXT NOT NULL,
    title TEXT NOT NULL, name TEXT, archived INTEGER NOT NULL DEFAULT 0,
    thread_source TEXT, updated_at INTEGER NOT NULL, updated_at_ms INTEGER)`);
  const ins = db.prepare("INSERT INTO threads (id, rollout_path, cwd, title, name, archived, thread_source, updated_at, updated_at_ms) VALUES (?,?,?,?,?,?,?,?,?)");
  for (const r of rows) {
    ins.run(r.id, join(h, "missing.jsonl"), r.cwd, r.title, r.name ?? null, r.archived ?? 0, r.thread_source ?? null, Math.floor(r.ms / 1000), r.ms);
  }
  db.close();
}

describe("discover", () => {
  // The whole reason this module exists: resuming forks, so one conversation is
  // several files. The owner thinks of it as one thread and so must the list.
  it("stitches a Claude fork chain into one thread, newest leaf as resume target", () => {
    const h = home();
    const cwd = "D:\\Mobile-access";
    claudeFile(h, "D--Mobile-access", "aaa", { cwd, title: "Handover build" });
    claudeFile(h, "D--Mobile-access", "bbb", { cwd, ancestors: ["aaa"], title: "Handover build (fork)" });
    claudeFile(h, "D--Mobile-access", "ccc", { cwd, ancestors: ["aaa", "bbb"], title: "Handover build (fork 2)" });

    const projects = discover(h, new Map());
    expect(projects).toHaveLength(1);
    const threads = projects[0].threads;
    expect(threads).toHaveLength(1);
    expect(threads[0].threadId).toBe("aaa");
    expect([...threads[0].sessionIds].sort()).toEqual(["aaa", "bbb", "ccc"]);
    // Only the newest leaf can be continued — resuming an older one forks again
    // from stale history and silently drops the work in between.
    expect(threads[0].resumeId).toBe("ccc");
    expect(threads[0].title).toBe("Handover build (fork 2)");
  });

  // Regression: three forks written inside the same millisecond share an mtime,
  // and `resumeId` fell to whatever order the directory listed. Continuing from
  // a stale fork silently drops every turn after it. Size breaks the tie — a
  // fork contains its parent's whole transcript plus more.
  it("picks the newest fork even when every file shares an mtime", () => {
    const h = home();
    const cwd = "D:\\Proj";
    claudeFile(h, "D--Proj", "old", { cwd, title: "old" });
    claudeFile(h, "D--Proj", "mid", { cwd, ancestors: ["old"], title: "mid" });
    claudeFile(h, "D--Proj", "new", { cwd, ancestors: ["old", "mid"], title: "new" });
    const when = new Date("2026-08-04T12:00:00.000Z");
    for (const id of ["old", "mid", "new"]) {
      utimesSync(join(h, ".claude", "projects", "D--Proj", `${id}.jsonl`), when, when);
    }

    const [t] = discover(h, new Map())[0].threads;
    expect(t.resumeId).toBe("new");
    expect(t.title).toBe("new");
  });

  it("groups by working directory and sinks generated projects below real ones", () => {
    const h = home();
    claudeFile(h, "D--Real", "r1", { cwd: "D:\\Real", title: "Real work" });
    claudeFile(h, "temp-scratch", "t1", {
      cwd: "C:\\Users\\y\\AppData\\Local\\Temp\\claude\\x\\scratchpad",
      title: "Scratch",
    });
    claudeFile(h, "worktree", "w1", { cwd: "D:\\Real\\.claude-worktrees\\nice-jepsen", title: "Worktree" });

    const projects = discover(h, new Map());
    expect(projects.map((p) => p.generated)).toEqual([false, true, true]);
    expect(projects[0].name).toBe("Real");
  });

  // Two sessions in one folder are two conversations, not one thread — the
  // stitch key is lineage, and unrelated roots must never merge.
  it("keeps unrelated threads in the same folder separate", () => {
    const h = home();
    const cwd = "D:\\Proj";
    claudeFile(h, "D--Proj", "one", { cwd, title: "First" });
    claudeFile(h, "D--Proj", "two", { cwd, title: "Second" });

    const projects = discover(h, new Map());
    expect(projects).toHaveLength(1);
    expect(projects[0].threads.map((t) => t.threadId).sort()).toEqual(["one", "two"]);
  });

  it("reads Codex threads and drops the agent's own subagent fan-out", () => {
    const h = home();
    const cwd = "D:\\Authenry";
    codexFile(h, "2026-08-04", "root1", { cwd });
    codexFile(h, "2026-08-04", "sub1", { cwd, root: "root1", subagent: true });

    const leaves = scanCodexRollouts(h);
    expect(leaves.map((l) => l.sessionId)).toEqual(["root1"]);
    expect(leaves[0].agent).toBe("codex");
  });

  it("titles a Codex thread from session_index.jsonl", () => {
    const h = home();
    codexFile(h, "2026-08-04", "abc", { cwd: "D:\\P" });
    writeFileSync(
      join(h, ".codex", "session_index.jsonl"),
      `${JSON.stringify({ id: "abc", thread_name: "MA System v4", updated_at: "2026-06-08T09:20:37Z" })}\n`,
    );
    expect(scanCodexRollouts(h)[0].title).toBe("MA System v4");
  });

  // The thread table is what the Codex UI lists from, so it — not the rollout
  // pile — decides what the phone shows: real titles, the archived flag, and the
  // subagent filter. 258 rows here against 1749 rollout files on the real machine.
  it("prefers the Codex thread table, honouring archived and subagent flags", () => {
    const h = home();
    codexDb(h, [
      { id: "keep", cwd: "\\\\?\\D:\\Proj", title: "Improve settings", ms: 3000 },
      { id: "named", cwd: "D:\\Proj", title: "derived", name: "My name", ms: 2000 },
      { id: "gone", cwd: "D:\\Proj", title: "Archived", ms: 1000, archived: 1 },
      { id: "sub", cwd: "D:\\Proj", title: "Subagent", ms: 4000, thread_source: "subagent" },
    ]);
    // Present on disk too, and must NOT win — the table is authoritative.
    codexFile(h, "2026-08-04", "gone", { cwd: "D:\\Proj" });

    const leaves = scanCodex(h);
    expect(leaves.map((l) => l.sessionId).sort()).toEqual(["keep", "named"]);
    // A name the owner typed beats the title Codex derived.
    expect(leaves.find((l) => l.sessionId === "named")?.title).toBe("My name");
    // The Win32 extended-length prefix is stripped, so both rows are one project.
    expect(new Set(leaves.map((l) => l.cwd))).toEqual(new Set(["D:\\Proj"]));
  });

  // Codex can adopt a Claude transcript into its own thread table, keeping the
  // title and folder. Both stores then describe one conversation, and the phone
  // listed it twice side by side — the exact disagreement between surfaces this
  // module exists to prevent. Caught on the emulator, not by a fixture.
  it("drops Codex threads that are imported Claude sessions", () => {
    const h = home();
    const cwd = "D:\\Mobile-access";
    claudeFile(h, "D--Mobile-access", "claude-original", { cwd, title: "Handover build" });
    codexDb(h, [
      { id: "imported-copy", cwd, title: "Handover build", ms: 5000 },
      { id: "genuinely-codex", cwd, title: "Improve settings", ms: 4000 },
    ]);
    writeFileSync(
      join(h, ".codex", "external_agent_session_imports.json"),
      JSON.stringify({
        records: [
          {
            source_path: "\\\\?\\C:\\Users\\y\\.claude\\projects\\D--Mobile-access\\claude-original.jsonl",
            imported_thread_id: "imported-copy",
          },
        ],
      }),
    );

    const threads = discover(h, new Map())[0].threads;
    expect(threads.map((t) => t.threadId).sort()).toEqual(["claude-original", "genuinely-codex"]);
    // The surviving copy is the Claude original, not Codex's adoption of it.
    expect(threads.find((t) => t.title === "Handover build")?.agent).toBe("claude");
  });

  // Showing a session twice beats hiding it: an unreadable imports file must not
  // silently delete genuine Codex threads.
  it("keeps every Codex thread when the imports record is unreadable", () => {
    const h = home();
    codexDb(h, [{ id: "c1", cwd: "D:\\P", title: "Real", ms: 1000 }]);
    writeFileSync(join(h, ".codex", "external_agent_session_imports.json"), "{ not json");
    expect(scanCodex(h).map((l) => l.sessionId)).toEqual(["c1"]);
  });

  // A schema that moves under us must degrade to the slower reader, not to an
  // empty session list — the phone showing nothing is worse than showing stale.
  it("falls back to rollout scanning when the thread table is unreadable", () => {
    const h = home();
    mkdirSync(join(h, ".codex"), { recursive: true });
    writeFileSync(join(h, ".codex", "state_5.sqlite"), "not a database");
    codexFile(h, "2026-08-04", "fromdisk", { cwd: "D:\\P" });

    expect(scanCodex(h).map((l) => l.sessionId)).toEqual(["fromdisk"]);
  });

  // Both agents in one folder: the phone shows one project, two threads, and the
  // rows must stay distinguishable by agent.
  it("merges both agents into one project", () => {
    const h = home();
    const cwd = "D:\\Shared";
    claudeFile(h, "D--Shared", "c1", { cwd, title: "Claude thread" });
    codexFile(h, "2026-08-04", "x1", { cwd });

    const projects = discover(h, new Map());
    expect(projects).toHaveLength(1);
    expect(projects[0].threads.map((t) => t.agent).sort()).toEqual(["claude", "codex"]);
  });

  // A live session's status and display name come from the registry the desktop
  // app maintains, so the phone shows the same words the laptop does.
  it("takes status and title from the live session registry", () => {
    const h = home();
    const cwd = "D:\\Live";
    claudeFile(h, "D--Live", "live1", { cwd, title: "stale disk title" });

    const projects = discover(h, new Map([["live1", { pid: 1, name: "mobile-access-27", status: "waiting_on_user" as const }]]));
    expect(projects[0].threads[0].status).toBe("waiting_on_user");
    expect(projects[0].threads[0].title).toBe("mobile-access-27");
  });

  // A pid file left by a crashed process is not a running session; reporting it
  // as live would show the phone activity nothing can interrupt.
  it("ignores a live-registry entry whose process is gone", () => {
    const h = home();
    const dir = join(h, ".claude", "sessions");
    mkdirSync(dir, { recursive: true });
    // Two entries: this process (certainly alive) and a pid that cannot exist.
    writeFileSync(join(dir, `${process.pid}.json`), JSON.stringify({ pid: process.pid, sessionId: "alive", status: "waiting" }));
    writeFileSync(join(dir, "2147483646.json"), JSON.stringify({ pid: 2147483646, sessionId: "ghost", status: "waiting" }));

    const live = liveClaudeSessions(h);
    expect(live.has("alive")).toBe(true);
    expect(live.has("ghost")).toBe(false);
  });

  it("falls back from title to prompt, and skips a transcript with no cwd", () => {
    const h = home();
    claudeFile(h, "D--P", "titled", { cwd: "D:\\P", prompt: "Fix the login bug" });
    // No cwd in either window: the directory name is a lossy encoding, so there
    // is no honest project to file this under.
    const dir = join(h, ".claude", "projects", "D--P");
    writeFileSync(join(dir, "orphan.jsonl"), JSON.stringify({ type: "user", sessionId: "orphan" }));

    const leaves = scanClaude(h, new Map());
    expect(leaves.map((l) => l.sessionId)).toEqual(["titled"]);
    expect(leaves[0].title).toBe("Fix the login bug");
  });

  it("returns nothing when neither agent is installed", () => {
    expect(discover(home(), new Map())).toEqual([]);
  });

  // Regression: a transcript records a cwd per message, so a session that ran
  // `cd` into a subfolder writes that path late in the file. Reading the last one
  // filed this repo's own sessions under `D:\Mobile-access\daemon` and split one
  // project into two. The opening cwd is where the session was started.
  it("files a session under its opening cwd, not one a later command wandered into", () => {
    const h = home();
    const dir = join(h, ".claude", "projects", "D--Mobile-access");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "wander.jsonl"),
      [
        JSON.stringify({ type: "user", sessionId: "wander", cwd: "D:\\Mobile-access" }),
        JSON.stringify({ type: "custom-title", customTitle: "Build", sessionId: "wander" }),
        JSON.stringify({ type: "assistant", sessionId: "wander", cwd: "D:\\Mobile-access\\daemon" }),
      ].join("\n"),
    );
    expect(scanClaude(h, new Map())[0].cwd).toBe("D:\\Mobile-access");
  });

  // Nothing is hidden without saying so: a project keeps its true size even when
  // the wire carries only the newest few threads.
  it("reports the real thread count per project", () => {
    const h = home();
    for (let i = 0; i < 7; i++) claudeFile(h, "D--Many", `s${i}`, { cwd: "D:\\Many", title: `T${i}` });
    expect(discover(h, new Map())[0].threadCount).toBe(7);
  });

  // Windows hands the same folder back under whatever casing the caller typed.
  it("treats differently-cased paths as one project", () => {
    const h = home();
    claudeFile(h, "a", "one", { cwd: "D:\\Proj", title: "A" });
    claudeFile(h, "b", "two", { cwd: "d:\\proj", title: "B" });
    expect(discover(h, new Map())).toHaveLength(1);
  });
});
