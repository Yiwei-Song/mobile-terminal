// A deliberately small markdown parser: the subset a README on a phone actually
// needs, as a pure function so the renderer is a dumb map over blocks.
//
// ponytail: no dependency and no AST — headings, lists, fences, and four inline
// forms. Anything richer (tables, nested lists, images) renders as its raw text,
// which is why the viewer keeps a raw toggle. Reach for a real markdown library
// only if that becomes the common case.

export type MdSpan = { text: string; style?: "bold" | "italic" | "code" | "link" };

export type MdBlock =
  | { kind: "heading"; level: number; spans: MdSpan[] }
  | { kind: "para"; spans: MdSpan[] }
  | { kind: "item"; marker: string; spans: MdSpan[] }
  | { kind: "code"; text: string };

const INLINE = /\*\*([^*]+)\*\*|__([^_]+)__|\*([^*\n]+)\*|_([^_\n]+)_|`([^`]+)`|\[([^\]]*)\]\(([^)]*)\)/g;

/** Split one line of text into styled spans. Unmatched text passes through. */
export function parseInline(src: string): MdSpan[] {
  const out: MdSpan[] = [];
  let at = 0;
  INLINE.lastIndex = 0;
  for (let m = INLINE.exec(src); m !== null; m = INLINE.exec(src)) {
    if (m.index > at) out.push({ text: src.slice(at, m.index) });
    const bold = m[1] ?? m[2];
    const italic = m[3] ?? m[4];
    if (bold !== undefined) out.push({ text: bold, style: "bold" });
    else if (italic !== undefined) out.push({ text: italic, style: "italic" });
    else if (m[5] !== undefined) out.push({ text: m[5], style: "code" });
    // An empty link text is a bare URL: show the target, never nothing.
    else out.push({ text: m[6] === "" || m[6] === undefined ? (m[7] ?? "") : m[6], style: "link" });
    at = m.index + m[0].length;
  }
  if (at < src.length) out.push({ text: src.slice(at) });
  return out;
}

/** Split a markdown document into renderable blocks. */
export function parseMarkdown(src: string): MdBlock[] {
  const out: MdBlock[] = [];
  const lines = src.split(/\r?\n/);
  let para: string[] = [];
  const flush = () => {
    if (para.length === 0) return;
    out.push({ kind: "para", spans: parseInline(para.join(" ")) });
    para = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^\s*```/.test(line)) {
      flush();
      const body: string[] = [];
      for (i++; i < lines.length && !/^\s*```/.test(lines[i]!); i++) body.push(lines[i]!);
      out.push({ kind: "code", text: body.join("\n") });
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h !== null) {
      flush();
      out.push({ kind: "heading", level: h[1]!.length, spans: parseInline(h[2]!) });
      continue;
    }
    const b = /^\s*[-*+]\s+(.*)$/.exec(line);
    if (b !== null) {
      flush();
      out.push({ kind: "item", marker: "•", spans: parseInline(b[1]!) });
      continue;
    }
    const n = /^\s*(\d+)[.)]\s+(.*)$/.exec(line);
    if (n !== null) {
      flush();
      out.push({ kind: "item", marker: `${n[1]}.`, spans: parseInline(n[2]!) });
      continue;
    }
    if (line.trim() === "") {
      flush();
      continue;
    }
    para.push(line.trim());
  }
  flush();
  return out;
}
