# Mobile Remote Workbench — Benchmark Research & Critical Analysis
*Compiled 2026-07-31. Sources: 7 parallel research reports (competitive landscape, first-party apps, user demand, connectivity, session persistence, remote GUI, cloud APIs/security).*

## 1. The idea, restated

A mobile app that is a **wrapper around agent-session plumbing**, not a remote desktop and not a raw terminal:

- Connects phone ↔ your own computer (Windows 11)
- Can run CLI commands and launch desktop applications on the laptop
- Starts/attaches/manages coding-agent sessions (Claude Code, Codex) both **local** and **cloud**
- Presents everything in a simple session-tracking UI (like the Claude desktop app's session list)

## 2. Competitive landscape

### 2.1 First-party (the market-reshaping facts)

| Capability | Anthropic (Claude) | OpenAI (Codex) | GitHub (Copilot) |
|---|---|---|---|
| Mobile surface | Code tab in Claude app (iOS/Android) | Codex inside ChatGPT app (preview, all plans) | GitHub Mobile native app |
| Cloud sessions from phone | Yes — Claude Code on the web, Anthropic VMs | Yes — Codex cloud tasks | Yes — Copilot cloud agent (Actions runners) |
| **Control your own machine from phone** | **Yes — Remote Control** (Feb 2026): outbound-HTTPS relay, no inbound ports, QR pairing, up to 32 sessions, worktree spawn | **Yes (May 2026)** — ChatGPT app pairs with Codex desktop app; **macOS first, Windows pairing "coming soon"** | No (PR-centric only) |
| Local↔cloud handoff | Web→CLI teleport; CLI→cloud (`claude --cloud`); Desktop "Continue in" | `codex cloud` / `codex resume`, integrated | n/a |
| Start NEW local session from phone | Server mode / Dispatch (Pro/Max) | Assign tasks to paired desktop | n/a |
| Cost | Included in Pro/Max | Included in all ChatGPT plans (credit overage) | AI Credits, loud cost complaints |

**Key limitations of first-party (= the remaining gaps):** each is locked to its own agent; Remote Control requires claude.ai login (no API keys), machine must stay awake, transcripts stored on Anthropic servers; Codex Windows pairing not shipped; no cross-agent view; no desktop-GUI access; mobile diff review is thin everywhere.

### 2.2 Third-party ecosystem (2026 state)

| Product | Model | Architecture | Agents | Price | Status / gap |
|---|---|---|---|---|---|
| **Happy Coder** (slopus/happy, 23k★) | OSS mobile+web client | CLI wrapper → **E2E-encrypted blob relay** (AES-256-GCM), self-hostable | Claude Code, Codex | Free (MIT) | Beloved architecture, **chronically unreliable** (breaks on CLI updates, ~600 open issues, "semi-abandoned" sentiment). API keys server-decryptable (zero-knowledge caveat, discussion #680) |
| **Omnara** (YC S25) | Funded startup | v2: local daemon on **Claude Agent SDK** → plaintext cloud relay + optional cloud sandbox, voice | Claude Code, Codex | Free/10 sessions, $20/mo | Most polished UX; **no E2EE** (top objection); v1 wrapper deprecated — "wrapping the CLI became unfeasible to maintain" |
| **Orca** (stablyai, 34k★) | OSS ADE | Desktop + mobile companion + VPS; worktree fleets, embedded Chromium | 50+ / any CLI agent | Free, BYO | Biggest independent; community-stability complaints |
| **Paseo** (11k★) | OSS | Self-hosted daemon + WS API, QR pairing, Elixir relay | CC, Codex, Copilot, OpenCode | Free (AGPL) | Self-host burden |
| **CC Pocket** | Solo dev | Flutter app + TS bridge, LAN/Tailscale | CC (Agent SDK), Codex | Free + IAP | Bus factor |
| **Conductor** | Commercial Mac app | Local worktrees + Conductor Cloud (Jul 2026) | CC, Codex, Cursor | Free local; $50/mo Pro | **Mac-only**; mobile app "coming soon" behind Pro |
| **Cursor Cloud Agents** | Commercial | Cloud VMs, PWA (no native app) | Cursor only | $20+ metered | Credit-burn complaints |
| **Devin** | Commercial | Cloud VMs; Slack is the mobile UI | Devin only | $20–200/mo | No native app |
| **Terragon** | — | Cloud orchestrator | multi | BYO | **Shut down Feb 2026** (no traction) |
| **Vibe Kanban** (Bloop, 27.6k★) | — | Kanban → agents, remote relay | 10+ agents | Free | **Company dead Apr 2026**; community-maintained, relay sunset |
| **Crystal** | — | Desktop parallel sessions | CC, Codex | Free | **Deprecated Feb 2026** → Nimbalyst |

### 2.3 What users say they want (evidence-based)

Top demands (HN/forums/issue trackers):
1. **Unblock the stalled agent from anywhere** — the #1 driver; push notification + one-tap approval.
2. **Same session, not a clone** — terminal stays source of truth; handoff both directions.
3. **Real mobile UI, not a TUI** — "tmux+SSH works but is miserable on a phone."
4. **Phone-scale diff review / QA** — *unsolved by everyone*; summaries or raw terminals only.
5. **Start NEW sessions/projects remotely** — official Remote Control historically mirrors already-running sessions.
6. **Fleet overview across agents** (Claude + Codex + Cursor, status + cost) — only DIY dashboards exist.
7. **Privacy** — E2EE or self-host strongly preferred; plaintext relays get hammered.
8. **Won't pay much** — "$20/mo for a wrapper vs free Happy vs 2-hour Tailscale DIY"; moat anxiety re first parties (validated: Anthropic shipped Remote Control).
9. **Reliability** — wrappers break on every CLI update; SDK-based integrations are the fix.

**Unmet-need shortlist:** mobile diff review/QA · new-session-from-phone · cross-agent fleet view w/ cost · reliable+private+zero-setup together · works when laptop is off (cloud continuation) · **Windows-first anything** (Conductor/VibeTunnel/Codex-desktop are Mac-first).

## 3. Legal/API constraints (what you can build on)

| Surface | Verdict | Notes |
|---|---|---|
| GitHub Copilot cloud agent REST API | **Green** | Official public-preview API (`POST /agents/repos/{o}/{r}/tasks`), OAuth user-to-server; extended to Pro plans Jun 2026 |
| Claude Agent SDK / Codex SDK + `codex app-server` (local, on user's machine) | **Green** | Official surfaces. Codex app-server = JSON-RPC threads/turns/steer/interrupt/approvals — same protocol as their own clients |
| Wrapping the real CLIs on user's machine (Happy pattern) | Gray, tolerated | User's own subscription on user's own machine |
| Claude Agent SDK **with subscription OAuth** | **Red** | Feb 2026 explicit ban on claude.ai OAuth tokens in third-party tools |
| claude.ai cloud sessions from a third-party app | **Red** | No public API; only narrow Routines fire endpoint. Managed Agents Sessions API (API-key billed) is the legit alternative |
| Codex cloud tasks from a third-party app | **Red** | No public API; ChatGPT-plan billed, built-in integrations only |

**Consequence:** the "call cloud sessions" part of the idea cannot be a third-party API integration for Claude/Codex clouds. Options: deep-link into the first-party apps, run your own "cloud" (VPS/sandbox you control, API-key billed), or use Copilot's official API.

## 4. Infrastructure assessment

### Connectivity (phone ↔ Windows laptop behind NAT)
- **Tailscale** — best default. Free tier: 6 users/unlimited devices. Embed **libtailscale** (BSD-3, App-Store-proven) as a userspace node in the mobile app → no VPN-slot conflict, no NetworkExtension memory pain.
- **E2E relay (Happy model)** — best hosted pattern: dumb encrypted-blob store-and-forward, self-hostable single Docker container; also gives store-and-forward when laptop offline. Learn from Happy's API-key flaw.
- WebRTC data channels — best latency, most effort; Cloudflare TURN $0.05/GB after 1TB free.
- Cloudflare Tunnel/ngrok/VPS-reverse-SSH — workable, worse fit (WARP VPN slot / 1GB free cap / self-managed inbound path).

### Session persistence (Windows 11)
- **Skip tmux/mosh entirely** — neither runs natively on Windows; forcing WSL2 adds friction.
- **The right rungs:** both agents persist sessions as JSONL and support headless resume — Claude via Agent SDK (`resume`, `forkSession`, `listSessions()`); Codex via `codex app-server` (`thread/resume`, `turn/steer`). A small **Windows daemon** owning these = Happy/Omnara architecture minus the TUI-scraping fragility that killed Omnara's wrapper.
- Raw terminal escape hatch: daemon-owned **ConPTY → WebSocket → xterm.js** in a webview (ttyd pattern; ttyd itself ships Windows binaries).
- **Modern Standby is the universal enemy:** every transport dies when the laptop sleeps; background daemons are suspended (S0ix DRIPS). Mitigation: `SetThreadExecutionState` keep-awake while a session is active + honest "laptop offline" state + store-and-forward queue. WoL needs a second always-on device — power-user feature only.

### Desktop GUI access from phone
- Full remote desktop on a phone = confirmed bad UX (touch targets, portrait/landscape, keyboard). The wrapper instinct is right.
- **Cheap MVP:** per-window screenshot peek via **Windows.Graphics.Capture** (`CreateForWindow` — captures specific HWND even occluded) polled as stills. This is also exactly what a computer-use agent consumes.
- Upgrade path: **FreeRDP** (Apache 2.0, only license-clean embeddable stack) + TSAppAllowList RemoteApp registry pattern for single-app sessions (needs Win 11 **Pro**; Home can't host RDP). Interop-not-embed: Sunshine/Apollo + Moonlight (GPL — orchestrate, don't link).
- Don't bet on: Parsec (no iOS, no SDK), VNC (slow/insecure), Chrome Remote Desktop (no API).

### Security bar set by the market
- Happy: QR pairing + TweetNaCl E2EE, untrusted relay.
- Anthropic: outbound-only relay, short-lived scoped credentials, per-command approval on phone, Trusted Devices (biometric step-up, 18h re-auth).
- Table stakes for this product: device pairing + E2EE (or fully self-hosted), per-command approval gates on the phone, biometric step-up for destructive actions, no long-lived broad credentials on the phone. Prompt-injection→shell is a real, demonstrated risk; phone UIs increase "just tap allow" pressure — approval UX must show real context (command, cwd, diff).

## 5. Critical assessment

**What the research validates:**
- The pain is real and articulated: stalled agents, TUI misery, session tracking, approvals — exactly the wrapper thesis.
- The architecture is now buildable on **official, stable surfaces** (Claude Agent SDK, Codex app-server, Copilot REST) instead of the TUI-scraping that killed earlier wrappers.
- Genuine unserved niches exist: **Windows-first** (nearly everything is Mac-first; Codex desktop pairing still macOS-only), **cross-agent fleet view**, **mobile diff review**, **GUI-app peek** (nobody does it).

**What the research warns:**
- As a commercial product this category is a **kill zone**: first parties give it away free with the subscription; the funded player (Omnara) fights "why not free Happy?"; three peers died in 2026 (Terragon, Bloop/Vibe Kanban, Crystal). Willingness-to-pay ceiling ≈ $20/mo with strong OSS gravity.
- The "call cloud sessions" pillar is **legally blocked** for Claude/Codex clouds as a third party; only Copilot has an official API. The workaround set (deep-links, own sandbox with API keys) changes the product shape.
- Reliability is where wrappers die — every CLI update broke Happy; commit to SDK surfaces and accept chasing their versions.

**Strategic read:** build it **personal-first as a Windows-first workbench** on the green-lit surfaces, dogfood it remote, and only then decide whether the differentiated slice (Windows-first + cross-agent + GUI peek + mobile diff review) is worth productizing. The research says the wedge exists but the business is brutal.

## 6. Candidate architecture stacks (preview — to be refined in design)

**Stack A — Lazy/pragmatic (recommended start):**
Windows daemon (owns Claude Agent SDK sessions + `codex app-server` + ConPTY terminals + Windows.Graphics.Capture peek + keep-awake) ⇄ Tailscale (embedded libtailscale in app) ⇄ mobile app (React Native or Flutter; session list + chat + approvals + diff viewer + xterm.js webview escape hatch). No third-party relay, fully private, zero monthly cost.

**Stack B — Store-and-forward relay (Happy model):**
Same daemon, but E2E-encrypted blob relay (self-hosted single container) instead of/alongside Tailscale → offline queueing, push notifications without persistent VPN, easier pairing. More moving parts.

**Stack C — Cloud-continuation (Omnara v2 model):**
Stack B + your own sandbox VMs (API-key billed) for "laptop is asleep" continuation. Highest cost/effort; solves the always-on-machine problem the others can't.

## 7. Open questions for the owner

1. **Personal power tool first, or product for market?** (changes everything: E2EE/self-host rigor, agent breadth, polish bar)
2. **Clarify the access model:** the voice note read "I don't want an application… with full access and control" — is the intent (a) full capability but wrapped behind approval gates and a curated UI, or (b) deliberately constrained access (no arbitrary CLI, only whitelisted actions)?
3. **How much do desktop GUI apps matter** vs agent sessions + CLI? (peek-only stills vs interactive single-app streaming is a big scope fork)
4. **Which agents day one?** Claude Code only / +Codex / +Copilot cloud (the only legit cloud API)
5. **Cloud-session pillar:** accept deep-linking into first-party apps for Claude/Codex clouds, or invest in an own-sandbox (API-key) path?
