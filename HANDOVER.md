# Mobile Workbench — Handover

*Written 2026-08-02 for a fresh session taking over. Read this file first, then `docs/superpowers/specs/2026-08-02-journey-redesign.md`.*

---

## 0. STATUS UPDATE — milestones 1 and 2 are done (2026-08-02, later that day)

Sections 1-8 below describe the state *before* the redesign work. What changed since:

**Milestone 1 — real APK (commit `00bec27`).** Built locally, not via EAS (EAS needs an interactive login). Android cmdline-tools + JDK 21 are now permanent on OMEN16; `npm run build:apk` in `app/` rebuilds in ~2 min warm, arm64 only. Fixed a blocker first: native pairing could never reach the Cloudflare tunnel because the pair screen only accepted host+port (always plain `ws://`); `originPairing()` now accepts a pasted `https://` URL.

**Milestone 2 — sessions redesign (`5f84d7c`..`c3513b2`).** Executed as 6 tasks with an independent review each. Benchmark theme (`weaintplastic.com` palette) swapped in verbatim; two tabs **Sessions | Machine** with the terminal and tools demoted off the home screen; session list grouped NEEDS YOU / WORKING / RECENT with unread dots, search and 40ms stagger; conversation screen rebuilt (full-width agent prose with CLAUDE attribution, tinted user blocks, collapsed tool chips, pinned RUN COMMAND approval card with DENY/ALLOW pills, native composer); session switcher sheet on the conversation title with velocity-carrying drag dismiss. Plan: `docs/superpowers/plans/2026-08-02-milestone-2-sessions-redesign.md`.

**The emulator verification rig — the important process change.** Section 6 says "put builds in the owner's hands early and often"; that is still true but was being used as a substitute for the agent verifying its own work. There is now a headless Android emulator on OMEN16 (`AVD "workbench"`, Pixel 7, android-35, WHPX):

```powershell
$adb = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"
& "$env:LOCALAPPDATA\Android\Sdk\emulator\emulator.exe" -avd workbench -no-window -no-audio -no-boot-anim -gpu swiftshader_indirect
cd app\android; .\gradlew.bat assembleRelease -PreactNativeArchitectures=x86_64   # x86_64 for the emulator
& $adb install -r app\android\app\build\outputs\apk\release\app-release.apk
& $adb reverse tcp:8790 tcp:8790          # then pair the app to 127.0.0.1 with the token from %APPDATA%\workbench\config.json
& $adb shell input tap X Y ; & $adb shell screencap -p /sdcard/s.png ; & $adb pull /sdcard/s.png
```
Build with `EXPO_PUBLIC_DEMO=1` to stage the full demo story (all four session states, a pending approval, a real transcript) for design review.

