import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, setNtfyTopic } from "../src/config.js";

describe("config", () => {
  it("creates config with a 64-hex token on first run and reloads the same one", () => {
    const dir = mkdtempSync(join(tmpdir(), "wb-"));
    const a = loadConfig(dir);
    expect(a.token).toMatch(/^[0-9a-f]{64}$/);
    expect(a.port).toBe(8790);
    const onDisk = JSON.parse(readFileSync(join(dir, "config.json"), "utf8"));
    expect(onDisk.token).toBe(a.token);
    const b = loadConfig(dir);
    expect(b.token).toBe(a.token); // idempotent
  });

  it("persists ntfyTopic without clobbering the rest of the file", () => {
    const dir = mkdtempSync(join(tmpdir(), "wb-"));
    const cfg = loadConfig(dir);

    setNtfyTopic(cfg, "wb-abc123");
    // In-memory too: the daemon's notify closure reads cfg on every event, so a
    // topic that only landed on disk would need a restart to take effect.
    expect(cfg.ntfyTopic).toBe("wb-abc123");
    const reloaded = loadConfig(dir);
    expect(reloaded.ntfyTopic).toBe("wb-abc123");
    expect(reloaded.token).toBe(cfg.token);
    expect(reloaded.port).toBe(8790);

    setNtfyTopic(cfg, null); // clearing is a supported state, not a missing key
    expect(loadConfig(dir).ntfyTopic).toBeNull();
    expect(loadConfig(dir).token).toBe(cfg.token);
  });

  it("collapses an empty topic to null instead of storing it", () => {
    const dir = mkdtempSync(join(tmpdir(), "wb-"));
    const cfg = loadConfig(dir);
    setNtfyTopic(cfg, "");
    // "" would post to https://ntfy.sh/ and report back as configured.
    expect(cfg.ntfyTopic).toBeNull();
    expect(loadConfig(dir).ntfyTopic).toBeNull();
  });

  it("throws on a config with no token instead of returning undefined", () => {
    const dir = mkdtempSync(join(tmpdir(), "wb-"));
    writeFileSync(join(dir, "config.json"), '{"port":8790}');
    expect(() => loadConfig(dir)).toThrow(/missing token/);
  });
});
