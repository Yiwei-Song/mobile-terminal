# Tailscale reachability — report

Goal: make the daemon reachable from the phone off the home wifi, given Mullvad
is permanently on and blocks Tailscale's IPv4 range (100.64.0.0/10) but allows
the tailnet's IPv6 range (fd7a:115c:a1e0::/48, inside the permitted fc00::/7).

## What changed

**1. Dual-stack bind (the critical one).** `daemon/src/server.ts` listened on
`"0.0.0.0"`, which on Windows is IPv4-ONLY — the daemon would never have
answered on the tailnet IPv6 address, and it would have looked like a Tailscale
problem. Now `cfg.bindHost ?? "::"`. A Windows dual-stack socket accepts IPv4
via IPv4-mapped addresses, so localhost/LAN are unchanged (the whole existing
suite connects over 127.0.0.1 and still passes). `Config.bindHost` is optional
and hand-editable into `config.json` to narrow it later.

**2. Tailscale detection + advertisement.** New `daemon/src/tailscale.ts`:
`detectTailscale(exec)` shells out to the CLI (stable API, unlike scraping
adapter names), trying `C:\Program Files\Tailscale\tailscale.exe` first and bare
`tailscale` from PATH second (the installer does not reliably set PATH). It asks
`ip -6` before `ip -4` — IPv6 is the address that survives Mullvad. Anything
that isn't an address (not installed, not logged in, "Tailscale is stopped.",
empty) falls back silently to today's LAN behaviour. The whole probe is capped
at 3s so a wedged `tailscaled` cannot stop the QR from printing.

`daemon/src/index.ts` prints every candidate and pairs (QR + ws URL) with the
tailnet address when there is one, else the LAN address as before.

**3. Startup diagnostics.** `tailscale status` annotates *active* peers with
`direct <ip>:<port>` or `relay "<derp>"`; that becomes one extra line. With no
peer connected there is nothing to report, so nothing is printed — best effort,
never fatal.

**4. IPv6 URL bracketing in the app.** This was a real latent bug:
`ws://fd7a:…:8790/ws` is not a URL — the address's own colons are read as the
port separator. `app/src/lib/pairing.ts` now routes both `pairingUrl` and
`daemonOrigin` through one `authority()` helper that brackets a host containing
`:`, skips an already-bracketed host, and leaves IPv4/hostnames untouched. The
QR payload keeps the bare address (`{host, port, token}` unchanged), so old
pairings and the debug pages (which use `location.host`, already bracketed by
the browser) are unaffected.

**5. Windows Firewall helper.** `daemon/scripts/allow-firewall.ps1` (new, NOT
run — needs elevation). Adds an inbound TCP allow rule for the port scoped to
`100.64.0.0/10,fd7a:115c:a1e0::/48` so the port is not opened on every future
network, prints what it did and the removal command, and is idempotent (deletes
before adding). `install-startup.ps1` now points at it.

## Startup output (real run, this machine — Tailscale not installed yet)

```
LAN candidates (best first): Wi-Fi=192.168.1.16  Mullvad=10.158.168.177
Tailscale: not detected — pairing with the LAN address (same wifi only)
LAN (same wifi only): 192.168.1.16:8799
Workbench daemon on ws://192.168.1.16:8799/ws  (debug page: http://192.168.1.16:8799/, terminal: http://192.168.1.16:8799/terminal)
Scan to pair:
[QR]
```

With Tailscale up it reads:

```
Tailscale (works anywhere): [fd7a:115c:a1e0:…]:8790
  peer connections are direct (relayed = higher latency)
LAN (same wifi only): 192.168.1.16:8790
```

## Tests

`daemon/test/tailscale.test.ts` (6 cases, injected exec): prefers IPv6 and never
asks for `-4` when `-6` answers, falls back to `-4`, falls back to PATH, returns
null when absent, null on malformed output, and survives a failing `status`.
`daemon/test/server.test.ts` gains an IPv6-loopback case (HTTP + authed WS over
`[::1]`), skipped via `it.skipIf` on a host with no `::1`.
`app/test/pairing.test.ts` gains the bracketing cases for both builders.

daemon `npm test` 173 passed (was 166) · `npm run build` clean ·
app `npm test` 116 passed (was 115).

## Not done / open

- Tailscale is not installed on this machine, so only the fallback branch was
  exercised against reality; the detection branches are covered by unit tests
  with an injected exec. Worth one real check after install.
- The firewall rule was not applied (needs elevation) — run
  `scripts\allow-firewall.ps1` from an elevated PowerShell.
- Mullvad's "Local network sharing" must be ON for fc00::/7 to be permitted.