**It found two ship-blockers that no web render could have**, both now fixed: `Button` with `fill` collapsed to zero height in auto-sized columns (the pair screen's two buttons drew on top of each other — native-only branch), and the release manifest never set `usesCleartextTraffic`, so Android silently blocked *every* plain `ws://` connection — LAN and QR pairing would have failed on the owner's phone at home while only the tunnel worked.

**Next:** milestone 3 (Codex as the second agent + transcript history RPC + prepend-cwd fix), then push notifications, then Machine tab consolidation. Carried minors and deferred items are in `.superpowers/sdd/progress.md`.

---

## 1. What this is

A phone app that lets the owner run and steer AI coding-agent sessions (Claude Code, later Codex) on their own Windows PC from anywhere — approve what an agent wants to do, read what it changed, start new work, and keep the machine healthy.

**Owner:** Yiwei. Windows 11 Pro laptop `OMEN16`, Android phone. Currently travelling in China.

**Repo:** `D:\Mobile-access` — single repo, three parts:
- `daemon/` — Node/TS WebSocket daemon that runs on the PC and owns everything
- `app/` — Expo / React Native app (Android target; a web export exists for testing)
- `shared/protocol.ts` — the type contract both halves import

---

## 2. Current state — read this honestly

**Four of six planned phases are built and reviewed. The engineering is solid; the product is not yet good.**

The owner tested it for the first time on 2026-08-01 and the verdict was blunt and correct:

> "the UI and UX I see on this prototype is nowhere near as a native mobile application. Usability of the ideal functions and the UI UX are poorly designed to be properly used."

**Four specific failures — these define the work ahead:**

1. **It's a browser tab, not an app.** An Expo web export served through a tunnel. An APK was never built.
2. **Terminal was given top billing.** Four tool buttons sit above the session list; the terminal was the demo. The owner said at kickoff *"I mostly need it for AI work"* — the terminal is an escape hatch.
3. **The session experience is thin.** Flat list, plain transcript. The owner asked for the Claude-desktop sidebar feel: browse sessions, pick one, see progress, continue the conversation. No search, no grouping, no unread state, no fast switching.
4. **Only one agent.** Codex was deferred and never landed, so the cross-agent premise — the main reason this beats first-party apps — is unmet.

**Root cause worth carrying forward:** progress was measured in tests passed and review grades. 289 tests pass; a design review said B+. Neither measured *"would this feel good to use"*, and it wasn't put in the owner's hands until four phases were done.

---

## 3. What actually works (don't rebuild this)

The daemon is genuinely solid and battle-tested. **179 daemon tests + 122 app tests, all green and deterministic.**

| Capability | Where | Notes |
|---|---|---|
| Claude sessions: create / resume / stream / approve | `daemon/src/sessions/{claude,registry,manifest}.ts` | Official Agent SDK, not TUI-scraping |
| Auth + transport | `daemon/src/server.ts` | Token (256-bit, `timingSafeEqual`), auth-first, 5s auth deadline, 1 MiB frame cap, 8-socket cap, 30s ping/pong |
| Approval recovery | registry `pending` map + `sessions.pending` RPC | Survives reconnect/app restart — a permission raised while offline is still answerable |
| Terminal | `daemon/src/term.ts` + `daemon/web/terminal.html` | Real ConPTY via `@lydell/node-pty`; PTY geometry proven correct |
| Files / diffs | `daemon/src/files.ts` | realpath traversal guard (adversarially probed); git scoped with `-- .` + absolute pathspec |
| System + power | `daemon/src/{system,power,boot}.ts` | Metrics, kill, keep-awake, lock, reboot + boot-resume |
| Dev tools | `daemon/src/tools.ts` | `tools.json` launcher, sync tree-kill on exit |
| App transport | `app/src/lib/{client,store,pairing}.ts` | Reconnect w/ backoff, 4001→unauthorized halt, buffered-event replay, same-origin pairing |

**Hard-won lessons encoded in the code — do not regress these:**
- `0.0.0.0` is IPv4-only on Windows; the daemon binds `::`
- IPv6 hosts must be bracketed in URLs
- `process.on("exit")` does NOT fire on Ctrl+C on Windows → explicit SIGINT/SIGTERM/SIGBREAK handlers
- `killTree` must be **synchronous** in an exit path or tool children survive
- A page served by a daemon must pair with *that* daemon, overriding stored host/port

---

## 4. Connectivity — solved, and non-obvious

The owner is in China with a permanently-on VPN on **both** PC (Mullvad, cannot be disabled — agents need its egress location) and phone (needed for Google).

**Tailscale is dead here.** Two independent reasons: blocked by the GFW, *and* Android allows only one VPN at a time — the phone's slot is taken. Do not revisit.

**What works: Cloudflare Tunnel.** The daemon dials out (through Mullvad, which doesn't care); the phone reaches an `https://` URL through its own VPN. No VPN client on the phone.

```powershell
cd daemon; npm run build:app     # bundles the app web export the daemon serves
npm run dev                      # prints host/port/token + QR
cloudflared tunnel --url http://localhost:8790
```
`cloudflared` 2026.7.3 is installed (winget). Quick-tunnel URLs rotate on every restart — a named tunnel needs a domain and is the eventual fix.

**Security note:** the tunnel makes the daemon internet-reachable behind only the token. The P0 hardening is done (auth deadline, payload cap, connection cap). Set `"bindHost": "::1"` in `%APPDATA%\workbench\config.json` to make the tunnel the only path in.

---

## 5. The plan — redesign, then rebuild

The owner chose: **"Redesign from the journey, then rebuild"**, reviewing at milestones, using the `emil-design-eng` and `apple-design` skills for UI/UX.

**Design spec:** `docs/superpowers/specs/2026-08-02-journey-redesign.md` — read it in full. Summary:

- **Two tabs: Sessions | Machine.** Sessions is the product; Machine is the utility belt (health, power, tools, preview, global terminal). No tool buttons on the home screen.
- **Sessions grouped** Needs you / Working / Recent, with **unread dots** (answers "what happened while I was away"), search, and both agents visually distinct in one list.
- **Conversation is the heart:** real scrollback, load-older, agent replies full-width and readable, user messages tinted; the pending approval is a **pinned surface outside the scroll** so it can never scroll away; per-session tools (Changes / Files here / Terminal here) live in a `⋯` overflow.
- **Session switcher sheet** — tap the title to switch conversations without going back to root. This is the mobile translation of the desktop sidebar.
- **Terminal is demoted** to the session overflow and the Machine tab. Fix input/scroll in the native shell, then stop. It is not the product.

**Visual direction:** palette benchmarked against **weaintplastic.com** (the owner's reference). Analysis + tokens: `.superpowers/sdd/benchmark-palette.md`; final token file: `.superpowers/sdd/theme-proposed.ts`.
Core: bg `#1D1D1F`, surface `#28282C`, text `#ECECEF`, muted `#9B9BA3`, single accent celeste `#87C6BD`; status warn `#D5B47B` / danger `#E08C85` / info `#90B0D5`.
Controller overrides already applied to the token file: **4pt spacing grid** (not 5), **radius 4/2/pill** (not 0), **stagger 40ms** (not 100), **-0.3px tracking on 26px titles**. Two font weights only; tracking set by case, not size.

**Mockups:** `.superpowers/sdd/redesign2-{sessions,conversation,switcher}.png` (v2, new palette). v1 is `redesign-*.png`.

### Build order (each is a milestone the owner reviews)

1. **Real installable APK.** EAS Build (`eas build -p android --profile preview`, free Expo account) → a file the owner installs. Existing screens inside a native shell. This alone fixes scrolling, keyboard, and app-switching.
2. **Sessions redesign.** Grouping, unread state, search, switcher sheet, conversation depth. Apply `theme-proposed.ts`.
3. **Codex as second agent.** Via `codex app-server` JSON-RPC (threads/turns/steer/interrupt/approvals) — maps onto the existing session model. Also here: transcript history RPC (a restart currently shows an empty transcript) and the prepend-cwd fix (the agent has twice written files to `$HOME` instead of the session cwd).
4. **Push notifications.** The payoff of going native: *agent needs permission* → notification → tap → approval card.
5. **Machine tab.** Fold health/power/tools/preview/terminal into one tab, off the home screen.

---

## 6. Process expectations

- Work is executed by subagents, task-by-task, with an independent code review per task and fixes applied before moving on. The pattern lives in `superpowers:subagent-driven-development`. It has repeatedly caught real bugs — keep it.
- **But** it did not catch the product-level failure. So: **put builds in the owner's hands early and often.** A rendered screenshot is not a substitute for the owner using it.
- Owner communication: ADHD-friendly. Lead with the action, number the steps, bold the anchors, cap lists at five, no preamble, no recap, state one concrete next action. They invoke `/i-have-adhd` to enforce this.
- The owner values honesty about what's broken over polish in the report. When a review disproves an earlier claim, say so plainly.
- Do not start long-running servers without cleaning them up; several orphaned Expo/daemon processes had to be killed manually.

---

## 7. Ledger and history

`.superpowers/sdd/progress.md` is the running ledger — every task, every review finding, every deferred item, with commit SHAs. It also holds two carry-lists:

- **Plan 3 (agents):** transcript history RPC, prepend-cwd mitigation, per-file `git.diff`
- **Plan 6 (hardening):** term.* event fan-out (every PTY byte currently broadcasts to *all* authed sockets — a real battery/data cost), WS backpressure, response caps on `git.diff`/`files.list`, `frame-ancestors` header, ToolRunner restart reconciliation, abandoned-pty reaper, terminal.html has zero automated coverage

Plans live in `docs/superpowers/plans/`. Specs in `docs/superpowers/specs/`.

---

## 8. First moves for the new session

1. Read `docs/superpowers/specs/2026-08-02-journey-redesign.md` and look at the v2 mockups.
2. Confirm both suites still pass: `cd daemon && npm test` (179), `cd app && npm test` (122).
3. Start milestone 1 — the APK. It is the owner's loudest complaint and the cheapest large win.
4. Get it onto their phone before building anything else on top of it.
