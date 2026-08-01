import { describe, it, expect } from "vitest";

import {
  counts,
  fileLabel,
  lineCount,
  parseDiff,
  planRows,
  tooLargeToRender,
  RENDER_LINE_LIMIT,
  type DiffFile,
  type DiffLine,
} from "../src/lib/diff";
import { bytes, crumbs } from "../src/lib/format";
import { parseMarkdown } from "../src/lib/markdown";

// Real `git diff` output, not hand-simplified: the header lines that get
// ignored (index/mode/similarity) are exactly what a hand-written fixture
// leaves out, and they are what a parser trips over.

const MODIFY = `diff --git a/src/auth/tokens.ts b/src/auth/tokens.ts
index 3f9a1c2..7b21d40 100644
--- a/src/auth/tokens.ts
+++ b/src/auth/tokens.ts
@@ -12,7 +12,8 @@ import { prisma } from "../db.js";
 const TTL_ACCESS_SEC = 15 * 60;
 const TTL_REFRESH_SEC = 30 * 24 * 60 * 60;

-export async function rotate(t: string) {
+export async function rotate(t: string): Promise<Session> {
+  // revoke in the same transaction
   const row = await find(t);
   return issue(row.userId);
 }
`;

const NEW_FILE = `diff --git a/scripts/backfill.mjs b/scripts/backfill.mjs
new file mode 100644
index 0000000..4e0a91b
--- /dev/null
+++ b/scripts/backfill.mjs
@@ -0,0 +1,3 @@
+import { PrismaClient } from "@prisma/client";
+
+await new PrismaClient().$disconnect();
`;

const DELETED = `diff --git a/src/legacy/stripe.ts b/src/legacy/stripe.ts
deleted file mode 100644
index 8ab2c31..0000000
--- a/src/legacy/stripe.ts
+++ /dev/null
@@ -1,2 +0,0 @@
-export const CHARGE_URL = "https://api.stripe.com/v1/charges";
-export const legacy = true;
`;

const RENAME = `diff --git a/src/util.ts b/src/lib/util.ts
similarity index 92%
rename from src/util.ts
rename to src/lib/util.ts
index 1c2d3e4..5f6a7b8 100644
--- a/src/util.ts
+++ b/src/lib/util.ts
@@ -3,3 +3,3 @@ export const noop = () => {};
 export const id = <T>(x: T): T => x;
-export const ver = "1.0.0";
+export const ver = "1.1.0";
`;

const BINARY = `diff --git a/assets/logo.png b/assets/logo.png
index 7a1b2c3..9d8e7f6 100644
Binary files a/assets/logo.png and b/assets/logo.png differ
`;

describe("parseDiff", () => {
  it("is empty for an empty diff", () => {
    expect(parseDiff("")).toEqual([]);
    expect(parseDiff("\n")).toEqual([]);
  });

  it("numbers a mixed add/del/ctx hunk against the right file", () => {
    const [f] = parseDiff(MODIFY);
    expect(f?.newPath).toBe("src/auth/tokens.ts");
    expect(f?.oldPath).toBe("src/auth/tokens.ts");
    const lines = f!.hunks[0]!.lines;
    // @@ -12,7 +12,8 @@ — both files start at 12, and the two added lines push
    // the new-file numbering one ahead from there on.
    expect(lines.map((l) => [l.type, l.oldNo, l.newNo])).toEqual([
      ["ctx", 12, 12],
      ["ctx", 13, 13],
      ["ctx", 14, 14],
      ["del", 15, undefined],
      ["add", undefined, 15],
      ["add", undefined, 16],
      ["ctx", 16, 17],
      ["ctx", 17, 18],
      ["ctx", 18, 19],
    ]);
    expect(lines[3]!.text).toBe("export async function rotate(t: string) {");
    expect(counts(f!)).toEqual({ add: 2, del: 1 });
    expect(fileLabel(f!).note).toBeNull();
  });

  it("reads a new file as /dev/null → path, numbering from 1", () => {
    const [f] = parseDiff(NEW_FILE);
    expect(f?.oldPath).toBe("/dev/null");
    expect(fileLabel(f!)).toEqual({ path: "scripts/backfill.mjs", note: "new file" });
    expect(f!.hunks[0]!.lines.map((l) => l.newNo)).toEqual([1, 2, 3]);
    expect(f!.hunks[0]!.lines.every((l) => l.type === "add")).toBe(true);
  });

  it("reads a deleted file, numbering the removals in the old file", () => {
    const [f] = parseDiff(DELETED);
    expect(f?.newPath).toBe("/dev/null");
    expect(fileLabel(f!)).toEqual({ path: "src/legacy/stripe.ts", note: "deleted" });
    expect(f!.hunks[0]!.lines.map((l) => [l.type, l.oldNo])).toEqual([
      ["del", 1],
      ["del", 2],
    ]);
    expect(counts(f!)).toEqual({ add: 0, del: 2 });
  });

  it("keeps both sides of a rename", () => {
    const [f] = parseDiff(RENAME);
    expect(f?.oldPath).toBe("src/util.ts");
    expect(f?.newPath).toBe("src/lib/util.ts");
    expect(fileLabel(f!)).toEqual({ path: "src/lib/util.ts", note: "renamed from src/util.ts" });
  });

  it("marks a binary file instead of inventing lines for it", () => {
    const [f] = parseDiff(BINARY);
    expect(f?.binary).toBe(true);
    expect(f?.hunks).toEqual([]);
  });

  it("splits a multi-file diff and keeps each file's hunks with it", () => {
    const files = parseDiff([MODIFY, NEW_FILE, DELETED, BINARY].join(""));
    expect(files.map((f) => f.newPath)).toEqual([
      "src/auth/tokens.ts",
      "scripts/backfill.mjs",
      "/dev/null",
      "assets/logo.png",
    ]);
    expect(files.map((f) => f.hunks.length)).toEqual([1, 1, 1, 0]);
  });

  it("treats a body line that looks like a header as payload", () => {
    // A deletion of a literal "--- x" line: only the hunk's counts can tell it
    // apart from the next file's header, which is why they drive the parse.
    const [f] = parseDiff(`--- a/doc.md
+++ b/doc.md
@@ -1,2 +1,1 @@
---- old rule
 kept
`);
    expect(f!.hunks[0]!.lines.map((l) => [l.type, l.text])).toEqual([
      ["del", "--- old rule"],
      ["ctx", "kept"],
    ]);
  });

  it("handles a one-line hunk header with no counts", () => {
    const [f] = parseDiff(`--- a/x\n+++ b/x\n@@ -7 +7 @@\n-a\n+b\n`);
    expect(f!.hunks[0]!.lines).toEqual([
      { type: "del", text: "a", oldNo: 7 },
      { type: "add", text: "b", newNo: 7 },
    ]);
  });
});

