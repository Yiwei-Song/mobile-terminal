// Read-only file browsing + git status/diff for the phone, behind a path guard.
//
// The guard scopes this module: every path that arrives here came off the wire,
// so `list`/`read`/`git.*` refuse anything that does not resolve inside an
// allowed root. Roots are config.fileRoots plus the cwds of known sessions.
//
// This is UI scoping, NOT a containment boundary. `sessions.new {cwd}` takes any
// string from the authenticated client, and session cwds become roots — so a
// client can make `C:\` a root. That is not a privilege escalation (the same
// client can `term.create` a shell anywhere), but do not mistake this guard for
// a sandbox: it keeps the browser honest, it does not confine a hostile client.
import { execFile } from "node:child_process";
import { closeSync, openSync, readdirSync, readSync, realpathSync, statSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import type { Config } from "./config.js";
import type { Entry } from "./protocol.js";
export type { Entry };

// argv-style, promise-of-stdout. NOT the string-based child_process.exec that
// PowerDeps carries: a filename off the wire concatenated into a command string
// is a shell injection, and there is no quoting scheme that is right on both
// cmd.exe and PowerShell. An args array never reaches a shell at all.
export type Exec = (file: string, args: string[], cwd?: string) => Promise<string>;

// The one real implementation (index.ts injects it; the real-git test uses it).
// maxBuffer is raised because a whole-repo `git diff` easily clears node's 1MB
// default, and blowing the buffer surfaces as an opaque ENOBUFS.
export const execFileText: Exec = (file, args, cwd) =>
  new Promise((res, rej) =>
    execFile(file, args, { cwd, windowsHide: true, maxBuffer: 16 * 1024 * 1024 }, (err, stdout) =>
      err ? rej(err) : res(stdout),
    ),
  );

const CI = process.platform === "win32"; // case-insensitive filesystem

// Canonical form for comparison: absolute, symlink/junction-free, lower-cased on
// win32. realpath (not resolve alone) because a junction *inside* a root can
// point anywhere on the disk — `<root>\escape\secrets` is lexically inside and
// physically outside, and only realpath can tell. A path that isn't on disk yet
// has no realpath, so ENOENT falls back to resolve; the fs call that follows will
// fail with ENOENT anyway, so nothing is reachable through that gap.
//
// Any OTHER realpath error (EACCES/EPERM/EBUSY/EINVAL/ELOOP...) means we could
// not learn where this path really points, so it fails CLOSED: a unique sentinel
// that is equal to no root and a prefix of nothing.
let refused = 0;
function canon(p: string): string {
  let r = resolve(p);
  try {
    r = realpathSync.native(r);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") return `\0refused-${++refused}`;
    /* not on disk — resolve-only is the answer */
  }
  return CI ? r.toLowerCase() : r;
}

export function isUnderRoot(p: string, roots: string[]): boolean {
  if (!p.trim() || roots.length === 0) return false;
  const c = canon(p);
  // `\\server\share` — a remote tree the daemon has no business serving — is out.
  // Note this is checked on the CANONICAL form: realpath strips a `\\?\` prefix
  // off a path that exists, so `\\?\<root>\a.txt` canonicalizes to `<root>\a.txt`
  // and is admitted. That is correct (it is the same file), not a bypass; only a
  // `\\?\` path with no realpath keeps its prefix and lands here.
  if (c.startsWith("\\\\")) return false;
  return roots.some((r) => {
    if (!r.trim()) return false;
    const root = canon(r);
    if (root.startsWith("\\\\")) return false;
    // The prefix MUST end at a separator, or root `C:\work` would admit
    // `C:\work-evil\secrets.txt`. `C:\` already ends in one.
    return c === root || c.startsWith(root.endsWith(sep) ? root : root + sep);
  });
}

// config.fileRoots ∪ session cwds. Resolved and deduped (case-insensitively on
// win32) so the same tree spelled two ways is one root.
export function allowedRoots(cfg: Config, sessionCwds: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const p of [...(cfg.fileRoots ?? []), ...sessionCwds]) {
    if (!p?.trim()) continue;
    const abs = resolve(p);
    const key = CI ? abs.toLowerCase() : abs;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(abs);
  }
  return out;
}

// Every entry point funnels through here. Returns the *resolved* (not realpathed)
// path so what the phone navigates stays in the names the user recognizes.
function ensure(p: string, roots: string[]): string {
  if (!isUnderRoot(p, roots)) throw new Error("outside allowed roots");
  return resolve(p);
}

