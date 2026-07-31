import { describe, it, expect, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Manifest } from "../src/sessions/manifest.js";
import { runBootResume } from "../src/boot.js";
import type { SessionStatus } from "../src/protocol.js";

const seed = (m: Manifest, sessionId: string, status: SessionStatus) =>
  m.upsert({ sessionId, agent: "claude", cwd: "C:\\p", title: sessionId, status, updatedAt: "" });

describe("runBootResume", () => {
  it("normalizes stale rows, locks, and notifies with the restored count", () => {
    const m = new Manifest(mkdtempSync(join(tmpdir(), "wb-")));
    seed(m, "run", "running");
    seed(m, "idle", "idle");
    seed(m, "dead", "dead");

    const lock = vi.fn();
    const notify = vi.fn();
    runBootResume(m, { lock, notify });

    // running -> idle (revivable), idle stays idle, dead stays dead.
    const byId = Object.fromEntries(m.list().map((e) => [e.sessionId, e.status]));
    expect(byId).toEqual({ run: "idle", idle: "idle", dead: "dead" });

    expect(lock).toHaveBeenCalledOnce();
    // Two non-dead rows came back; the dead one is not counted as restored.
    expect(notify).toHaveBeenCalledOnce();
    expect(notify.mock.calls[0][1]).toContain("2 sessions restored");
  });
});
