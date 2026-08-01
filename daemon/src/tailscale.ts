// Where the phone can reach this machine from *outside* the house.
//
// Detection goes through the CLI, not the interface list: `tailscale ip` is a
// stable documented command, whereas scraping networkInterfaces() for the
// tailnet prefix breaks the moment Tailscale renames its adapter.
import type { Exec } from "./files.js";

// The installer does not reliably put tailscale.exe on PATH, so the default
// install location is tried first and PATH is the fallback.
const EXES = ["C:\\Program Files\\Tailscale\\tailscale.exe", "tailscale"];

// A hung `tailscale status` must not stop the daemon printing its QR.
const MS = 3_000;

export interface Tailnet {
  host: string;
  /** "direct" | "relayed" for latency; null when no peer is active yet. */
  path: string | null;
}

/** The tailnet address of this machine, or null if Tailscale isn't usable here. */
export async function detectTailscale(exec: Exec): Promise<Tailnet | null> {
  const timer = new Promise<null>((r) => setTimeout(r, MS, null).unref());
  return Promise.race([probe(exec), timer]);
}

async function probe(exec: Exec): Promise<Tailnet | null> {
  for (const exe of EXES) {
    // -6 first, and not only for tidiness: Mullvad's always-on firewall blocks
    // Tailscale's IPv4 range (100.64.0.0/10) by design, but allows fc00::/7,
    // which contains the tailnet's fd7a:115c:a1e0::/48. IPv6 is the address
    // that actually works from the phone.
    for (const flag of ["-6", "-4"]) {
      const host = firstIp(await exec(exe, ["ip", flag]).catch(() => ""));
      if (host) return { host, path: await relayPath(exec, exe) };
    }
  }
  return null;
}

// Not installed / not logged in / "Tailscale is stopped." all land here as
// output with no address in it, and that is a silent fall back to the LAN.
const firstIp = (out: string): string | null =>
  out
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => /^[0-9a-f][0-9a-f.:]*$/i.test(l) && /[.:]/.test(l)) ?? null;

// `tailscale status` annotates ACTIVE peers with `direct <ip>:<port>` or
// `relay "<derp>"`. With no phone connected yet there is nothing to report, so
// null (print nothing) is the honest answer, not "unknown".
async function relayPath(exec: Exec, exe: string): Promise<string | null> {
  const out = await exec(exe, ["status"]).catch(() => "");
  if (/\bdirect \d/.test(out)) return "direct";
  if (/\brelay "/.test(out)) return "relayed";
  return null;
}
