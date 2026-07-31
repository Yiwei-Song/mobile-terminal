import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

export interface Config {
  token: string;
  port: number;
  ntfyTopic: string | null;
  dataDir: string;
}

export function loadConfig(dir?: string): Config {
  const dataDir = dir ?? join(process.env.APPDATA ?? ".", "workbench");
  mkdirSync(dataDir, { recursive: true });
  const file = join(dataDir, "config.json");
  if (!existsSync(file)) {
    const fresh = {
      token: randomBytes(32).toString("hex"),
      port: 8790,
      ntfyTopic: null,
    };
    writeFileSync(file, JSON.stringify(fresh, null, 2));
  }
  const raw = JSON.parse(readFileSync(file, "utf8"));
  return { ...raw, dataDir };
}
