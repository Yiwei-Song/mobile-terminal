import { describe, it, expect } from "vitest";
import { VERSION } from "../src/version.js";

describe("scaffold", () => {
  it("exports a version", () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
