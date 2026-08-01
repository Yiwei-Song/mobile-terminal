# Mobile Workbench — Journey Redesign

*2026-08-02. Supersedes the UI decisions in the Plan-2 spec. Written after the first real-usage test failed the "does this feel right" bar.*

## What went wrong

The build optimised for capability coverage, not for the daily experience. Concretely:

1. **Delivered a browser tab, not an app.** The Expo web export behind a tunnel was a connectivity fallback presented as a product.
2. **Terminal got equal billing with the work.** Four tool buttons sit above the session list on the home screen, and the terminal — an escape hatch — was the first thing demoed. The user's own words at kickoff: *"I mostly need it for AI work."*
3. **The session experience is thin.** A flat list and a transcript. The user asked for the Claude-desktop sidebar experience: browse sessions, pick one, see progress, continue the conversation. There is no search, no grouping, no sense of what changed while away, no fast switching.
4. **One agent.** Codex was scoped to a later phase and never landed, so the "one place for all my agent work" premise is unmet.

## Who this is for, and when they open it

A developer with agent sessions running on their PC, away from the desk: commuting, in a meeting, in bed, on a business trip abroad. They open the app for exactly three reasons.

| Job | Trigger | Success looks like |
|---|---|---|
| **1. Unblock** | Push notification: an agent needs permission | Answered in under 15 seconds, phone back in pocket |
| **2. Catch up** | Idle moment — "what happened?" | Sees what changed since last look, without reading everything |
| **3. Direct** | A thought worth acting on | Starts or steers work by typing, not by navigating |

Everything else — terminal, files, preview, system monitor — is support. Support does not get top-level real estate.

## The shape

**Two tabs. Sessions is the product; Machine is the utility belt.**

```
┌─────────────────────────────┐
│  Sessions        │  Machine │   ← bottom tab bar, no switch animation
└─────────────────────────────┘
```

Tab switching is a high-frequency action. Per the animation frequency rule: **no animation**.

### Tab 1 — Sessions (root)

The sidebar, translated. Not a flat list — grouped by what the user needs to know.

- **Needs you** — pinned top, amber. The reason the app exists.
- **Working** — running now.
- **Recent** — idle, most recent first.
- Older behind scroll.

**Row anatomy:** agent mark (Claude / Codex, visually distinct), title (the prompt, up to 2 lines), folder tail in mono, relative time, status chip, and an **unread dot** when there is activity since the user last opened that session.

The unread dot is what answers job 2. It is the messaging-app metaphor, and it is the single most valuable addition: *what changed while I was away* becomes glanceable instead of read-the-whole-list.

**Search** collapses at the top (the desktop sidebar has it; the phone needs it more).

**＋** starts a session.

No tool buttons here. No machine strip. The list is the screen.

### Tab 2 — Machine

Everything that is about the computer rather than the work: health + processes, power (keep-awake / lock / reboot), tools, dev-server preview, and the global terminal. One place, out of the way, complete.

### The Conversation screen (the heart)

Reached by tapping a session. This is where the product is won or lost.

- **Header:** back · title (tappable) · status. Tapping the title opens the **session switcher** — a sheet listing other sessions so the user can move between conversations without going back to root. This is the mobile answer to the desktop sidebar's simultaneity.
- **Body:** a real conversation. Scrollback that loads older messages, jump-to-latest pill, user messages right, agent left, tool activity collapsed but expandable.
- **Pending approval:** pinned above the composer, never in the scroll — the user must never have to hunt for the thing blocking their agent.
- **Composer:** native multiline, dictation-friendly, send.
- **⋯ overflow:** *Changes* (diff for this session's folder), *Files here*, *Terminal here*, *Interrupt*, *Archive*. All contextual to this session — which is where they were always useful, and where they stop competing with the work.

### Terminal, honestly

Demoted, and scoped down. It lives in the session overflow and in the Machine tab. It is not on the home screen and it is not the demo.

The current terminal is an xterm page inside a WebView, which is the direct cause of the bad typing and scrolling. In a native shell that improves (real keyboard, real momentum scroll), but a WebView terminal will never feel native. **Decision: fix input/scroll in the native app, do not invest further.** If it still disappoints, that is acceptable — it is an escape hatch, not the product.

## Both agents

Claude and Codex in one list, visually distinguished by mark and colour, with the same conversation surface. Codex integrates through its `app-server` JSON-RPC protocol (threads/turns/steer/interrupt/approvals), which maps cleanly onto the existing session model.

Cross-agent is a headline reason this product should exist at all — no first-party app shows both.

## Delivery: a real app

**EAS Build → installable Android APK.** Not Expo Go, not a browser tab.

Connectivity is unchanged and already solved: the app connects to a Cloudflare tunnel URL over `wss://`, which works from China without a VPN slot on the phone.

**Push notifications** are the payoff of going native, and the direct enabler of job 1: *agent needs permission* → notification → tap → straight into the approval card.

## Motion (Emil's framework applied)

| Element | Treatment | Why |
|---|---|---|
| Tab switch | none | 100+/day — animation makes it feel slow |
| List → conversation | push, 250ms `cubic-bezier(0.23,1,0.32,1)` | Entering: ease-out |
| Session switcher sheet | 300ms `cubic-bezier(0.32,0.72,0,1)` | iOS drawer curve; occasional, deserves polish |
| Approval card in | 200ms ease-out, `scale(0.97)→1` + opacity | Never from `scale(0)` |
| Approval resolve | 160ms out | Exit faster than enter; system responding |
| Buttons | `scale(0.97)` on press, 160ms | Instant feedback |
| List first paint | 40ms stagger | Decorative, never blocks input |
| Unread dot | none | Information, not event |

`prefers-reduced-motion`: keep opacity, drop movement.

## What this explicitly is not

- Not a remote desktop.
- Not a mobile IDE — the phone reviews, the agents edit.
- Not a terminal-first tool.

## Build order

1. **Native shell + real APK** — the app installs and runs, existing screens inside it.
2. **Sessions redesign** — grouping, unread, search, switcher sheet, conversation depth.
3. **Codex** — second agent in the same surface.
4. **Push notifications** — close the loop on job 1.
5. **Machine tab consolidation** — fold the four tools in, off the home screen.

Each is a milestone the user reviews.
