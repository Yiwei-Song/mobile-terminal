import { describe, it, expect } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readTranscript } from "../src/sessions/transcript.js";

const home = () => mkdtempSync(join(tmpdir(), "wb-tx-"));

function claude(h: string, id: string, lines: unknown[]): void {
  const dir = join(h, ".claude", "projects", "D--Proj");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${id}.jsonl`), lines.map((l) => JSON.stringify(l)).join("\n"));
}

function codex(h: string, id: string, lines: unknown[]): void {
  const dir = join(h, ".codex", "sessions", "2026", "08", "04");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `rollout-2026-08-04T00-00-00-${id}.jsonl`), lines.map((l) => JSON.stringify(l)).join("\n"));
}

describe("readTranscript", () => {
  // The shapes below are the real ones on OMEN16: a user prompt is a plain
  // string, tool results arrive as an array wearing the user's role, and
  // assistant content is a block list of text / thinking / tool_use.
  it("renders a Claude conversation and drops the machine's own noise", () => {
    const h = home();
    claude(h, "s1", [
      { type: "user", message: { role: "user", content: "Fix the login bug" } },
      { type: "assistant", message: { content: [{ type: "thinking", thinking: "internal monologue" }] } },
      { type: "assistant", message: { content: [{ type: "text", text: "On it." }] } },
      { type: "assistant", message: { content: [{ type: "tool_use", name: "Read", input: { file_path: "D:\\a.ts" } }] } },
      // A tool result is machine output wearing the user's role — the tool call
      // above already announced it, so showing both is scroll, not information.
      { type: "user", message: { role: "user", content: [{ type: "tool_result", content: "1\tconst x = 1" }] } },
    ]);

    expect(readTranscript(h, "claude", "s1")).toEqual([
      { kind: "text", role: "user", text: "Fix the login bug" },
      { kind: "text", role: "assistant", text: "On it." },
      { kind: "tool", name: "Read", summary: "Read: D:\\a.ts" },
    ]);
  });

  it("keeps only the newest entries, oldest-first, when a transcript is long", () => {
    const h = home();
    claude(
      h,
      "s2",
      Array.from({ length: 30 }, (_, i) => ({ type: "user", message: { role: "user", content: `m${i}` } })),
    );
    const out = readTranscript(h, "claude", "s2", 3);
    expect(out.map((e) => (e.kind === "text" ? e.text : ""))).toEqual(["m27", "m28", "m29"]);
  });

  // The agent may be mid-write; a half-flushed final line must cost that line
  // and nothing else.
  it("survives a torn final line", () => {
    const h = home();
    const dir = join(h, ".claude", "projects", "D--Proj");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "s3.jsonl"),
      `${JSON.stringify({ type: "user", message: { role: "user", content: "kept" } })}\n{"type":"assist`,
    );
    expect(readTranscript(h, "claude", "s3")).toEqual([{ kind: "text", role: "user", text: "kept" }]);
  });

  it("renders a Codex conversation and drops harness preamble", () => {
    const h = home();
    codex(h, "c1", [
      { type: "session_meta", payload: { id: "c1", cwd: "D:\\Proj", thread_source: "user" } },
      // Injected by the harness, not said by the owner.
      { type: "response_item", payload: { type: "message", role: "developer", content: [{ type: "input_text", text: "# AGENTS.md" }] } },
      { type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "<app-context>ignore me</app-context>" }] } },
      { type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "Ship the fix" }] } },
      { type: "response_item", payload: { type: "reasoning", summary: [] } },
      { type: "response_item", payload: { type: "custom_tool_call", name: "shell", input: "git status" } },
      { type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "Done." }] } },
      { type: "event_msg", payload: { type: "token_count", info: {} } },
    ]);

    expect(readTranscript(h, "codex", "c1")).toEqual([
      { kind: "text", role: "user", text: "Ship the fix" },
      { kind: "tool", name: "shell", summary: "shell: git status" },
      { kind: "text", role: "assistant", text: "Done." },
    ]);
  });

  // A conversation that cannot be read is empty, not an error: the screen has an
  // empty state, and a throw here would break a list that is otherwise fine.
  it("returns nothing for an unknown session or a missing store", () => {
    expect(readTranscript(home(), "claude", "nope")).toEqual([]);
    expect(readTranscript(home(), "codex", "nope")).toEqual([]);
  });
});
