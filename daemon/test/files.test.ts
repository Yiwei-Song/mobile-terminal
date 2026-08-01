import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import {
  allowedRoots,
  isUnderRoot,
  list,
  read,
  gitStatus,
  gitDiff,
  execFileText,
  type Exec,
} from "../src/files.js";
import type { Config } from "../src/config.js";

const win = process.platform === "win32";

// A scratch tree under the OS temp dir. Real paths (not string literals) so the
// guard's realpath step has something on disk to canonicalize.
function tree() {
  const base = mkdtempSync(join(tmpdir(), "wb-files-"));
  const root = join(base, "work");
  const evil = join(base, "work-evil"); // the prefix-trick sibling
  mkdirSync(root);
  mkdirSync(evil);
  writeFileSync(join(root, "a.txt"), "hello");
  writeFileSync(join(evil, "secrets.txt"), "PASSWORD");
  mkdirSync(join(root, "sub"));
  writeFileSync(join(root, "sub", "b.txt"), "b");
  return { base, root, evil };
}

// ---------------------------------------------------------------------------
// THE GUARD. Refusals first — everything below this line is the security case.
// ---------------------------------------------------------------------------
describe("isUnderRoot refuses", () => {
  it("a `..` escape out of the root", () => {
    const t = tree();
    expect(isUnderRoot(join(t.root, "..", "work-evil", "secrets.txt"), [t.root])).toBe(false);
    // The classic payload, relative to a root deep in the tree.
    expect(isUnderRoot(join(t.root, "..", "..", "..", "Windows", "System32", "config", "SAM"), [t.root])).toBe(false);
  });

  it("an absolute path outside the roots", () => {
    const t = tree();
    expect(isUnderRoot(win ? "C:\\Windows\\System32\\config\\SAM" : "/etc/shadow", [t.root])).toBe(false);
    expect(isUnderRoot(t.base, [t.root])).toBe(false); // the parent is not inside
  });

  it("a sibling whose name merely starts with the root's name", () => {
    const t = tree();
    // `C:\work-evil` vs root `C:\work`: a naive startsWith() lets this through.
    expect(isUnderRoot(join(t.evil, "secrets.txt"), [t.root])).toBe(false);
    expect(isUnderRoot(t.evil, [t.root])).toBe(false);
    // ...while the root itself and a real child still pass, so the fix isn't
    // just "refuse everything".
    expect(isUnderRoot(t.root, [t.root])).toBe(true);
    expect(isUnderRoot(join(t.root, "a.txt"), [t.root])).toBe(true);
  });

  it("UNC and extended-length paths", () => {
    const t = tree();
    expect(isUnderRoot("\\\\server\\share\\x.txt", [t.root])).toBe(false);
    expect(isUnderRoot("\\\\?\\C:\\Windows\\win.ini", [t.root])).toBe(false);
    // A UNC *root* admits nothing either — the daemon serves local trees.
    expect(isUnderRoot("\\\\server\\share\\x.txt", ["\\\\server\\share"])).toBe(false);
  });

  it("...but an in-root `\\\\?\\` path is ADMITTED, because realpath strips the prefix", () => {
    const t = tree();
    if (!win) return;
    // Pinning the real semantics: `\\?\` is not "refused outright". The file
    // exists, so realpath canonicalizes it to the plain in-root path and it is
    // the same file `read` would serve anyway. The refusal above fires because
    // win.ini is outside the root, not because of the prefix.
    expect(isUnderRoot("\\\\?\\" + join(t.root, "a.txt"), [t.root])).toBe(true);
    // And the prefix buys no escape: still outside is still outside.
    expect(isUnderRoot("\\\\?\\" + join(t.evil, "secrets.txt"), [t.root])).toBe(false);
  });

  it("fails CLOSED when realpath errors with anything other than ENOENT", () => {
    if (!win) return;
    // realpath on the SAM hive is EPERM, not ENOENT. The old `catch {}` swallowed
    // that and fell back to a lexical check, which says "inside the root" — so an
    // unreadable path was admitted on a guess. Now: no realpath, no admission.
    const root = "C:\\Windows\\System32\\config";
    expect(isUnderRoot(join(root, "SAM"), [root])).toBe(false);
    // A sibling that DOES canonicalize under the same root still passes, so this
    // is fail-closed, not "refuse everything under C:\Windows".
    expect(isUnderRoot("C:\\Windows\\System32", ["C:\\Windows"])).toBe(true);
  });

  it("everything when the roots list is empty", () => {
    const t = tree();
    expect(isUnderRoot(t.root, [])).toBe(false);
    expect(isUnderRoot(join(t.root, "a.txt"), [])).toBe(false);
    expect(isUnderRoot("", [t.root])).toBe(false);
  });

  it("a symlink inside a root that points outside it", () => {
    const t = tree();
    const link = join(t.root, "escape");
    try {
      symlinkSync(t.evil, link, "junction");
    } catch {
      return; // no symlink privilege on this box; the resolve-only path still holds
    }
    // Lexically this is `<root>\escape\secrets.txt` — inside. Only realpath sees
    // that it lands in work-evil.
    expect(isUnderRoot(join(link, "secrets.txt"), [t.root])).toBe(false);
  });

  it("case differences (win32) — same tree, different casing, still admitted", () => {
    const t = tree();
    if (!win) return;
    expect(isUnderRoot(t.root.toUpperCase(), [t.root.toLowerCase()])).toBe(true);
    expect(isUnderRoot(join(t.root, "a.txt").toLowerCase(), [t.root.toUpperCase()])).toBe(true);
    // And the prefix trick stays refused regardless of case.
    expect(isUnderRoot(t.evil.toUpperCase(), [t.root.toLowerCase()])).toBe(false);
  });

  it("a trailing-separator root behaves like the same root without one", () => {
    const t = tree();
    expect(isUnderRoot(join(t.root, "a.txt"), [t.root + sep])).toBe(true);
    expect(isUnderRoot(join(t.evil, "secrets.txt"), [t.root + sep])).toBe(false);
  });
});

