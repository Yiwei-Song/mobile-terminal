# STATE — how things actually are

*Machine-facing. Read first, every session. Updated **in place** whenever reality changes —
this file has no history, git owns that. Terse by design: a state doc written in paragraphs
stops being read, then stops being true.*

*Last verified: 2026-08-02 (both suites run green, see Health).*

---

## What this is

A phone app that lets the owner run and steer AI coding-agent sessions (Claude Code, later
Codex) on their own Windows PC from anywhere — approve what an agent wants to do, read what
it changed, start new work, keep the machine healthy.

**Owner:** Yiwei. Windows 11 Pro laptop `OMEN16`, Android phone. Currently travelling in China.

## Architecture

| Part | Path | Notes |
|---|---|---|
| Daemon | `daemon/` | Node/TS, ESM, WebSocket on **port 8790**. Owns sessions, PTY, files, system, power, tools |
| App | `app/` | Expo SDK 57 / RN 0.86, expo-router, zustand. Android APK is the real target; a web export is served by the daemon for the tunnel path |
| Contract | `shared/protocol.ts` | Type-only re-export of daemon types, imported by both. **Must stay import-free** |

- **Agent integration is the official Claude Agent SDK**, not TUI-scraping.
- Daemon serves `/` (app web export), `/debug` (raw protocol page), `/terminal` (the xterm
  page the app embeds in a WebView).

## Health (verified 2026-08-02)

| Check | Result |
|---|---|
| `cd daemon && npm test` | **179 passed** (18 files), typechecks tests + scripts |
| `cd app && npm test` | **146 passed** (11 files), typechecks first |
| Deterministic | Yes — the last known flake was root-caused to a real bug (buffered events dropped by `refreshSessions`) and fixed |
| CI | **None.** The two commands above are the only gate |

## Prerequisites on a fresh machine

| Need | Why / detail |
|---|---|
| **Node 24** (dev machine runs v24.15.0) | Not pinned in `package.json`. `README-phone.md` says v20+; TS 7 + `@types/node` 26 are what's actually installed |
| `cd daemon && npm install` **before** `cd app && npm install` | The app imports from `daemon/` — a clean checkout needs both, in that order |
| **JDK 21 + Android cmdline-tools** | Only for building the APK. `ANDROID_HOME` set as a user env var on OMEN16; `~/.gradle/gradle.properties` holds `jvmargs 4096m` (**not** `android/gradle.properties` — prebuild regenerates that) |
| **cloudflared** 2026.7.3 | Only for the tunnel path (winget) |
| `%APPDATA%\workbench\config.json` | Auto-created on first `npm run dev` with a fresh 256-bit token + port 8790 |

`config.json` shape — `token`, `port`, `ntfyTopic` are written by the daemon;
`fileRoots` and `bindHost` are hand-edited:

```json
{ "token": "…", "port": 8790, "ntfyTopic": null,
  "fileRoots": ["D:\\projects"], "bindHost": "::1" }
```

`%APPDATA%\workbench\tools.json` (optional) defines the dev-tool launcher; **read once at
daemon startup**, restart after editing.

## Connectivity

**Cloudflare Tunnel is the answer.** The daemon dials out (through Mullvad, which doesn't
care); the phone reaches an `https://` URL through its own VPN. No VPN client on the phone.

```powershell
cd daemon; npm run build:app      # bundles the app web export the daemon serves
npm run dev                       # prints host / port / token + QR
cloudflared tunnel --url http://localhost:8790
```

- Quick-tunnel URLs **rotate on every `cloudflared` restart** — a named tunnel needs a
  domain and is the eventual fix.
- `npm run build:app` **wipes `app/dist`** — re-copy `workbench.apk` into it afterwards if
  you are serving the APK for download.
- Tunnelling makes the daemon internet-reachable behind only the token. P0 hardening is
  done (5s auth deadline, 1 MiB frame cap, 8-socket cap, 30s ping/pong,
  `timingSafeEqual`). Set `"bindHost": "::1"` to make the tunnel the only way in — then
  point the tunnel at `http://[::1]:8790`, because `localhost` may resolve to the IPv4
  address the daemon no longer answers on.