describe("planRows", () => {
  // The fold's index arithmetic broke once and rendered the wrong run, so the
  // shape of the plan — not just its length — is what's pinned here.
  const run = (n: number, type: DiffLine["type"] = "ctx"): DiffLine[] =>
    Array.from({ length: n }, (_, i) => ({ type, text: `${type}${i}` }));

  it("folds a run longer than six into one row that names the whole run", () => {
    const rows = planRows(run(10), []);
    expect(rows).toEqual([{ kind: "fold", at: 0, n: 10 }]);
  });

  it("opens that same run into every one of its lines", () => {
    const lines = run(10);
    const rows = planRows(lines, [0]);
    expect(rows).toHaveLength(10);
    expect(rows.map((r) => (r.kind === "line" ? r.at : "fold"))).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(rows.every((r) => r.kind === "line")).toBe(true);
  });

  it("leaves a six-line run alone — the threshold is strictly more than six", () => {
    expect(planRows(run(6), []).every((r) => r.kind === "line")).toBe(true);
    expect(planRows(run(7), [])).toEqual([{ kind: "fold", at: 0, n: 7 }]);
  });

  it("never folds adds or deletes, however many in a row", () => {
    const lines = [...run(20, "add"), ...run(20, "del")];
    expect(planRows(lines, []).every((r) => r.kind === "line")).toBe(true);
  });

  it("keeps order, and folds at the index the run starts at", () => {
    // 2 ctx, 1 add, 8 ctx, 1 del, 2 ctx — only the middle run is long enough.
    const lines = [...run(2), ...run(1, "add"), ...run(8), ...run(1, "del"), ...run(2)];
    expect(planRows(lines, [])).toEqual([
      { kind: "line", at: 0, line: lines[0] },
      { kind: "line", at: 1, line: lines[1] },
      { kind: "line", at: 2, line: lines[2] },
      { kind: "fold", at: 3, n: 8 },
      { kind: "line", at: 11, line: lines[11] },
      { kind: "line", at: 12, line: lines[12] },
      { kind: "line", at: 13, line: lines[13] },
    ]);
    // Opening the run at 3 restores lines 3..10 in place, nothing else moves.
    const open = planRows(lines, [3]);
    expect(open).toHaveLength(14);
    expect(open.map((r) => (r.kind === "line" ? r.line.text : "fold"))).toEqual(lines.map((l) => l.text));
  });
});

