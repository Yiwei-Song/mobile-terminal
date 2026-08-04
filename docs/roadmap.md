# Roadmap

*Forward plan, open decisions, and carried debt. Status tags: `[next]` do now ·
`[needs-you]` blocked on the owner · `[blocked]` waiting on a dependency · `[later]`.*

*Current reality → [`docs/STATE.md`](STATE.md). Rules → [`AGENTS.md`](../AGENTS.md).*

---

## Milestones

The owner chose **"redesign from the journey, then rebuild"**, reviewing at each milestone.
Spec: `docs/superpowers/specs/2026-08-02-journey-redesign.md` — it governs.

| # | Milestone | Status |
|---|---|---|
| 1 | **Real installable APK** | ✅ done 2026-08-02 (`00bec27`) — built locally, not EAS |
| 2 | **Sessions redesign** — tabs, grouping, unread, search, switcher sheet, conversation depth | ✅ done 2026-08-02 (`5f84d7c`..`f41004e`) |
| 3 | **Codex as second agent + full session access** — read every Claude and Codex session on the PC, grouped by project, forks stitched; transcripts from disk; resume any thread | ✅ done 2026-08-05 |
| 4 | **Push notifications** | `[later]` — the payoff of going native: *agent needs permission* → notification → tap → approval card |
| 5 | **Machine tab consolidation** | `[later]` — fold health/power/tools/preview/terminal fully into one tab |

### Milestone 3 — what landed

- **Session discovery** (`daemon/src/sessions/discover.ts`): both agents' own stores, grouped
  by project, forks stitched into one thread, generated folders sunk. Real machine: 56
  projects / 1690 threads / ~700ms.
- **Transcript history from disk** (`daemon/src/sessions/transcript.ts`): a daemon restart no
  longer shows an empty transcript, and a desktop-started session is readable at all.
- **Projects tab** (`app/app/(tabs)/projects.tsx`): the browse surface, next to Sessions
  (attention) and Machine (utility).
- **Resume any discovered thread** — `sessions.send` resolves a thread the daemon never
  started, and refuses only the one real hazard: a second agent in a folder already working.

Carried out of milestone 3, still open:

- **Codex steering is resume-only.** A Codex thread resumes through the same fork path, but
  `codex app-server` turn/interrupt/approval wiring is not built — a Codex session cannot be
  interrupted or approved from the phone the way a Claude one can.
- **"LOAD OLDER" paging.** The reader returns the newest 50 entries; there is no offset
  parameter yet, so a long conversation cannot be paged backwards.
- **Prepend-cwd mitigation** + warn-tint when the approval target is outside the session cwd.
  The `$HOME` write reproduced twice.
- **Per-file `git.diff{file}`** + a "show this file" affordance (deferred in P4T5: one huge
  lockfile *is* the whole diff and would re-arm the freeze).

## Open decisions

- `[needs-you]` **There is no git remote.** `git remote -v` is empty: the entire project —
  code, ledger, decisions, design assets — exists only in `D:\Mobile-access` on OMEN16. A
  disk failure loses all of it, and there is nothing for a new agent or machine to clone.
  **This is the highest-priority item on this page.** Recommendation: a private GitHub repo,
  pushed today. The token and `config.json` are outside the repo and stay that way.
- `[blocked]` **CI.** A GitHub Action running both suites on push would make the test gate
  real instead of tribal. Blocked on the remote above.
- `[needs-you]` **Named Cloudflare tunnel.** Quick-tunnel URLs rotate on every `cloudflared`
  restart, so the phone re-pairs each time. The fix needs a domain. **Your call** — buy one
  and point it at a named tunnel, or keep re-pasting the token.
- `[needs-you]` **App icon and splash still use the pre-redesign palette.** `app.json` sets
  `backgroundColor` / `adaptiveIcon` to `#0B1220`; the app now opens on `#1D1D1F`, so the
  launch flashes the old colour. The icon PNGs were drawn for the old palette, so this is a
  design pass, not a find-and-replace. **Your call** — leave it, or commission new icon art.
- `[later]` **Play Store release.** `_debug-gallery` still ships in the bundle and needs a
  `__DEV__` guard first.
- `[blocked]` **Session-aware eco keep-awake** — `ecoMode` is hardcoded `false`; needs a
  definition of "idle" that survives a running agent.

## Killed — with tripwires

- **Tailscale** (killed 2026-08-01). GFW-blocked *and* Android allows one VPN at a time.
  *Revisit only on a change of country* — detection code is still there and degrades to
  `null`. Evidence: `.superpowers/sdd/tailscale-report.md`.
- **EAS cloud build** (killed 2026-08-02). Needs an interactive login. *Revisit if local
  gradle breaks or a second target device appears.* `eas.json` is kept.
- **iOS-style 250ms list→conversation push** (killed 2026-08-02). Native-stack supports it on
  iOS only; cannot be implemented on Android.

## Carried debt

### Hardening (the old "Plan 6" list) — `[later]`, all pre-existing

- **`term.*` event fan-out** — every PTY byte broadcasts to *all* authed sockets, including a
  phone that is only showing the session list. A real battery and data cost. **Biggest item
  on this list.**
- WS `bufferedAmount` backpressure; response caps on `git.diff` / `files.list`; caps on
  terminal count and `term.write` payload.
- `frame-ancestors` header + `terminal.html` message-origin check + `linkHandler`.
- `ToolRunner` restart reconciliation — a tool that survives a daemon restart reads as
  Stopped.
- Abandoned-PTY reaper; idle-session reaper; restart-stale-manifest test.
- `reboot-pending` recovery in `power.state` (bounded 120s window).
- Port-type validation in the config guard; `rank()` ignores the 172.16–31 private range;
  `ports.ts` parses English Windows output only; general error-logging pass.
- `index.ts` wiring is untestable as written.

### Test gaps — `[later]`

- **`terminal.html` has zero automated coverage** and is the most security-load-bearing file
  in the repo.
- No tripwire asserting the token never reaches a URL.
- Daemon teardown wiring; who-receives-`term.data`; response-size behaviour for
  `git.diff` / `files.list`.

### UI polish carried out of milestone 2 — `[later]`

- **Theme-swap stragglers:** six pre-M2 screens hand-roll uppercase headings with
  `sub` + inline tracking instead of `type.label`. All one tap off the Machine tab.
- `StatusChip` `space(1.5)` off-grid (precedent: `Field.tsx`) — sweep both together.
- `PressScale` wrapper is copy-pasted 7× — extract it.
- Backdrop `a11y` role on the switcher sheet.
- Template icon / `reactCompiler` device polish; pair-screen prefill cancel guard.

*Reviewer triage marked seven other minors **WONTFIX** (per-row reduce-motion listeners,
unmemoized session rows, mid-fade stagger restart, `usePressScale` gating,
filtered-vs-offline empty state, menu `maxHeight`, `motion.exit` vs `fast`). Don't
re-open them without new evidence.*

### Project hygiene — `[later]`

- **No release tags.** Nothing marks which commit was the shipped APK. Cheap to start:
  tag the milestone-2 head once there's a remote to push tags to.
- ~~Node version unpinned~~ — fixed 2026-08-02: `engines: node >=24` in both packages,
  `README-phone.md` corrected.
