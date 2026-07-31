# Mobile Workbench — Design Spec
*2026-07-31 · Personal tool, product-shaped · Android + Windows 11 · Benchmark research: [`research/2026-07-31-mobile-workbench-benchmark.md`](../../../research/2026-07-31-mobile-workbench-benchmark.md)*

## 1. What this is

A two-part system that gives the owner full remote control of their Windows 11 machine from an Android phone, purpose-built for AI-agent work — presented as a simple session workbench, not a remote desktop or raw terminal.

- **Workbench daemon** — Windows tray app (Node/TypeScript) that owns agent sessions, terminals, files, system monitoring, and power control.
- **Workbench app** — Android app (React Native) that is a thin, intuitive UI over the daemon.
- **Transport** — Tailscale personal tailnet (WireGuard-encrypted, free tier), plus daemon-level pairing-token auth.

### Goals
1. From anywhere: see, steer, approve, and start Claude Code and Codex sessions running on the home machine.
2. Inspect results on the phone: diffs, files, markdown, and live dev-server previews.
3. Keep the machine healthy remotely: performance monitoring, kill process, reboot, auto-resume.
4. Everything wrapped simply: session list first, escape hatches (terminal) second.

### Non-goals (v1)
- No cloud-session orchestration (claude.ai / Codex cloud have no third-party API; "cloud" in the original idea was a typo for "Claude").
- No GUI window streaming/peek (AI-work needs are covered by diffs + preview; stretch goal later).
- No iOS, no voice, no E2EE relay, no wake-from-full-shutdown (Tailscale covers transport encryption for personal use; architecture keeps these doors open).
- No multi-user, no store distribution (APK sideload).

## 2. Architecture

```
Android app (React Native)
   │  WebSocket + HTTPS, pairing-token auth
   ▼
Tailscale tailnet (WireGuard; stable device IP; free tier)
   │
   ▼
Workbench daemon (Windows tray app, Node/TS, auto-starts at logon)
   ├─ Claude sessions  → @anthropic-ai/claude-agent-sdk (list/new/resume/fork/stream)
   ├─ Codex sessions   → spawn `codex app-server`, JSON-RPC over stdio
   ├─ Terminals        → node-pty (ConPTY) ↔ WebSocket
   ├─ Files/diffs      → read API + git diff endpoints
   ├─ Preview          → enumerate listening localhost ports
   ├─ System monitor   → CPU/RAM/disk/process stats (WMI), kill process
   ├─ Power            → keep-awake, lock ("privacy mode"), reboot
   └─ Notifications    → ntfy push (approval needed / task done / machine state)
```

**Why these foundations (from the benchmark research):**
- Official SDK surfaces (Claude Agent SDK, Codex app-server) — CLI/TUI-wrapping is what made Happy unreliable and killed Omnara v1. Both agents persist sessions as JSONL on disk and support headless resume-by-ID; the daemon builds on that instead of owning persistence.
- Tailscale — solves NAT, roaming, and encryption for $0; no relay server to run; VPN-slot conflict acceptable for a personal tool (embedding libtailscale is the product-phase upgrade).
- tmux/mosh deliberately absent — neither runs natively on Windows.

## 3. Components

### 3.1 Workbench daemon (Windows)

**Runtime:** Node/TypeScript. Tray icon with status + quick actions (pause remote access, copy pairing QR, quit). Auto-starts at user logon via Task Scheduler.

**Session manager**
- Claude: Agent SDK — `listSessions()`, create in any folder, `resume`/`forkSession`, stream messages, surface permission requests.
- Codex: one `codex app-server` child process — `thread/start`, `thread/resume`, `thread/list`, `turn/start`, `turn/steer`, `turn/interrupt`, approval requests via server-push events.
- Manifest file (`%APPDATA%/workbench/sessions.json`): the set of sessions the daemon considers "active" (agent type, session/thread ID, cwd, title, status). Updated on every lifecycle change. This is what reboot-resume reads.
- Status model per session: `running` / `waiting_on_user` (approval or question) / `idle` / `dead`.

**Terminal manager** — named ConPTY sessions (node-pty); raw bytes over WebSocket; scrollback buffer (last N KB) replayed on reconnect; sessions survive app disconnects (die with daemon — acceptable, agents are the persistence story).

**Dev-tool launcher**
- One-tap start/stop of common dev services from the phone: Docker Desktop / docker compose per workspace, headless browser (Playwright/Chromium), and user-defined tools via a simple `tools.json` (name, command, health-check port). Status shown on the System screen.

**Files/diffs/preview**
- Read-only file API rooted at user-chosen workspace folders (not whole disk by default; configurable).
- `git diff` / `git status` endpoints per workspace (uses installed git).
- Port scanner: enumerate listening TCP ports on localhost with owning process name, so the app can offer "Preview: localhost:5173 (node)".

**System monitor** — CPU, RAM, disk, top processes (name, PID, CPU%, RAM) via WMI/`systeminformation`, polled on demand + cheap summary pushed with heartbeat. Kill-process endpoint (with process name echoed back for confirmation).

**Power control**
- Keep-awake: `SetThreadExecutionState(ES_SYSTEM_REQUIRED | ES_CONTINUOUS)` held **whenever the daemon is running** (default), display allowed to sleep. Rationale: if keep-awake released on idle, the machine would sleep right after a reboot-resume (all sessions idle) and become unreachable. Optional eco mode (awake only while sessions running) for laptop-on-battery scenarios.
- Privacy mode: `LockWorkStation()` + display sleep; system stays awake; everything keeps running (Windows processes continue under lock, unlike sleep).
- Reboot: `shutdown /r /t 10` after app-side confirmation. Machine is configured for **auto-logon + immediate lock** (netplwiz auto-login; daemon locks workstation as its first act at startup). Owner accepts the physical-security tradeoff; BitLocker recommended as mitigation. Setup of auto-logon is a documented manual step, not daemon-automated.