## The emulator rig

Mandatory for app changes (see [`AGENTS.md`](../AGENTS.md) §3). Headless AVD `workbench`,
Pixel 7, android-35, WHPX, on OMEN16:

```powershell
$adb = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"
& "$env:LOCALAPPDATA\Android\Sdk\emulator\emulator.exe" -avd workbench -no-window -no-audio -no-boot-anim -gpu swiftshader_indirect
cd app\android; .\gradlew.bat assembleRelease -PreactNativeArchitectures=x86_64   # x86_64 for the emulator
& $adb install -r app\android\app\build\outputs\apk\release\app-release.apk
& $adb reverse tcp:8790 tcp:8790          # then pair the app to 127.0.0.1 with the token from config.json
& $adb shell input tap X Y ; & $adb shell screencap -p /sdcard/s.png ; & $adb pull /sdcard/s.png
```

Build with `EXPO_PUBLIC_DEMO=1` to stage the full demo story (four session states, a pending
approval, a real transcript) for design review.

Phone build: `cd app && npm run build:apk` — arm64-v8a only, ~2 min warm, 53.7 MB.
`app/android/` is **generated** (CNG) and gitignored; every native change must go through
`app.json` / a config plugin or it evaporates on the next prebuild.

## Key decisions & gotchas — do not relitigate

- **Decided (Yiwei, 2026-08-01): Tailscale is dead here** — blocked by the GFW *and* Android
  allows only one VPN at a time, and the phone's slot is taken by the VPN it needs for
  Google. Evidence: `.superpowers/sdd/tailscale-report.md`. `daemon/src/tailscale.ts` stays
  (detection degrades to `null` when absent, costs nothing, works if the owner leaves China).
  *Revisit only on a change of country.*
- **Decided (Yiwei, 2026-08-02): APK built locally with gradle, not EAS** — EAS needs an
  interactive login. `eas.json` is kept for a future cloud build; the local path is the real one.
- **Decided (Yiwei, 2026-08-02): the emulator rig is not optional** — "put builds in the
  owner's hands" was being used as a substitute for the agent verifying its own work.
- **Decided (Yiwei, 2026-08-02): palette benchmarked against `weaintplastic.com`**, with four
  owner overrides (4pt grid, radius 4/2/pill, 40ms stagger, −0.3px tracking on 26px titles),
  two font weights only. Rationale: `.superpowers/sdd/benchmark-palette.md`. Landed verbatim
  in `app/src/theme.ts`. **The mockups govern** when a review and a mockup disagree.
- **Decided (Yiwei, 2026-08-02): `ChevronLeft` is the global back glyph**; NEEDS YOU chip is
  filled warn, not outlined.
- **Decided (Yiwei, 2026-08-05): the phone reads the agents' own session stores, not a
  daemon-private list.** `~/.claude/projects`, `~/.claude/sessions/<pid>.json` (liveness +
  the desktop's own display name), and `~/.codex/state_5.sqlite` `threads` (what the Codex
  UI lists from) via Node 24's built-in `node:sqlite`. Rationale: the phone and the desktop
  cannot disagree if they read the same source. *Revisit only if a store's schema moves —
  the Codex reader already degrades to scanning rollout headers.*
- **Both agents FORK on resume** (verified against months of real transcripts): a resumed
  session is a NEW file under a NEW id with the parent's history copied in. Two writers
  therefore never share a file, so no lock or ownership handshake is needed — but forks
  must be stitched back into one thread or one conversation reads as four rows.
  `Thread.threadId` is the oldest ancestor; `Thread.resumeId` is the newest leaf and the
  only id it is meaningful to continue from.
- **Killed (2026-08-05): reverse-engineering `\\.\pipe\codex-ipc`.** It existed only to
  avoid a transcript-corruption risk that the fork behaviour makes impossible. An
  undocumented pipe a Codex update can silently change is not worth carrying for zero
  benefit. *Revisit only if either vendor documents a real attach API.*

**Technical gotchas encoded in the code — do not regress:**