describe("list/read refuse out-of-root paths", () => {
  it("list throws 'outside allowed roots'", () => {
    const t = tree();
    expect(() => list(t.evil, [t.root])).toThrow(/outside allowed roots/);
    expect(() => list(join(t.root, "..", "work-evil"), [t.root])).toThrow(/outside allowed roots/);
    expect(() => list(t.root, [])).toThrow(/outside allowed roots/);
  });

  it("read throws 'outside allowed roots'", () => {
    const t = tree();
    expect(() => read(join(t.evil, "secrets.txt"), [t.root])).toThrow(/outside allowed roots/);
    expect(() => read(join(t.root, "..", "work-evil", "secrets.txt"), [t.root])).toThrow(/outside allowed roots/);
  });

  it("git.* refuse a cwd outside the roots before running anything", async () => {
    const t = tree();
    const calls: string[] = [];
    const exec: Exec = async (file) => (calls.push(file), "");
    await expect(gitStatus(t.evil, [t.root], exec)).rejects.toThrow(/outside allowed roots/);
    await expect(gitDiff(t.evil, [t.root], exec)).rejects.toThrow(/outside allowed roots/);
    // and a file pathspec that escapes the repo
    await expect(gitDiff(t.root, [t.root], exec, "../work-evil/secrets.txt")).rejects.toThrow(/outside allowed roots/);
    expect(calls).toEqual([]); // nothing was ever spawned
  });
});

// ---------------------------------------------------------------------------
// Happy paths.
// ---------------------------------------------------------------------------
describe("allowedRoots", () => {
  const cfg = (fileRoots?: string[]): Config =>
    ({ token: "t", port: 1, ntfyTopic: null, dataDir: "d", fileRoots }) as Config;

  it("is config.fileRoots union the session cwds, normalized and deduped", () => {
    const t = tree();
    const roots = allowedRoots(cfg([t.root]), [t.root + sep, join(t.root, "sub"), t.evil]);
    // t.root and t.root+sep collapse; sub is nested but still its own entry.
    expect(roots).toContain(resolve(t.root));
    expect(roots).toContain(resolve(t.evil));
    expect(roots.filter((r) => r === resolve(t.root))).toHaveLength(1);
  });

  it("drops empties and works with no fileRoots configured", () => {
    const t = tree();
    expect(allowedRoots(cfg(), [t.root, "", "  "])).toEqual([resolve(t.root)]);
    expect(allowedRoots(cfg(), [])).toEqual([]);
  });

  it("dedups case-insensitively on win32", () => {
    const t = tree();
    if (!win) return;
    expect(allowedRoots(cfg([t.root.toUpperCase()]), [t.root.toLowerCase()])).toHaveLength(1);
  });
});

