import { describe, it, expect } from "vitest";
import { ntfyFor } from "../src/notify.js";

describe("ntfyFor", () => {
  it("says what happened and to which session, and nothing else", () => {
    const perm = ntfyFor(
      { kind: "session.permission", sessionId: "s1", requestId: "r1", toolName: "Bash", summary: "", cwd: "" },
      "fix the login bug",
    );
    expect(perm).toEqual({ title: "Workbench", body: "Approval needed · fix the login bug" });
    expect(ntfyFor({ kind: "session.done", sessionId: "s1", ok: true, costUsd: null }, "fix the login bug")).toEqual({
      title: "Workbench",
      body: "Finished · fix the login bug",
    });
  });

  it("carries no tool detail from the event it was handed", () => {
    // A lock screen is a public surface: the summary the phone shows in-app
    // must never reach a push body.
    const n = ntfyFor(
      {
        kind: "session.permission",
        sessionId: "s1",
        requestId: "r1",
        toolName: "Bash",
        summary: "Bash: rm -rf C:\\secrets",
        cwd: "C:\\secrets",
      },
      "deploy",
    );
    expect(n!.body).not.toMatch(/Bash|rm -rf|C:\\/);
  });

  it("wakes nobody for ordinary chatter", () => {
    expect(ntfyFor({ kind: "session.text", sessionId: "s1", role: "assistant", text: "hi" }, "deploy")).toBeNull();
  });
});
