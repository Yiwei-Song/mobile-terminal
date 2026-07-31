import { describe, it, expect } from "vitest";
import { ntfyBody } from "../src/notify.js";

describe("ntfyBody", () => {
  it("says what happened and to which session, and nothing else", () => {
    expect(ntfyBody("permission", "fix the login bug")).toBe("Approval needed · fix the login bug");
    expect(ntfyBody("done", "fix the login bug")).toBe("Finished · fix the login bug");
  });

  it("carries no tool detail even when one is handy", () => {
    // A lock screen is a public surface: the summary the phone shows in-app
    // ("Bash: rm -rf C:\\secrets") must never reach a push body.
    const body = ntfyBody("permission", "deploy");
    expect(body).not.toMatch(/Bash|rm -rf|C:\\/);
  });
});
