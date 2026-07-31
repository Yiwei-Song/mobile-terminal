# Android App MVP (Plan 2 of 6) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement task-by-task. Steps use checkbox syntax.

**Goal:** A world-class React Native (Expo) app — Android-first, web-renderable for review — that pairs with the daemon and delivers the full session-workbench journey: list, steer, approve, start, inspect.

**Architecture:** Expo (managed, TypeScript strict, expo-router). A typed WS client + zustand store mirror the daemon protocol from a new `shared/protocol.ts` (daemon re-exports it — single source of truth). UI is token-driven (no inline styling values) so the design system is enforceable in review. Every UI task ends with a **rendered-state gate**: the screen runs in Expo web at 390×844 with demo data and is screenshot-reviewed before approval.

**Tech Stack:** Expo SDK (latest), expo-router, zustand, expo-secure-store, expo-camera (QR), @expo-google-fonts/inter + jetbrains-mono, vitest (client/store tests run in node against the real daemon server module with a fake SDK).

## Global Constraints

- App lives in `app/` at repo root (folder `app/` is the Expo project; its router pages under `app/app/` per expo-router convention).
- TypeScript strict. No `any` in app code except at the WS boundary parse point.
- **Design tokens only**: every color/space/radius/font in components comes from `app/src/theme.ts`. A hex literal outside theme.ts is a review defect.
- **Mobile-first mandate (spec):** one-hand use, primary actions thumb-reachable (bottom half), touch targets ≥ 48dp, portrait-first, body text ≥ 15px, dictation-friendly inputs.
- **Rendered-state gate:** every screen task is verified as pixels — Expo web, 390×844 viewport, dark theme, demo data — not just as passing tests.
- No emojis as icons; use lucide-react-native SVG icons exclusively.
- Status semantics everywhere: running=`accent` green, waiting_on_user=`warn` amber (highest visual priority), idle=`muted` slate, dead=`danger` red. Color is never the only indicator (chip label text always present).
- Daemon protocol changes keep all daemon tests green; `npm test` in daemon/ and `npm test` in app/ both green before any commit.
- Commit trailer: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`

## Design System (single source: `app/src/theme.ts`)

Derived OLED-dark for a developer tool; first-principles overrides applied (no luxury serifs; Inter for UI, JetBrains Mono for anything machine-y: paths, commands, terminal, diffs).

```ts
export const color = {
  bg: "#0B1220",          // app background (near-black blue, OLED-friendly)
  surface: "#121B2E",     // cards
  surfaceHi: "#1B2843",   // raised/selected
  border: "#26334F",
  text: "#F1F5F9",
  textMut: "#93A1B7",     // ≥4.5:1 on surface
  accent: "#22C55E",      // running / primary CTA
  accentText: "#052E13",  // text on accent
  warn: "#F5A623",        // waiting_on_user
  danger: "#EF4444",      // dead / destructive
  info: "#38BDF8",        // links, info
  idle: "#64748B",
} as const;
export const space = (n: number) => n * 4;           // 4pt grid
export const radius = { card: 14, chip: 8, pill: 24, input: 10 } as const;
export const font = { ui: "Inter", uiMed: "Inter-Medium", uiBold: "Inter-Bold", mono: "JetBrainsMono" } as const;
export const type = {
  title: { fontFamily: font.uiBold, fontSize: 26, lineHeight: 32 },
  h2:    { fontFamily: font.uiMed,  fontSize: 20, lineHeight: 26 },
  body:  { fontFamily: font.ui,     fontSize: 16, lineHeight: 24 },
  sub:   { fontFamily: font.ui,     fontSize: 14, lineHeight: 20 },
  mono:  { fontFamily: font.mono,   fontSize: 13, lineHeight: 19 },
} as const;
export const touch = { min: 48 } as const;
```

**Journey principles (bind all screen tasks):**
1. The Home list answers "does anything need me?" in <1 second: waiting sessions float to top with amber left-border + chip; everything else recedes.
2. Approval is the hero interaction: full context (tool, command/path in mono, cwd), two big buttons — Deny (outline) left, Allow (filled accent) right — both ≥48dp, bottom-anchored on the session screen.
3. Nothing dead-ends: offline shows "💤 last seen" state with retry; empty states teach (first-run home explains pairing; empty transcript shows the prompt as sent).
4. One-hand: FAB bottom-right for New Session; composer bottom; destructive actions never in thumb-slip zones next to primary ones.
5. Motion: 150-250ms fades/slides only; no layout-shifting hovers; respects reduce-motion.

---

### Task 1: Shared protocol extraction

**Files:**
- Create: `shared/protocol.ts` (move ALL type/interface exports from `daemon/src/protocol.ts`: ClientMsg, ServerMsg, SessionStatus, SessionEvent; plus move `ManifestEntry` type here renamed export `SessionRow` with alias kept)
- Modify: `daemon/src/protocol.ts` (re-export types from shared, keep parser + METHODS), `daemon/src/sessions/manifest.ts` (import SessionRow type from shared via `../../../shared/protocol.js`? — NO: use a TS path alias `@shared/protocol` configured in daemon tsconfig `paths` + tsx; verify build & tests), tests as needed.

**Interfaces:** Consumes nothing new. Produces: `shared/protocol.ts` importable by both daemon (path alias or relative) and app (metro watchFolders). Daemon public behavior unchanged.

- [ ] Step 1: Move types, re-export from daemon/src/protocol.ts (`export type { ... } from "../../shared/protocol.js"` — relative import is fine and simplest; ensure tsc emit works with rootDir by adding `"rootDir": ".."`? If rootDir fights, instead KEEP types in daemon and have shared/protocol.ts re-export FROM daemon source via relative path for the app. Choose whichever keeps daemon build+tests green with the smallest diff — document the choice in the report.)
- [ ] Step 2: `cd daemon && npm test` green, `npm run build` green. Commit.

### Task 2: Daemon Plan-2 additions

**Files:** Modify `daemon/src/sessions/claude.ts` or `registry.ts` (user echo), `daemon/src/index.ts` + `notify.ts` (generic ntfy body), `daemon/src/protocol.ts` + `server.ts` glue (new RPCs), tests.

**Behavior (TDD each):**
1. **User echo:** when `sessions.send`/`sessions.new` submits user text, registry pushes `session.text` `{role:"user"}` so OTHER clients see it (sender already knows). Test: send → event observed.
2. **ntfy privacy:** notification bodies are generic — permission: "Approval needed · <session title>"; done: "Finished · <session title>". No commands/paths. Test on notify call args (inject fetch or extract a body-builder fn).
3. **New RPCs** (add to METHODS + params validation + registry/config handling): `config.get` → `{ntfyTopic, version, hostname}` (os.hostname()); `config.set` params `{ntfyTopic: string|null}` persists via config file. Tests: round-trip through a real server+registry.
4. `sessions.list` unchanged (rows are SessionRow).

- [ ] TDD per behavior, daemon suite green, commit.

### Task 3: Expo scaffold + theme + core components

**Files:** Create Expo project in `app/` (`npx create-expo-app@latest app --template default` then strip to minimum), `app/src/theme.ts` (EXACT content from Design System above), `app/src/components/`: `Screen.tsx` (safe-area, bg), `Text.tsx` (variant prop = type scale), `Button.tsx` (variants: primary/outline/danger/ghost; ≥48dp; pressed opacity; loading state disables), `StatusChip.tsx` (status → color+label, never color-only), `Card.tsx`, `MonoText.tsx`, `EmptyState.tsx` (icon+title+body+action). Demo screen `app/app/_debug-gallery.tsx` rendering every component in every state.
- Fonts loaded via @expo-google-fonts (Inter 400/500/700, JetBrains Mono 400) with splash-hold until loaded.
- Metro config: `watchFolders: [repoRoot]` so `shared/` imports resolve.
- Runs on **web**: `npx expo start --web`.

- [ ] Scaffold; theme verbatim; components + gallery; `npx tsc --noEmit` green; commit.
- [ ] **Rendered gate:** gallery screenshot at 390×844 (controller reviews).

### Task 4: WS client + store

**Files:** Create `app/src/lib/client.ts`, `app/src/lib/store.ts`, tests `app/test/client.test.ts` (vitest, node env — import `startServer` + `Registry` + fake SDK fixtures FROM the daemon source to run a real in-process daemon; this closes the "server+registry integration test" gap from Plan 1's final review).

**client.ts contract:**
```ts
export type ConnState = "connecting" | "online" | "offline";
export class WorkbenchClient {
  constructor(url: string, token: string, handlers: { onEvent(e: SessionEvent): void; onState(s: ConnState, lastSeen?: number): void });
  connect(): void;                      // auto-reconnect, backoff 1s→2→4→8 (cap 15s), re-auth + emits onState
  request<T = unknown>(method: string, params?: object, timeoutMs?: number): Promise<T>; // id-correlated; rejects on close/timeout(10s default)
  close(): void;
}
```
**store.ts (zustand):** sessions: SessionRow[] (sorted attention-first — trust server order on list, resort on status events), transcripts: Map<sessionId, Item[]> (text/tool items), pendingApprovals: Map<sessionId, Approval[]>, connState, machine {hostname, version}. Actions: refreshSessions (sessions.list on every `online` — the re-list-on-reconnect requirement), applyEvent(e) (buffering for unknown-session events like the debug page), approve/deny/send/interrupt/newSession wrappers. **Client sends `title` as undefined, never null.**

- [ ] TDD: real-daemon integration tests: auth+list; new→permission→approve→done; reconnect after server restart re-lists; timeout rejects. App suite green; commit.

### Task 5: Pairing + Settings screens

**Files:** `app/app/pair.tsx`, `app/app/settings.tsx`, `app/src/lib/pairing.ts` (SecureStore persist `{host,port,token}`; web falls back to localStorage with a visible "less secure" note).
**Pairing journey:** first-run → explainer card ("Run `npm run dev` on your PC — scan the QR") → camera scan (expo-camera, permission prompt) OR "enter manually" (host/port/token fields, mono font) → verify by connecting (spinner ≤10s) → success transitions to Home; failure shows actionable error ("Unreachable — same wifi? VPN off?") with retry. Settings: server row (re-pair), ntfy topic (config.get/set round-trip, explanation line + link hint to install ntfy app), app version, disconnect.
- [ ] Implement + store wiring; tsc green; commit. **Rendered gate** (both screens, incl. error + success states via demo mode).

### Task 6: Home screen (session list)

**Files:** `app/app/index.tsx`, `app/src/components/SessionRow.tsx`, `MachineBar.tsx`, demo-data module `app/src/lib/demo.ts` (env-flag `EXPO_PUBLIC_DEMO=1` seeds store with rich fake sessions/transcripts for rendered review; no daemon needed).
**Layout:** MachineBar top (hostname, conn dot+label, last-seen when offline). List: SessionRow = title (1 line), cwd tail in mono muted, StatusChip right, waiting rows get 3px warn left-border + surfaceHi; relative time. Empty state teaches pairing/new. FAB (+) bottom-right → new session. Offline banner variant. Pull-to-refresh.
- [ ] Implement; tsc green; commit. **Rendered gate:** populated (incl. ≥1 waiting), empty, and offline states.

### Task 7: Session screen (transcript + approvals + composer)

**Files:** `app/app/session/[id].tsx`, `components/TranscriptItem.tsx`, `ApprovalCard.tsx`, `Composer.tsx`.
**Layout:** header (title, status chip, interrupt icon-button when running). Transcript FlatList (inverted): user bubbles right-accent-tinted, assistant text plain, tool lines mono muted with wrench icon, collapsed by default >3 lines (tap expands). ApprovalCard: warn border, tool name, command/path in mono block (scrollable if long), cwd sub line, Deny(outline)/Allow(primary) 48dp bottom row — card pinned above composer, one per request (stack if multiple). Composer: multiline input (dictation-friendly), send button ≥48dp, disabled+spinner while request in flight; interrupt confirm-sheet. Dead session → banner "Session ended — send to restart it" (resume path). Auto-scroll on new items unless user scrolled up (show ↓ jump pill).
- [ ] Implement; tsc green; commit. **Rendered gate:** live-running, approval-pending (long command), dead, and empty-new states.

### Task 8: New Session screen

**Files:** `app/app/new.tsx`, recent-cwd persistence (local, last 8, mono rows), agent selector (Claude enabled; Codex row visible but disabled "Plan 3"), prompt multiline with dictation hint, big Start button (loading → navigates to session screen on id). cwd surfaced prominently (Plan-1 note: SDK may write outside cwd — show the absolute path clearly; helper text "the agent works in this folder").
- [ ] Implement; tsc green; commit. **Rendered gate:** empty + filled + loading.

### Task 9: Rendered-state design review (whole journey) + fix pass

Controller-driven: run Expo web + demo mode at 390×844, screenshot every screen/state, dispatch a design-reviewer subagent with the screenshots + Design System + Journey principles + the skill checklist (contrast ≥4.5:1, targets ≥48dp, no color-only signals, spacing rhythm, hierarchy, empty/loading/error coverage). Fix findings; re-render; repeat until clean.

### Task 10: Real E2E + device handoff

- Web E2E: app (web, no demo flag) against real daemon + real SDK: pair (manual entry), new session, approve real permission, see file created, diff of transcript vs debug page. Scripted where possible; controller drives Browser pane otherwise.
- Device: README-phone.md — exact steps for Expo Go on Android (same wifi, scan, pair), ntfy app setup, and known Expo Go limitations (camera QR needs permission; SecureStore works). APK build documented (`eas build -p android --profile preview` or `npx expo run:android`) as follow-up, NOT executed (needs user's choice on installing Android SDK vs EAS cloud).

## Self-Review (write-time)

- Spec coverage: session list ✅ approvals w/ context ✅ new session ✅ diffs ❌ (diff viewer is data-dependent on Plan 4's files/git endpoints — transcript covers Plan 2; noted in plan header of Plan 4), preview browser ❌ (Plan 4), terminal ❌ (Plan 4), sysmon ❌ (Plan 5). Mobile-first mandate encoded as constraints + gates ✅. Push notifications via ntfy ✅ (settings + daemon generic body).
- UI task steps carry exact specs + contracts rather than full TSX listings — deliberate: rendered-state gates + design-token constraint enforce quality where code listings can't. Placeholder scan: no TBDs. Type consistency: SessionRow/SessionEvent single-sourced in shared/protocol.ts.
