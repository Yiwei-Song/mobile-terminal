# Tunnel report — the workbench in a phone browser

Goal: reach the workbench from China, where Tailscale is blocked and Android's single VPN
slot is already taken. Transport is a Cloudflare quick tunnel to a phone **browser** — no app
install, no VPN of ours.

## 1. Security (the daemon is now internet-reachable)

`daemon/src/server.ts`:

- **Auth timeout.** `ws.once("message")` had no deadline and the ping watchdog only starts
  *after* auth, so an unauthenticated socket was held forever for free. A 5 s timer now closes
  with **4001**; cleared on the first frame (good or bad) and on close. Injectable as
  `opts.authMs` for the test.
- **maxPayload = 1 MiB.** ws's default is 100 MiB — a free OOM for anyone who reaches the
  port. Inbound frames are the auth handshake and small JSON requests; the big payloads (a
  `git.diff`, a terminal scrollback) are **responses**, which this does not cap. The largest
  legitimate inbound message is a file write, orders of magnitude under 1 MiB.
- **Connection cap = 8**, counted *before* auth (`wss.clients.size`), because holding
  unauthenticated sockets open is the attack. Over the limit closes with **4002**.

Observed: an oversized frame surfaces to the client as **1006**, not ws's 1009 — the payload
cap raises `error`, and this daemon's existing error handler terminates rather than closing
politely. The frame is never buffered and the daemon is unaffected; the test asserts both.

## 2. HTTPS fixes

`daemon/web/terminal.html` hardcoded `ws://` + `location.host`, which an https tunnel blocks
as mixed content — the terminal would have failed silently. Now derives `wss:` from
`location.protocol`, the pattern `daemon/debug/index.html` already used. That was the only
hardcoded scheme in either page (grepped).

## 3. The daemon serves the app

`npm run build:app` (new script in `daemon/package.json`) runs `expo export --platform web` →
**`app/dist`** (confirmed: 13 static routes + `_expo/static/js/web/*.js`).

- `/` → the app's `index.html`. Deep routes resolve as `<route>.html` if the export wrote one
  (`/settings`, `/files`), else fall back to `index.html` so a client-side route boots the app
  instead of 404ing. Extension-less paths only — a missing hashed bundle stays a 404 rather
  than becoming HTML served as `application/javascript`.
- The daemon's own table is consulted **first**, so `/ws`, `/terminal`, `/vendor/*` keep their
  meaning whatever the export contains. The debug page moved to **`/debug`**.
- Resolution is `<daemon>/../app/dist`, which is the same from `src/` (tsx) and `dist/`
  (compiled) — same reasoning as the existing routes. Verified against the compiled build.
- No export → `/` stays the debug page and startup logs the exact command to fix it.
- This one *does* join a path off `req.url`, so the resolved path is checked to be inside
  `app/dist` before any read (raw and percent-encoded traversal both tested).

Known wrinkle: `/terminal` is the daemon's xterm page, so a hard reload on the app's own
`/terminal` route lands there. That is what the app's web build wants — it iframes
`${origin}/terminal` — and in-app navigation is client-side, so it never hits the server.

## 4. Same-origin pairing

`app/src/lib/pairing.ts` built `ws://${host}:${port}/ws` and always appended a port; a tunnel
is `wss://xyz.trycloudflare.com/ws` — wrong scheme and a bogus `:443`.

`Pairing` gains an optional **`origin`** (an origin and nothing else, regex-validated on the
way out of storage/QR — it decides where the token is posted and what the WebView may load).
When present it wins in `pairingUrl` and `daemonOrigin`; `host`/`port` stay for display.
`sameOriginPairing(token)` derives it from `location`, gated on `Platform.OS === "web"` so
native can never take this path. The pair screen defaults to a **token-only** flow showing the
origin it came from, with a "Use a different host" escape (this build also runs from a Metro
dev server, whose origin is not a daemon). Explicit host/port, IPv6 bracketing and the
WebView origin pin are unchanged and still tested.

## 5. Bind

`cfg.bindHost` already worked; now tested (bind `127.0.0.1`, `[::1]` refuses) and documented.
Default stays `"::"`. For tunnel use README-phone.md recommends `"bindHost": "::1"` **and**
`--url http://[::1]:8790`, since `localhost` may resolve to the address the daemon dropped.

## Verification

- `daemon`: `npm test` 179 passed (was 173), `npm run build` clean. `app`: `npm test` 122
  passed (was 116), tsc clean.
- Live, against the compiled `daemon/dist/server.js` and the real export, on a scratch port
  (started and stopped inside the check; `cloudflared` never run):

  | path | result |
  |---|---|
  | `/` | 200 app `index.html`, 21 951 B |
  | `/files` | 200 `files.html` (route sibling) |
  | `/session/abc` | 200 `index.html` (SPA fallback) |
  | `/settings` | 200 `settings.html` |
  | `/debug` | 200 debug page |
  | `/terminal` | 200 xterm page |
  | `/vendor/xterm.js` | 200 `application/javascript`, 488 KB |
  | `/_expo/static/js/web/entry-*.js` | 200 `application/javascript`, 3.3 MB |
  | `/_expo/static/js/web/nope.js` | 404 |

- Not verified: an actual tunnel end to end (the user runs `cloudflared`), and the app's UI
  inside a real phone browser.

## Go live

```
cd daemon
npm run build:app                                # once, and after any app change
npm run dev                                      # terminal 1 — prints the token
cloudflared tunnel --url http://localhost:8790   # terminal 2 — prints the https URL
```

Open the `https://<random>.trycloudflare.com` URL on the phone, paste the token, Connect. The
URL changes every `cloudflared` restart (free quick tunnel), and the token lives in
per-origin browser storage, so a new URL means pasting the token again.
