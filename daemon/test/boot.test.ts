import { describe, it, expect, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Manifest } from "../src/sessions/manifest.js";
import { runBootResume, bootSideEffects } from "../src/boot.js";
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

  // The lock-on-start decision (index.ts) is extracted into bootSideEffects so
  // it's testable without launching the whole daemon. Flag off = the machine is
  // never locked by a manual `npm run dev`; normalize still runs either way.
  it("bootSideEffects(false) yields no-op lock/notify but still normalizes when run", () => {
    const m = new Manifest(mkdtempSync(join(tmpdir(), "wb-")));
    seed(m, "run", "running");
    const real = { lock: vi.fn(), notify: vi.fn() };

    runBootResume(m, bootSideEffects(false, real));

    expect(real.lock).not.toHaveBeenCalled();
    expect(real.notify).not.toHaveBeenCalled();
    // normalize still ran despite the no-op side-effects.
    expect(m.list().find((e) => e.sessionId === "run")?.status).toBe("idle");
  });

  it("bootSideEffects(true) passes the real lock/notify through", () => {
    const real = { lock: vi.fn(), notify: vi.fn() };
    const deps = bootSideEffects(true, real);
    deps.lock();
    deps.notify("t", "b");
    expect(real.lock).toHaveBeenCalledOnce();
    expect(real.notify).toHaveBeenCalledOnce();
  });
});
