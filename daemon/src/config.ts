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
  // A truncated/edited config.json would give token: undefined, and an auth check
  // comparing it to an absent client token would pass. Fail loud instead.
  if (typeof raw.token !== "string" || raw.token === "") {
    throw new Error(`${file}: missing token — delete the file to regenerate`);
  }
  return { ...raw, dataDir };
}

// The one setting the phone can change. Mutates cfg as well as the file: the
// daemon's notify closure reads cfg on every event, so a disk-only write would
// need a restart to take effect. Re-reads the file rather than serializing our
// own Config — that would write dataDir into it and could clobber a token or
// port edited since load.
export function setNtfyTopic(cfg: Config, ntfyTopic: string | null): void {
  cfg.ntfyTopic = ntfyTopic;
  const file = join(cfg.dataDir, "config.json");
  const raw = JSON.parse(readFileSync(file, "utf8"));
  writeFileSync(file, JSON.stringify({ ...raw, ntfyTopic }, null, 2));
}
