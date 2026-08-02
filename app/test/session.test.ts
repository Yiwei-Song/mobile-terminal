import { describe, expect, it } from "vitest";

import { collapse, COLLAPSE_LINES, JUMP_THRESHOLD, runStartIds, showJump, toolLabel } from "../src/lib/tools";
import type { TranscriptItem } from "../src/lib/store";

const user = (id: string): TranscriptItem => ({ id, kind: "text", role: "user", text: "do it" });
const bot = (id: string): TranscriptItem => ({ id, kind: "text", role: "assistant", text: "on it" });
const tool = (id: string): TranscriptItem => ({ id, kind: "tool", name: "Read", summary: "a.ts" });
const done = (id: string): TranscriptItem => ({ id, kind: "done", ok: true, costUsd: null });

describe("toolLabel", () => {
  it("maps known tools to a friendly verb and passes the rest through", () => {
    expect(toolLabel("Bash")).toBe("Run command");
    expect(toolLabel("Edit")).toBe("Edit file");
    expect(toolLabel("Read")).toBe("Read file");
    // An unknown tool keeps its raw name rather than inventing a label.
    expect(toolLabel("SomeMcpTool")).toBe("SomeMcpTool");
  });
});

describe("collapse", () => {
  it("leaves a short summary alone", () => {
    const c = collapse("one\ntwo\nthree");
    expect(c.collapsible).toBe(false);
    expect(c.first).toBe("one");
  });

  it("collapses past the threshold to the first line, counting the rest", () => {
    const text = Array.from({ length: COLLAPSE_LINES + 2 }, (_, i) => `line ${i}`).join("\n");
    const c = collapse(text);
    expect(c.collapsible).toBe(true);
    expect(c.first).toBe("line 0");
    expect(c.hidden).toBe(COLLAPSE_LINES + 1);
  });

  it("does not crash on an empty summary", () => {
    expect(collapse("")).toEqual({ collapsible: false, first: "", hidden: 0 });
  });
});

describe("runStartIds", () => {
  it("marks the agent item AFTER your message, never the one before it", () => {
    // b1 answers u1: the mark belongs to b1. The direction error would put it
    // on b0, the last thing said before you interrupted.
    const ids = runStartIds([bot("b0"), user("u1"), bot("b1"), tool("t1"), bot("b2")]);
    expect([...ids]).toEqual(["b0", "b1"]);
    expect(ids.has("u1")).toBe(false);
  });

  it("marks the first agent item of each run and nothing else in it", () => {
    const ids = runStartIds([user("u1"), tool("t1"), bot("b1"), tool("t2"), user("u2"), bot("b2")]);
    expect([...ids]).toEqual(["t1", "b2"]);
  });

  it("opens a run at the top of a transcript that starts with the agent", () => {
    expect([...runStartIds([bot("b1"), bot("b2")])]).toEqual(["b1"]);
  });

  it("treats a done marker as the end of the run", () => {
    // The turn finished; whatever the agent says next is a new run, even with
    // nothing of yours between them.
    expect([...runStartIds([user("u1"), bot("b1"), done("d1"), bot("b2")])]).toEqual(["b1", "b2"]);
  });

  it("has nothing to mark in an empty or user-only transcript", () => {
    expect(runStartIds([]).size).toBe(0);
    expect(runStartIds([user("u1"), user("u2")]).size).toBe(0);
  });
});

describe("showJump", () => {
  it("hides the pill near the newest item and shows it once scrolled away", () => {
    expect(showJump(0)).toBe(false);
    expect(showJump(JUMP_THRESHOLD)).toBe(false);
    expect(showJump(JUMP_THRESHOLD + 1)).toBe(true);
  });
});
