import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config.js";

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
});