export function list(dir: string, roots: string[]): Entry[] {
  const d = ensure(dir, roots);
  return readdirSync(d, { withFileTypes: true })
    .map((e) => {
      const path = join(d, e.name);
      // statSync, not the dirent: we need the size, and a dangling link should
      // show up as a zero-byte file rather than take the whole listing down.
      let dirFlag = e.isDirectory();
      let size = 0;
      try {
        const s = statSync(path);
        dirFlag = s.isDirectory();
        size = s.isFile() ? s.size : 0;
      } catch {
        /* vanished or unreadable between readdir and stat */
      }
      return { name: e.name, path, dir: dirFlag, size };
    })
    .sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name));
}

const MAX_READ = 256 * 1024;

// Reads at most maxBytes+1 through a fd rather than readFileSync: a 2GB log
// would otherwise be pulled into memory just to throw all but 256KB away.
// A NUL byte in that first chunk means binary — the phone gets a marker instead
// of megabytes of mojibake, flagged truncated so the UI reads it as "not all
// here" without a third field.
export function read(file: string, roots: string[], maxBytes = MAX_READ): { text: string; truncated: boolean } {
  const f = ensure(file, roots);
  const fd = openSync(f, "r");
  try {
    const buf = Buffer.alloc(maxBytes + 1);
    const n = readSync(fd, buf, 0, maxBytes + 1, 0);
    const chunk = buf.subarray(0, Math.min(n, maxBytes));
    if (chunk.includes(0)) return { text: "(binary file)", truncated: true };
    return { text: chunk.toString("utf8"), truncated: n > maxBytes };
  } finally {
    closeSync(fd);
  }
}

export async function gitStatus(
  cwd: string,
  roots: string[],
  exec: Exec,
): Promise<{ branch: string; files: { path: string; status: string }[] }> {
  const dir = ensure(cwd, roots);
  // `-- .` is load-bearing: git status is a WHOLE-REPO command regardless of cwd,
  // so without a pathspec a root of `<repo>\sub` still reports (and `git diff`
  // still prints the content of) files above the root that `read` would refuse.
  return parseStatus(await exec("git", ["status", "--porcelain=v1", "-b", "--", "."], dir));
}

// `## main...origin/main [ahead 1]` -> `main`; `## HEAD (no branch)` -> `HEAD`.
// Then `XY path`, where XY is the two-column porcelain code kept verbatim (the
// staged/unstaged distinction lives in which column is set, so trimming it would
// throw information away). A rename reads `R  old -> new`; the destination is
// the file that exists now, so that's what's reported.
function parseStatus(out: string): { branch: string; files: { path: string; status: string }[] } {
  const lines = out.split(/\r?\n/).filter((l) => l !== "");
  let branch = "";
  const files: { path: string; status: string }[] = [];
  for (const line of lines) {
    if (line.startsWith("## ")) {
      branch = line.slice(3).split("...")[0]!.split(" ")[0]!;
      continue;
    }
    if (line.length < 4) continue;
    const status = line.slice(0, 2);
    const rest = line.slice(3);
    const arrow = rest.indexOf(" -> ");
    files.push({ path: unquote(arrow === -1 ? rest : rest.slice(arrow + 4)), status });
  }
  return { branch, files };
}

// git quotes paths with non-ASCII/special characters. Strip the wrapper; the
// inner escapes are left alone (they render fine and nothing re-executes them).
const unquote = (p: string): string => (p.startsWith('"') && p.endsWith('"') ? p.slice(1, -1) : p);

export async function gitDiff(cwd: string, roots: string[], exec: Exec, file?: string): Promise<string> {
  const dir = ensure(cwd, roots);
  // Always a pathspec — see gitStatus: bare `git diff` ignores cwd and dumps the
  // whole repo, including files above the root.
  //
  // And the pathspec is the RESOLVED absolute path, never the raw wire string:
  // git pathspecs carry magic (`:/`, `:(top)`, `:!x`, `:(glob)`) that re-widens
  // the diff past the root, and those forms resolve to harmless-looking
  // nonexistent paths *inside* the root, so the guard alone waves them through.
  // An absolute path cannot carry magic, so passing it neutralizes all of them.
  const f = file ? ensure(resolve(dir, file), roots) : ".";
  return exec("git", ["diff", "--no-color", "--", f], dir);
}
