import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { SessionRow, SessionStatus } from "../protocol.js";

// The manifest entry IS the sessions.list row; protocol.ts owns the shape so the
// app gets it from shared/protocol.ts. Alias kept — every caller here says entry.
export type ManifestEntry = SessionRow;

// List order = attention order: what needs the user first, what is dead last.
const ORDER: SessionStatus[] = ["waiting_on_user", "running", "idle", "dead"];

export class Manifest {
  private file: string;
  private entries = new Map<string, ManifestEntry>();

  constructor(dataDir: string) {
    this.file = join(dataDir, "sessions.json");
    if (existsSync(this.file)) {
      try {
        for (const e of JSON.parse(readFileSync(this.file, "utf8")) as ManifestEntry[]) {
          this.entries.set(e.sessionId, e);
        }
      } catch {
        // Torn or hand-edited file: don't brick the daemon. Move it aside and
        // boot empty. renameSync overwrites any prior .corrupt on Windows and
        // POSIX alike, so no clock-suffix (banned) or unlink dance is needed.
        renameSync(this.file, `${this.file}.corrupt`);
      }
    }
  }

  // ponytail: write-through on every mutation, no debounce. Sessions change a
  // few times a minute, not a second — batch it if that ever stops being true.
  // Write-then-rename: a crash mid-write must not leave truncated JSON here,
  // or the constructor's parse would throw on every boot after — bricking the
  // reboot-resume path this file exists to serve.
  private flush(): void {
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify([...this.entries.values()], null, 2));
    renameSync(tmp, this.file);
  }

  upsert(e: ManifestEntry): void {
    this.entries.set(e.sessionId, e);
    this.flush();
  }

  // No CLI survives the daemon that spawned it, so every non-dead status on
  // disk is a lie the moment we boot: `running`/`waiting_on_user` would show
  // the phone phantom activity that interrupt cannot stop. Only `sessions.send`
  // (which resumes) can revive one — which is exactly `idle`.
  normalizeAfterRestart(): void {
    for (const e of this.entries.values()) {
      if (e.status !== "dead") e.status = "idle";
    }
    this.flush();
  }

  remove(sessionId: string): void {
    this.entries.delete(sessionId);
    this.flush();
  }

  list(): ManifestEntry[] {
    // sort is stable, so same-status entries keep insertion order.
    return [...this.entries.values()].sort((a, b) => rank(a.status) - rank(b.status));
  }
}

// An unknown status (hand-edited sessions.json) sorts last, not first —
// indexOf would return -1 and float it above waiting_on_user.
const rank = (s: SessionStatus): number => {
  const i = ORDER.indexOf(s);
  return i === -1 ? ORDER.length : i;
};
