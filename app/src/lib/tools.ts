// Pure helpers the session screen leans on. They live here, not in a component,
// because they are the only logic on that screen worth a test.

// Friendly labels for the raw tool names the daemon forwards. Anything unmapped
// shows its raw name — a made-up label would misdescribe a tool we don't know.
const LABELS: Record<string, string> = {
  Bash: "Run command",
  Edit: "Edit file",
  MultiEdit: "Edit file",
  Write: "Write file",
  NotebookEdit: "Edit notebook",
  Read: "Read file",
  Grep: "Search",
  Glob: "Find files",
  WebFetch: "Fetch URL",
  WebSearch: "Web search",
};

export const toolLabel = (name: string): string => LABELS[name] ?? name;

// A tool line longer than this collapses to its first line until tapped.
export const COLLAPSE_LINES = 3;

export interface Collapsed {
  collapsible: boolean;
  first: string;
  hidden: number;
}

/** Decide whether a multi-line tool summary should collapse, and to what. */
export const collapse = (text: string): Collapsed => {
  const lines = text.split("\n");
  return { collapsible: lines.length > COLLAPSE_LINES, first: lines[0] ?? "", hidden: lines.length - 1 };
};

// The transcript is an inverted list: offset 0 is the newest message. Once the
// user has scrolled this far from it, a new item must not yank them back down —
// the jump pill offers the trip instead.
export const JUMP_THRESHOLD = 240;
export const showJump = (offsetY: number): boolean => offsetY > JUMP_THRESHOLD;