describe("tooLargeToRender", () => {
  const file = (n: number): DiffFile => ({
    oldPath: "x",
    newPath: "x",
    binary: false,
    hunks: [{ header: "@@", lines: Array.from({ length: n }, () => ({ type: "add" as const, text: "x" })) }],
  });

  it("adds up lines across files and hunks", () => {
    expect(lineCount([file(3), file(4)])).toBe(7);
    expect(lineCount([])).toBe(0);
  });

  it("renders in full right up to the limit and summarises past it", () => {
    expect(tooLargeToRender([file(RENDER_LINE_LIMIT)])).toBe(false);
    expect(tooLargeToRender([file(RENDER_LINE_LIMIT + 1)])).toBe(true);
    // A regenerated lockfile arrives as one enormous file, not many small ones.
    expect(tooLargeToRender([file(20_000)])).toBe(true);
    expect(tooLargeToRender(parseDiff(MODIFY))).toBe(false);
  });
});

describe("parseMarkdown", () => {
  it("reads headings at their level", () => {
    expect(parseMarkdown("# One\n### Three")).toEqual([
      { kind: "heading", level: 1, spans: [{ text: "One" }] },
      { kind: "heading", level: 3, spans: [{ text: "Three" }] },
    ]);
  });

  it("styles bold, italic, inline code and links", () => {
    const [b] = parseMarkdown("run **now**, or _later_, via `npm run dev` — see [docs](https://x.invalid)");
    expect(b).toEqual({
      kind: "para",
      spans: [
        { text: "run " },
        { text: "now", style: "bold" },
        { text: ", or " },
        { text: "later", style: "italic" },
        { text: ", via " },
        { text: "npm run dev", style: "code" },
        { text: " — see " },
        { text: "docs", style: "link" },
      ],
    });
  });

  it("keeps a fenced block verbatim, newlines and all", () => {
    expect(parseMarkdown("intro\n\n```bash\nnpm i\nnpm test\n```\n")).toEqual([
      { kind: "para", spans: [{ text: "intro" }] },
      { kind: "code", text: "npm i\nnpm test" },
    ]);
  });

  it("reads bullet and numbered lists, keeping the number", () => {
    expect(parseMarkdown("- one\n* two\n1. first\n2. second")).toEqual([
      { kind: "item", marker: "•", spans: [{ text: "one" }] },
      { kind: "item", marker: "•", spans: [{ text: "two" }] },
      { kind: "item", marker: "1.", spans: [{ text: "first" }] },
      { kind: "item", marker: "2.", spans: [{ text: "second" }] },
    ]);
  });

  it("passes plain text through as one paragraph per blank-line block", () => {
    expect(parseMarkdown("just words\nwrapped hard\n\nand a second one")).toEqual([
      { kind: "para", spans: [{ text: "just words wrapped hard" }] },
      { kind: "para", spans: [{ text: "and a second one" }] },
    ]);
    expect(parseMarkdown("")).toEqual([]);
  });
});

describe("bytes", () => {
  it("counts bytes under a kilobyte", () => {
    expect(bytes(0)).toBe("0 B");
    expect(bytes(840)).toBe("840 B");
  });
  it("shows one decimal under ten of a unit and none above", () => {
    expect(bytes(1_229)).toBe("1.2 KB");
    expect(bytes(3.4 * 1024 * 1024)).toBe("3.4 MB");
    expect(bytes(12 * 1024 * 1024 * 1024)).toBe("12 GB");
  });
  it("refuses to invent a size it does not have", () => {
    expect(bytes(-1)).toBe("—");
    expect(bytes(Number.NaN)).toBe("—");
  });
});

describe("crumbs", () => {
  it("keeps the root whole and one crumb per segment below it", () => {
    expect(crumbs("D:\\projects\\api", "D:\\projects\\api\\src\\auth")).toEqual([
      { label: "D:\\projects\\api", path: "D:\\projects\\api" },
      { label: "src", path: "D:\\projects\\api\\src" },
      { label: "auth", path: "D:\\projects\\api\\src\\auth" },
    ]);
  });
  it("is just the root at the top of the tree", () => {
    expect(crumbs("D:\\work", "D:\\work")).toEqual([{ label: "D:\\work", path: "D:\\work" }]);
  });
  it("never claims a hierarchy for a dir outside the root", () => {
    expect(crumbs("D:\\work", "C:\\other")).toEqual([{ label: "C:\\other", path: "C:\\other" }]);
  });
  it("matches whole segments only — D:\\work is not the root of D:\\workspace", () => {
    expect(crumbs("D:\\work", "D:\\workspace\\x")).toEqual([{ label: "D:\\workspace\\x", path: "D:\\workspace\\x" }]);
  });
  it("handles a root written with a trailing separator", () => {
    expect(crumbs("D:\\", "D:\\work")).toEqual([
      { label: "D:\\", path: "D:\\" },
      { label: "work", path: "D:\\work" },
    ]);
  });
  it("uses the separator the root is written with", () => {
    expect(crumbs("/home/y/code", "/home/y/code/app/src")).toEqual([
      { label: "/home/y/code", path: "/home/y/code" },
      { label: "app", path: "/home/y/code/app" },
      { label: "src", path: "/home/y/code/app/src" },
    ]);
  });
});
