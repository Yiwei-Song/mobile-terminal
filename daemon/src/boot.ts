import type { Manifest } from "./sessions/manifest.js";

export interface BootDeps {
  lock: () => void; // privacy-by-default: the machine may reboot unattended
  notify: (title: string, body: string) => void; // one ntfy that it's back
}

// Run once at daemon startup. A killed daemon leaves its live rows frozen as
// running/waiting_on_user, so first clear them to idle (normalizeAfterRestart)
// — no session work auto-continues (Plan 1: sessions come back idle, the user
// taps to resume). Then lock the screen and ping the phone with the count that
// survived the reboot. `registry` is intentionally not a parameter: with no
// auto-continue there is nothing here for it to do.
export function runBootResume(manifest: Manifest, { lock, notify }: BootDeps): void {
  manifest.normalizeAfterRestart();
  lock();
  // Dead sessions are gone for good; everything else came back (as idle).
  const restored = manifest.list().filter((s) => s.status !== "dead").length;
  notify("Workbench", `Machine back online — ${restored} sessions restored`);
}