describe("list", () => {
  it("returns entries with dirs first, sizes for files", () => {
    const t = tree();
    const out = list(t.root, [t.root]);
    expect(out.map((e) => e.name)).toEqual(["sub", "a.txt"]);
    expect(out[0]).toMatchObject({ name: "sub", dir: true, size: 0 });
    expect(out[1]).toMatchObject({ name: "a.txt", dir: false, size: 5 });
    expect(out[1].path).toBe(join(resolve(t.root), "a.txt"));
    // and a nested dir listing works through the same guard
    expect(list(join(t.root, "sub"), [t.root]).map((e) => e.name)).toEqual(["b.txt"]);
  });
});

describe("read", () => {
  it("returns the whole file untruncated under the cap", () => {
    const t = tree();
    expect(read(join(t.root, "a.txt"), [t.root])).toEqual({ text: "hello", truncated: false });
  });

  it("truncates at maxBytes and says so", () => {
    const t = tree();
    const big = join(t.root, "big.txt");
    writeFileSync(big, "x".repeat(1000));
    const r = read(big, [t.root], 100);
    expect(r.truncated).toBe(true);
    expect(r.text).toHaveLength(100);
    // exactly at the cap is NOT truncated
    expect(read(big, [t.root], 1000).truncated).toBe(false);
  });

  it("reports a binary file instead of emitting garbage", () => {
    const t = tree();
    const bin = join(t.root, "b.bin");
    writeFileSync(bin, Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0xff, 0xfe]));
    const r = read(bin, [t.root]);
    expect(r.text).toBe("(binary file)");
    expect(r.truncated).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// git, over a fake exec (no repo needed) — plus one real read-only call.
// ---------------------------------------------------------------------------
const cannedStatus = [
  "## main...origin/main [ahead 1]",
  " M daemon/src/files.ts",
  "?? daemon/test/files.test.ts",
  "A  docs/new.md",
  "R  old.ts -> new.ts",
  "",
].join("\n");

function fakeExec(out: string) {
  const calls: { file: string; args: string[]; cwd?: string }[] = [];
  const exec: Exec = async (file, args, cwd) => {
    calls.push({ file, args, cwd });
    return out;
  };
  return { exec, calls };
}

describe("gitStatus", () => {
  it("parses branch and files from porcelain=v1 -b", async () => {
    const t = tree();
    const f = fakeExec(cannedStatus);
    const s = await gitStatus(t.root, [t.root], f.exec);
    expect(f.calls[0]).toEqual({
      file: "git",
      args: ["status", "--porcelain=v1", "-b", "--", "."],
      cwd: resolve(t.root),
    });
    expect(s.branch).toBe("main");
    expect(s.files).toEqual([
      { path: "daemon/src/files.ts", status: " M" },
      { path: "daemon/test/files.test.ts", status: "??" },
      { path: "docs/new.md", status: "A " },
      { path: "new.ts", status: "R " }, // rename reports the destination
    ]);
  });

  it("handles a branch with no upstream and a detached HEAD", async () => {
    const t = tree();
    expect((await gitStatus(t.root, [t.root], fakeExec("## feature/x\n").exec)).branch).toBe("feature/x");
    expect((await gitStatus(t.root, [t.root], fakeExec("## HEAD (no branch)\n").exec)).branch).toBe("HEAD");
    expect((await gitStatus(t.root, [t.root], fakeExec("").exec)).branch).toBe("");
  });
});

describe("gitDiff", () => {
  it("scopes a fileless diff to the cwd", async () => {
    const t = tree();
    const f = fakeExec("diff --git a/x b/x\n@@ -1 +1 @@\n-a\n+b\n");
    const d = await gitDiff(t.root, [t.root], f.exec);
    // `-- .` and not bare `diff`: without it git diffs the whole repo, root or no
    // root. See the real-git leak test below.
    expect(f.calls[0].args).toEqual(["diff", "--no-color", "--", "."]);
    expect(d).toContain("@@ -1 +1 @@");
  });

  it("passes a file as an argv element after `--`, never a shell string", async () => {
    const t = tree();
    writeFileSync(join(t.root, "we ird;&.txt"), "x");
    const f = fakeExec("");
    await gitDiff(t.root, [t.root], f.exec, "we ird;&.txt");
    // `--` ends option parsing, and the name is its own argv slot: no quoting,
    // no shell, so `;` and `&` are literal characters in a filename.
    expect(f.calls[0].args).toEqual(["diff", "--no-color", "--", join(resolve(t.root), "we ird;&.txt")]);
  });

  it("neutralizes git pathspec magic — the raw wire string never reaches git", async () => {
    const t = tree();
    // Each of these means something to git: `:/` and `:(top)` re-anchor at the
    // repo top (defeating the `-- .` scoping above), `:!` negates, `:(glob)`
    // globs. All of them resolve to nonexistent paths lexically *inside* the
    // root, so the path guard alone says "fine".
    for (const magic of [":/", ":/x", ":(top)", ":(top)../secret.txt", ":!x", ":(glob)**/*"]) {
      const f = fakeExec("");
      let args: string[] | null = null;
      try {
        await gitDiff(t.root, [t.root], f.exec, magic);
        args = f.calls[0].args;
      } catch (e) {
        expect(String(e)).toMatch(/outside allowed roots/); // refused is also fine
        continue;
      }
      // Not refused? Then git must have been handed the resolved ABSOLUTE path —
      // which cannot carry magic — and never the raw string.
      const spec = args![3]!;
      expect(args!.slice(0, 3)).toEqual(["diff", "--no-color", "--"]);
      expect(spec).toBe(resolve(t.root, magic));
      expect(spec).not.toBe(magic);
      expect(isUnderRoot(spec, [t.root])).toBe(true);
    }
  });
});

describe("real git, read-only, against this repo", () => {
  it("gitStatus reports a branch name", async () => {
    const repo = resolve(import.meta.dirname, "..", "..");
    const s = await gitStatus(repo, [repo], execFileText);
    expect(s.branch).not.toBe("");
    expect(Array.isArray(s.files)).toBe(true);
  });
});

// The regression test for the leak the scoping fixes exist for: a REAL repo whose
// root is a subdirectory. `git status`/`git diff` are whole-repo commands, so
// before the `-- .` pathspec they happily reported and printed the content of
// `<repo>\top.txt` — a file `read` refuses. Realistic trigger: a session cwd of
// `D:\Mobile-access\daemon` inside the repo `D:\Mobile-access`.
describe("real git does not leak above the root", () => {
  it("status and diff stay inside a sub-directory root", async () => {
    const base = mkdtempSync(join(tmpdir(), "wb-leak-"));
    const sub = join(base, "sub");
    mkdirSync(sub);
    writeFileSync(join(base, "top.txt"), "TOPSECRET-ORIGINAL\n");
    writeFileSync(join(sub, "b.txt"), "b\n");
    const git = (...a: string[]) => execFileText("git", a, base);
    await git("init", "-q", ".");
    await git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qam", "init", "--allow-empty");
    await git("add", "-A");
    await git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "files");
    writeFileSync(join(base, "top.txt"), "TOPSECRET-MODIFIED\n");
    writeFileSync(join(sub, "b.txt"), "MODIFIED-SUB\n");

    const s = await gitStatus(sub, [sub], execFileText);
    expect(s.files.map((f) => f.path)).toEqual(["sub/b.txt"]); // NOT top.txt

    const d = await gitDiff(sub, [sub], execFileText);
    expect(d).toContain("MODIFIED-SUB");
    expect(d).not.toContain("TOPSECRET"); // the actual leak: file content

    // ...and pathspec magic cannot re-widen it past the root either.
    for (const magic of [":/", ":(top)", ":(top)/top.txt"]) {
      const out = await gitDiff(sub, [sub], execFileText, magic).catch((e) => String(e));
      expect(out).not.toContain("TOPSECRET");
    }
  });
});
