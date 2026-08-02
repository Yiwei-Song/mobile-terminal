# Milestone 2 — Sessions Redesign

*Executes the journey-redesign spec (`docs/superpowers/specs/2026-08-02-journey-redesign.md`) for the Sessions surface. Mockups: `.superpowers/sdd/redesign2-{sessions,conversation,switcher}.png`. Tokens: `.superpowers/sdd/theme-proposed.ts`.*

## Global Constraints

These bind every task. Reviewers: verify each one against the diff.

1. **Tokens only.** Every color, spacing, radius, type style, duration and curve comes from `app/src/theme.ts` (which Task 1 replaces). No hex literals, no raw px paddings off the 4pt grid, no inline `fontSize`. If a needed token is missing, add it to the theme with a comment — never inline it.
2. **Motion budget (Emil):** tab switch **none**; list→conversation push 250ms; switcher sheet 300ms `easing.drawer`; approval card in 200ms `easing.out` from `scale(0.97)`+opacity, out 160ms; button press `scale(0.97)` 160ms; list first-paint stagger 40ms, decorative, never blocks input. Nothing above 300ms. Never animate from `scale(0)`. `prefers-reduced-motion` (RN: `AccessibilityInfo.isReduceMotionEnabled`): keep opacity, drop movement.
3. **Type discipline:** hierarchy = weight+size+leading as a set. Two weights only (Regular, Bold). Uppercase micro/label styles carry their letterSpacing from the theme — never add tracking inline.
4. **Touch targets ≥ 48pt** (`touch.min`). Pressables must not overhang their parent (Android drops touches outside parent frame — regression we fixed once already).
5. **Status → color mapping:** `waiting_on_user`→`color.warn`, `running`→`color.accent`, `idle`→`color.idle`, `dead`→`color.danger`. Unread dot = `color.info`.
6. **No new dependencies.** The switcher sheet is built with RN `Modal`/`Animated`, not a bottom-sheet library.
7. **Existing transport/store logic is load-bearing.** Do not touch `app/src/lib/client.ts`, `pairing.ts`, or daemon code. Store changes are additive (new fields/actions only).
8. **Tests:** `cd app && npm test` green after every task (tsc + vitest). New pure logic (grouping, unread, relative time, search filter) gets vitest coverage in `app/test/`.
9. **Every screen keeps working offline/unauthorized** — the existing banners/empty states survive the redesign.
10. **Do not regress the pending-approval recovery flow**: approval card must render from `pendingApprovals` regardless of how the screen was reached.

## Task 1 — Theme swap

Replace `app/src/theme.ts` with `.superpowers/sdd/theme-proposed.ts` (copy verbatim, then reconcile):

- The proposed file is a drop-in: same export names/shapes plus new `type` variants (`strong`, `meta`, `label`, `micro`), new `easing` export, `font.uiMed` aliased to Bold.
- Reconcile compile errors across the 37 importing files. Expected friction: any `type` variant that existed before but not in the proposed set; `motion` gains `stagger`. Resolve by mapping old variant → nearest new variant (e.g. old `h2` stays `h2`), never by re-adding deleted tokens.
- `_debug-gallery.tsx`: add rows for the new type variants and the status colors so the gallery shows the whole system.
- Load `Inter-Bold` and drop any Medium weight from font loading in `_layout.tsx` if present.
- Test: full suite. Acceptance: `npm test` green; gallery renders every variant.

## Task 2 — Tab shell (Sessions | Machine)

- Convert root navigation to expo-router **Tabs** at `/` with exactly two tabs: **Sessions** (`index`) and **Machine** (new `machine.tsx`). All other routes stay stack screens pushed above the tab bar (expo-router: keep `Stack` root, add a `(tabs)` group with its own `Tabs` layout; `session/[id]`, `new`, etc. remain outside the group).
- Tab bar per mockup: `color.bg` background, hairline top border `color.border`, icons (message-circle for Sessions, the existing system/gear glyph for Machine) + `type.micro` uppercase labels, active = `color.text`, inactive = `color.textMut`. **No switch animation** (`animation: 'none'` / default lazy).
- `index.tsx` loses `ActionRow` and `MachineBar` — the session list becomes the whole screen (Task 3 restyles it).
- `machine.tsx` (v1, full consolidation is milestone 5): connection state header (reuse `MachineBar` content inline), then a simple list of rows navigating to System, Terminal, Files, Preview, Tools — icon + label + chevron, 48pt+ rows, grouped in a `Card`. Settings row too (gear moves off Sessions).
- Test: suite green. Acceptance: two tabs render, all old routes reachable, no tool buttons on Sessions.

## Task 3 — Sessions list redesign

Match `redesign2-sessions.png` exactly:

