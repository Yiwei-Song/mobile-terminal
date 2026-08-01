// Unified-diff parsing. Pure and dependency-free so the part that silently
// breaks — line numbering — is unit-testable without rendering anything.

export interface DiffLine {
  type: "add" | "del" | "ctx";
  text: string;
  /** Line number in the OLD file. Absent on an added line. */
  oldNo?: number;
  /** Line number in the NEW file. Absent on a deleted line. */
  newNo?: number;
}

export interface DiffHunk {
  /** The `@@ … @@` line verbatim — it carries the enclosing function name. */
  header: string;
  lines: DiffLine[];
}

export interface DiffFile {
  /** `/dev/null` for a new file. */
  oldPath: string;
  /** `/dev/null` for a deleted file. */
  newPath: string;
  /** git said "Binary files … differ": there is nothing to render line-wise. */
  binary: boolean;
  hunks: DiffHunk[];
}

// `a/src/x.ts`, `"a/sp ce.ts"`, `b/x.ts\t2026-08-01 12:00:00` → `src/x.ts`.
// `/dev/null` survives untouched, which is how new/deleted files are detected.
const path = (raw: string): string => {
  const t = raw.split("\t")[0]!.trim();
  const u = t.startsWith('"') && t.endsWith('"') ? t.slice(1, -1) : t;
  return /^[ab]\//.test(u) ? u.slice(2) : u;
};

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/**
 * Parse `git diff` output into per-file sections with real line numbers.
 * Unknown lines (index/mode/similarity headers) are ignored; an empty string is
 * an empty array, not a file with no hunks.
 */
export function parseDiff(text: string): DiffFile[] {
  const files: DiffFile[] = [];
  let hunk: DiffHunk | null = null;
  // Counts come from the hunk header, and they — not the leading character —
  // decide where the body ends: a deleted line reading `--- x` is payload, not
  // the next file's header.
  let oldNo = 0;
  let newNo = 0;
  let oldLeft = 0;
  let newLeft = 0;

  // The file being filled in is always the last one pushed — read through these
  // rather than a `let`, so the parse state is the output and cannot drift.
  const last = (): DiffFile | undefined => files[files.length - 1];
  const open = (oldPath: string, newPath: string): DiffFile => {
    const f: DiffFile = { oldPath, newPath, binary: false, hunks: [] };
    files.push(f);
    hunk = null;
    return f;
  };

  for (const line of text.split(/\r?\n/)) {
    if (hunk !== null && oldLeft + newLeft > 0) {
      const c = line.charAt(0);
      if (c === "\\") continue; // "\ No newline at end of file"
      if (c === "+") {
        hunk.lines.push({ type: "add", text: line.slice(1), newNo: newNo++ });
        newLeft--;
        continue;
      }
      if (c === "-") {
        hunk.lines.push({ type: "del", text: line.slice(1), oldNo: oldNo++ });
        oldLeft--;
        continue;
      }
      // An all-whitespace context line often arrives with its leading space
      // stripped, so "" is context too.
      if (c === " " || line === "") {
        hunk.lines.push({ type: "ctx", text: line.slice(1), oldNo: oldNo++, newNo: newNo++ });
        oldLeft--;
        newLeft--;
        continue;
      }
      hunk = null; // truncated hunk — believe the header below instead
    }

    if (line.startsWith("diff --git ")) {
      const rest = line.slice("diff --git ".length);
      // Paths can contain spaces, so split at the ` b/` that starts the second
      // one rather than at the first space.
      const m = /^(.*?) (b\/.*)$/.exec(rest);
      open(path(m?.[1] ?? rest), path(m?.[2] ?? rest));
      continue;
    }
    if (line.startsWith("--- ")) {
      const p = path(line.slice(4));
      const f = last();
      // A `---` after a file already has hunks starts the next one: that is what
      // a plain `diff -u` stream looks like without git's `diff --git` headers.
      if (f === undefined || f.hunks.length > 0) open(p, p);
      else f.oldPath = p;
      continue;
    }
    if (line.startsWith("+++ ")) {
      const p = path(line.slice(4));
      const f = last();
      if (f === undefined) open(p, p);
      else f.newPath = p;
      continue;
    }
    if (line.startsWith("rename from ")) {
      (last() ?? open("", "")).oldPath = path(line.slice("rename from ".length));
      continue;
    }
    if (line.startsWith("rename to ")) {
      (last() ?? open("", "")).newPath = path(line.slice("rename to ".length));
      continue;
    }
    if (line.startsWith("Binary files ") || line.startsWith("GIT binary patch")) {
      (last() ?? open("", "")).binary = true;
      continue;
    }
    const h = HUNK.exec(line);
    if (h === null) continue;
    const f = last() ?? open("", "");
    oldNo = Number(h[1]);
    oldLeft = h[2] === undefined ? 1 : Number(h[2]);
    newNo = Number(h[3]);
    newLeft = h[4] === undefined ? 1 : Number(h[4]);
    hunk = { header: line, lines: [] };
    f.hunks.push(hunk);
  }
  return files;
}

/** +N / −M for a file section header. */
export const counts = (f: DiffFile): { add: number; del: number } => {
  let add = 0;
  let del = 0;
  for (const h of f.hunks)
    for (const l of h.lines) {
      if (l.type === "add") add++;
      else if (l.type === "del") del++;
    }
  return { add, del };
};

/** What the section title should say about the file as a whole. */
export const fileLabel = (f: DiffFile): { path: string; note: string | null } => {
  if (f.oldPath === "/dev/null") return { path: f.newPath, note: "new file" };
  if (f.newPath === "/dev/null") return { path: f.oldPath, note: "deleted" };
  if (f.oldPath !== f.newPath) return { path: f.newPath, note: `renamed from ${f.oldPath}` };
  return { path: f.newPath, note: null };
};
