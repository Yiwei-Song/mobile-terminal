import { describe, it, expect } from "vitest";
import { detectTailscale } from "../src/tailscale.js";
import type { Exec } from "../src/files.js";

const TS = "C:\\Program Files\\Tailscale\\tailscale.exe";
const V6 = "fd7a:115c:a1e0:ab12:4843:cd96:6250:1a2b";

// An injected exec that answers from a table and rejects (ENOENT-style) for
// anything absent — the same shape a missing tailscale.exe produces.
const fakeExec = (table: Record<string, string>, calls: string[] = []): Exec => (file, args) => {
  const key = `${file} ${args.join(" ")}`;
  calls.push(key);
  const out = table[key];
  return out === undefined ? Promise.reject(new Error("ENOENT")) : Promise.resolve(out);
};

describe("detectTailscale", () => {
  it("prefers the tailnet IPv6 address and reports a direct path", async () => {
    const calls: string[] = [];
    const exec = fakeExec(
      {
        [`${TS} ip -6`]: `${V6}\n`,
        [`${TS} ip -4`]: "100.101.102.103\n",
        [`${TS} status`]: `100.101.102.103 omen16 me@ windows -\n100.64.0.9 phone me@ iOS active; direct 81.2.3.4:41641, tx 12 rx 34\n`,
      },
      calls,
    );
    expect(await detectTailscale(exec)).toEqual({ host: V6, path: "direct" });
    // -6 answered, so -4 is never asked: IPv6 is the address Mullvad lets through.
    expect(calls).not.toContain(`${TS} ip -4`);
  });

  it("reports a relayed path, and falls back to IPv4 when there is no tailnet IPv6", async () => {
    const exec = fakeExec({
      [`${TS} ip -6`]: "\n",
      [`${TS} ip -4`]: "100.101.102.103\n",
      [`${TS} status`]: `100.64.0.9 phone me@ iOS active; relay "sea", tx 12 rx 34\n`,
    });
    expect(await detectTailscale(exec)).toEqual({ host: "100.101.102.103", path: "relayed" });
  });

  it("falls back to PATH when the absolute install path is missing", async () => {
    const exec = fakeExec({ "tailscale ip -6": `${V6}\n`, "tailscale status": "" });
    expect(await detectTailscale(exec)).toEqual({ host: V6, path: null });
  });

  it("returns null when Tailscale is not installed", async () => {
    expect(await detectTailscale(fakeExec({}))).toBeNull();
  });

  it("returns null on malformed output rather than pairing a bogus host", async () => {
    const exec = fakeExec({
      [`${TS} ip -6`]: "Tailscale is stopped.\n",
      [`${TS} ip -4`]: "no addresses\n",
      "tailscale ip -6": "",
      "tailscale ip -4": "  ",
    });
    expect(await detectTailscale(exec)).toBeNull();
  });

  it("never fails the daemon start when status errors", async () => {
    // ip works, status does not (tailscaled restarting) — an address with no
    // latency hint is still worth pairing.
    const exec = fakeExec({ [`${TS} ip -6`]: `${V6}\n` });
    expect(await detectTailscale(exec)).toEqual({ host: V6, path: null });
  });
});
