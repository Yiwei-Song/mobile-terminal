import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Manifest } from "../src/sessions/manifest.js";
import type { SessionStatus } from "../src/protocol.js";

const entry = (id: string, status: SessionStatus) => ({
  sessionId: id,
  agent: "claude" as const,
  cwd: "C:\\proj",
  title: id,
  status,
  updatedAt: new Date().toISOString(),
});

describe("manifest", () => {
  it("persists across instances and sorts by attention", () => {
    const dir = mkdtempSync(join(tmpdir(), "wb-"));
    const m1 = new Manifest(dir);
    m1.upsert(entry("a", "idle"));
    m1.upsert(entry("b", "waiting_on_user"));
    m1.upsert(entry("c", "running"));
    const m2 = new Manifest(dir); // fresh instance reads disk
    expect(m2.list().map((e) => e.sessionId)).toEqual(["b", "c", "a"]);
    m2.remove("b");
    expect(new Manifest(dir).list().map((e) => e.sessionId)).toEqual(["c", "a"]);
  });

  it("upsert replaces an existing session instead of duplicating it", () => {
    const dir = mkdtempSync(join(tmpdir(), "wb-"));
    const m = new Manifest(dir);
    m.upsert(entry("a", "running"));
    m.upsert({ ...entry("a", "waiting_on_user"), title: "renamed" });
    const reloaded = new Manifest(dir).list();
    expect(reloaded).toHaveLength(1);
    expect(reloaded[0]).toMatchObject({ sessionId: "a", status: "waiting_on_user", title: "renamed" });
  });
});