**Boot-resume flow**
1. Task Scheduler starts daemon at logon (auto-logon makes this unattended).
2. Daemon locks workstation (privacy default).
3. Reads manifest → re-attaches each session (`resume` by ID) in `idle` state — **does not auto-continue work**; each session shows "resumed after reboot" in the app and waits for a tap.
4. Push notification: "Machine back online — N sessions restored."

**Notifications** — ntfy (self-hostable later; random-topic on ntfy.sh for v1) → ntfy Android app. Events: approval needed, agent question, task finished, session died, reboot complete, daemon offline>threshold (dead-man via phone-side check).

**Auth** — first-run pairing: daemon shows QR (tailnet address + long random token); app stores token; every request bears it. All transport already inside WireGuard. Token revocable from tray.

### 3.2 Android app (React Native)

**Mobile-first mandate:** every screen is designed for one-hand phone use — thumb-reachable primary actions, ≥44 pt touch targets, portrait-first layouts, dictation-friendly inputs. The in-app Preview browser defaults to a mobile viewport, and all UI verification during development is done at phone dimensions (not desktop-window-shrunk).

**Home = session list** (the Claude-desktop-style view): all Claude + Codex sessions + terminals in one pane; status chips (🟢 running / 🟡 waiting on you / ⚪ idle / 🔴 dead); machine health strip on top (CPU/RAM sparkline, awake/locked state, tap → System screen). Pull to refresh; sessions sorted by needs-attention first.

**Session screen** — streaming transcript (assistant text, tool calls collapsed by default); approval cards showing full context: command, cwd, and diff when the tool is an edit — approve/deny buttons; composer with dictation-friendly input; actions: interrupt, fork (Claude), continue-after-reboot.

**New session** — pick workspace folder (recent list from daemon) → pick agent (Claude/Codex) → prompt → go.

**Review tools**
- Diff viewer: phone-formatted unified diff, per-file collapse.
- File browser + markdown renderer (native render), image view.
- Preview tab: in-app browser (WebView) to `http://<tailnet-ip>:<port>` for discovered dev servers.

**Terminal screen** — xterm.js in WebView + key accessory row (Esc, Ctrl, Tab, arrows, /). Escape hatch, not the main event.

**System screen** — performance graphs (CPU/RAM/disk), process list sorted by usage, kill process (confirm dialog), buttons: Privacy mode · Keep awake toggle · **Reboot** (type-to-confirm "REBOOT" + shows count of running sessions that will be interrupted).

**Offline honesty** — when daemon unreachable: "💤 Laptop offline/asleep" state with last-seen time; no infinite spinners; ntfy still delivers queued notifications.

## 4. Security model

- Transport: WireGuard (Tailscale) — only devices on the personal tailnet can reach the daemon at all.
- App-level: pairing token on every request; revocable.
- Approval gates: agent permission prompts always surface with full context; no "bypass permissions" toggle exposed in the app.
- Destructive actions (reboot, kill process): explicit typed/confirmed on-phone.
- Reboot/auto-logon tradeoff: accepted by owner; BitLocker + locked-by-default screen mitigate.
- Prompt-injection reality (demonstrated RCE paths in agent CLIs): the approval UX showing real command + cwd + diff is the mitigation; no auto-approve in v1.
- Product-phase doors kept open: TLS + cert pinning, E2EE relay, biometric step-up — none block v1's architecture.

## 5. Error handling

| Failure | Behavior |
|---|---|
| Phone loses network / roams | WS reconnect with backoff; terminal scrollback replay; session transcripts re-fetched from daemon |
| Laptop sleeps unexpectedly | Phone shows offline state + last-seen; keep-awake minimizes occurrence |
| Daemon crashes | Task Scheduler restart-on-failure; sessions re-attach from manifest (same as boot-resume) |
| Agent CLI/SDK updated & breaks | Version pin + daemon health check surfaces "Claude SDK error" per session rather than dying globally |
| Codex app-server dies | Supervised child; restart + `thread/resume` from manifest |
| Reboot requested with running sessions | Warning lists them; sessions resume `idle` after boot |

## 6. Testing

- Daemon: one small test suite covering the session manifest lifecycle (create → update → reboot-resume readback) and the auth middleware — the two things that quietly corrupt.
- Agent integrations: runnable smoke script (`npm run smoke`) that starts + resumes one Claude and one Codex session headlessly.
- Everything else: manual dogfood — this is a personal tool; the owner is the QA.

## 7. Build order (preview for the plan)

1. Daemon skeleton: WS server + pairing + tray + Tailscale assumption
2. Claude sessions end-to-end (list/new/stream/approve from a debug web page)
3. Android app: home list + session screen + approvals + notifications
4. Codex via app-server
5. Terminal + files/diffs/preview
6. System monitor + power control (keep-awake, privacy mode, reboot + boot-resume)
7. Polish: offline states, reconnect, confirmations

## 8. Deferred (v2+)

GUI window peek (Windows.Graphics.Capture stills) · embedded libtailscale (drop VPN-slot dependency) · E2EE store-and-forward relay + offline prompt queue · iOS · voice · biometric step-up · auto-continue-after-reboot · wake-on-LAN via second device.
