import { describe, expect, it } from "vitest";

import { collapse, COLLAPSE_LINES, JUMP_THRESHOLD, showJump, toolLabel } from "../src/lib/tools";

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

describe("showJump", () => {
  it("hides the pill near the newest item and shows it once scrolled away", () => {
    expect(showJump(0)).toBe(false);
    expect(showJump(JUMP_THRESHOLD)).toBe(false);
    expect(showJump(JUMP_THRESHOLD + 1)).toBe(true);
  });
});