- **Grouping** (new pure module `app/src/lib/groups.ts` + tests): `waiting_on_user` → "NEEDS YOU"; `running` → "WORKING"; `idle`+`dead` → "RECENT", each group sorted `updatedAt` desc. Empty groups render nothing (no header).
- **SectionList** with `type.label` headers in `color.textMut` (NEEDS YOU header in `color.warn`), hairline rule after header text per mockup.
- **Row anatomy** (rework `SessionRow.tsx`): 40pt agent mark tile (`radius.card`, `color.surfaceHi` bg; Claude = asterisk glyph, Codex = `>_` glyph — both drawn with lucide icons, agent field already exists) · title `type.strong` max 2 lines · `cwd` in `type.mono` `color.textMut` single line ellipsized head (`D:\projects\api-server` tail visible) · relative time `type.meta` top-right ("2m", "6h", "1d" — pure fn + tests) · status chip bottom-right (`type.micro` on `radius.chip`, filled `color.warn`+`accentText` for NEEDS YOU, outlined text-only for others per mockup) · **unread dot** 8pt `color.info` on the mark tile's top-right corner.
- **Needs-you card emphasis:** `stroke.emphasis` left edge in `color.warn` (mockup shows amber accent edge).
- **Unread state** (new store fields, additive): `lastSeen: Record<sessionId, string>` persisted via the same storage used by `recents.ts`; `markSeen(sessionId)` called on conversation focus; a session is unread when `updatedAt > lastSeen[id]`. Pure predicate in `groups.ts`, tested (missing lastSeen = unread only if updatedAt exists; own-open session never unread).
- **Search:** magnifier in the title row toggles a `Field` under the title (autofocus); case-insensitive substring filter over title+cwd, applied before grouping; empty query = no filter. Pure fn + tests.
- **Header:** big "Sessions" `type.title`. **FAB** per mockup: 56pt `color.accent` circle, `Plus` in `accentText`, bottom-right above tab bar.
- Stagger: rows fade/slide in 40ms apart on first mount only.
- Test: suite + new `groups.test.ts`. Acceptance: screenshot matches mockup structure at 390pt.

## Task 4 — Conversation screen redesign

Match `redesign2-conversation.png` on `session/[id].tsx`:

- **Header:** back chevron · title `type.strong` single line ellipsized, with caret-down affordance (tap target = title row; opens Task 5's switcher; until Task 5 lands it's inert) · status word in `type.micro` (`NEEDS YOU` in `color.warn` etc.) · `⋯` overflow (`MoreHorizontal` icon, 48pt).
- **Overflow menu** (RN `Modal`, anchored top-right, `color.surface` card, hairline border): rows *Changes*, *Files here*, *Terminal here*, *Interrupt* (running only), each icon+label 48pt. Changes → `/files?diff=<cwd>`; Files here → `/files` scoped to session cwd (existing param or add one); Terminal here → `/terminal`; Interrupt → existing stop flow (keep its confirm). No Archive (no daemon RPC yet — deferred to milestone 3).
- **Transcript restyle** (`TranscriptItem.tsx`): agent text full-width, no bubble, `type.body` on `color.text`, preceded once per run by an agent attribution row (mark glyph + "CLAUDE" `type.micro` `color.textMut`) per mockup; user message right-aligned on `color.surfaceHi`, `radius.card`, max-width ~85%, no accent border; tool rows = full-width `color.surface` chip, mono, `>` prefix, collapsed summary + ellipsis expansion (keep existing collapse logic), meta like "218 lines" in `color.textMut`; inline code in agent text stays mono (existing behavior).
- **Approval card restyle** (`ApprovalCard.tsx`, position unchanged — outside the scroll, above composer): header row "RUN COMMAND" `type.label` + right-aligned "CLAUDE · WAITING" `type.micro` `color.textMut`; command in mono block on `color.bg` `radius.card`; cwd row with folder icon mono muted; buttons per mockup — DENY outlined pill (borderHi), ALLOW filled `color.accent` pill, both 48pt, uppercase micro labels; card has `stroke.emphasis` left edge `color.warn` and enters 200ms `easing.out` scale 0.97→1 + opacity, exits 160ms.
- **Composer:** `color.surface` input `radius.card` "Message Claude…" placeholder, multiline growing to ~4 lines, right circular 48pt send button (`color.surfaceHi` idle → `color.accent` when text present).
- **Jump-to-latest pill** kept, restyled to tokens.
- Test: suite green (TranscriptItem has snapshot-ish tests? if none, add render tests for the three item kinds via react-test-renderer only if trivially possible with existing test setup — otherwise pure-logic tests only). Acceptance: screenshot matches mockup structure.

## Task 5 — Session switcher sheet

Match `redesign2-switcher.png`:

- New `app/src/components/SessionSwitcher.tsx`: RN `Modal` (transparent) + `Animated` translateY sheet from bottom, 300ms `easing.drawer` in / 250ms out, scrim `#000` at 40% opacity fading with the sheet, drag handle bar 36×4 `color.borderHi`, rounded top corners 12 (add `radius.sheet: 12` token with comment).
- Content: "Switch session" `type.h2` + right count "`N SESSIONS`" `type.micro` muted · rows: mark tile 32pt, title `type.strong` 1 line ellipsized, cwd mono muted 1 line, right side = status word `type.micro` in status color; current session row on `color.surfaceHi` with check icon + "CURRENT"; "＋ New session" row last.
- Ordering = same grouping order as the list (needs-you, working, recent). Tap row → `router.replace('/session/<id>')` and close; New session → `/new`.
- Swipe-down and scrim-tap dismiss. Sheet inherits drag velocity on release (Animated spring w/ velocity — Apple: interruptible, no hard cut).
- Wire the conversation header title tap (Task 4's caret) to open it.
- Test: pure ordering logic reused from `groups.ts` (already tested). Suite green. Acceptance: screenshot mid-open + open matches mockup.

## Task 6 — Design-review pass (controller-led)

Not an implementer task: controller screenshots all surfaces on the emulator at 1080×2400 (Pixel 7), compares against mockups, runs the Emil + Apple checklists (press states, easing, tracking, touch targets, reduced-motion), and dispatches one fix subagent with the full findings list. Gallery screen updated if tokens drifted.

## Task order & verification

1 → 2 → 3 → 4 → 5 → 6, sequential (each builds on the previous). After each task: suite green, controller smoke-screenshots the affected surface on the emulator (web export fallback if emulator is down), findings feed the task's review loop. Owner reviews after Task 6 with an installed APK.