- `0.0.0.0` is IPv4-only on Windows → the daemon binds `::`.
- IPv6 hosts must be bracketed in URLs.
- `process.on("exit")` does **not** fire on Ctrl+C on Windows → explicit
  SIGINT/SIGTERM/SIGBREAK handlers.
- `killTree` must be **synchronous** in an exit path or tool children outlive the daemon.
- A page served by a daemon must pair with *that* daemon, overriding stored host/port.
- Negative `marginVertical` makes a 48pt Pressable overhang its parent — **Android drops
  touches outside the parent frame**. Swept once; don't reintroduce.
- xterm cell size must be measured **after** `fonts.ready` or geometry clamps to 2 columns.
- React Navigation's numeric `tabBarStyle.height` is *total* height and still pads the
  bottom inset inside it — clips on 3-button nav. Leave the default.
- The Claude SDK may write to `$HOME` instead of the session cwd for a bare filename
  (reproduced twice). The approval card surfaces the mismatch; the prepend-cwd mitigation
  is still open.
- A Claude transcript records a **cwd per message**, so a session that ran `cd` writes a
  subfolder late in the file. Read the FIRST cwd, not the last, or one project splits in two.
- Codex stores Win32 extended-length paths (`\\?\D:\proj`). Normalize or they group as a
  second project.
- **Codex imports Claude sessions into its own thread table** (`external_agent_session_imports.json`
  records which). Without dropping them the phone lists one conversation twice, once per agent.
- Two forks written inside the same millisecond share an mtime; `resumeId` then falls to
  directory order, which can pick a stale fork. Size breaks the tie.

## What works (don't rebuild)

| Capability | Where |
|---|---|
| Claude sessions: create / resume / stream / approve | `daemon/src/sessions/{claude,registry,manifest}.ts` |
| Auth + transport hardening | `daemon/src/server.ts` |
| Approval recovery across reconnect/restart | registry `pending` map + `sessions.pending` RPC |
| Terminal (real ConPTY, geometry proven correct) | `daemon/src/term.ts` + `daemon/web/terminal.html` |
| Files / diffs (realpath traversal guard, git scoped) | `daemon/src/files.ts` |
| System metrics, kill, keep-awake, lock, reboot + boot-resume | `daemon/src/{system,power,boot}.ts` |
| Dev-tool launcher (sync tree-kill on exit) | `daemon/src/tools.ts` |
| App transport (reconnect/backoff, 4001 halt, buffered replay) | `app/src/lib/{client,store,pairing}.ts` |
| Sessions redesign: tabs, grouping, unread, search, switcher sheet | `app/app/(tabs)/`, `app/src/lib/groups.ts` |
| Session discovery: every Claude + Codex session on the PC, grouped by project, forks stitched | `daemon/src/sessions/discover.ts`, `app/app/(tabs)/projects.tsx` |
| Transcript history from the agents' own files (survives daemon restart) | `daemon/src/sessions/transcript.ts` |

## Docs map

| File | Job |
|---|---|
| [`AGENTS.md`](../AGENTS.md) | Standing rules. `CLAUDE.md` points here |
| `docs/STATE.md` | This file — current reality |
| [`docs/roadmap.md`](roadmap.md) | Forward plan, open decisions, carried debt |
| [`HANDOVER.md`](../HANDOVER.md) | Onboarding entry point for a new agent/session |
| [`README-phone.md`](../README-phone.md) | Owner-facing: install, pair, use every feature |
| `docs/superpowers/plans/` | One plan per milestone, numbered tasks |
| `docs/superpowers/specs/` | Design specs — `2026-08-02-journey-redesign.md` governs the redesign |
| `.superpowers/sdd/progress.md` | The ledger: every task, review finding, deferred item, with SHAs |
| `.superpowers/sdd/redesign2-*.png/html` | The mockups the redesign builds against |
| `research/` | One-off research write-ups |

Most of `.superpowers/sdd/` is deliberately gitignored (per-task briefs/reports/reviews,
`review-*.diff`, ~150 verification screenshots). Its `.gitignore` allows back only the
artifacts listed above.
