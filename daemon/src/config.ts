import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

export interface Config {
  token: string;
  port: number;
  ntfyTopic: string | null;
  dataDir: string;
  // Extra trees the phone may browse, on top of the cwds of known sessions.
  // Hand-edited into config.json; absent means "sessions only".
  fileRoots?: string[];
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
    writeConfig(file, fresh);
  }
  const raw = JSON.parse(readFileSync(file, "utf8"));
  // A truncated/edited config.json would give token: undefined, and an auth check
  // comparing it to an absent client token would pass. Fail loud instead.
  if (typeof raw.token !== "string" || raw.token === "") {
    throw new Error(`${file}: missing token — delete the file to regenerate`);
  }
  return { ...raw, dataDir };
}

// Write-then-rename: this file holds the pairing token, and a torn write would
// leave JSON that loadConfig throws on — unpairing the phone for good.
function writeConfig(file: string, data: unknown): void {
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2));
  renameSync(tmp, file);
}

// The one setting the phone can change. Mutates cfg as well as the file: the
// daemon's notify closure reads cfg on every event, so a disk-only write would
// need a restart to take effect. Re-reads the file rather than serializing our
// own Config — that would write dataDir into it and could clobber a token or
// port edited since load.
export function setNtfyTopic(cfg: Config, ntfyTopic: string | null): void {
  // "" is not a topic — it would post to https://ntfy.sh/ and read as configured.
  const topic = ntfyTopic || null;
  const file = join(cfg.dataDir, "config.json");
  const raw = JSON.parse(readFileSync(file, "utf8"));
  writeConfig(file, { ...raw, ntfyTopic: topic });
  // After the write, not before: a failed persist must not leave the running
  // daemon pushing to a topic that no restart would remember.
  cfg.ntfyTopic = topic;
}
