# AGENTS.md — standing rules for this repo

**One source of truth for agent guidance.** Every tool reads this file: Codex and Cursor
pick it up natively; `CLAUDE.md` and `GEMINI.md` are one-line pointers here. Never fork
guidance per tool.

Rules only. Current state → [`docs/STATE.md`](docs/STATE.md). Forward plan →
[`docs/roadmap.md`](docs/roadmap.md). New here → [`HANDOVER.md`](HANDOVER.md).

Update this file only when a *rule* changes.

---

## 1. Working agreement

- **Founding partner, not hired coder.** Find the first-principle intent behind the ask
  and challenge a weak path with a better one. Don't silently execute a bad plan.
- **Decide before you build.** Lock boundary, defaults and naming in a doc section first;
  the build then executes a spec instead of discovering scope mid-flight.
- **Surface real decisions early.** Don't ship the minimum and wait to be told it's wrong.
- **Teach as you build.** One to three sentences on each non-obvious pick.
- **Taste boundary.** Visual design and brand copy are the owner's. Implement to a
  provided reference (the mockups, the benchmark palette) or draft options for a pick.
  Do not generate taste and ship it.

## 2. Quality bar

- **Production quality, first pass.** "Prototype" is the stage, never the craft. Every
  path handles empty, loading, error and edge states. No placeholder ships as final.
- **Minimal code, never minimal understanding.** Read the whole flow before shortening
  the fix. Prefer reuse > stdlib > platform-native > existing dependency > new code;
  delete over add; no speculative abstraction.
- **When brevity and quality conflict, quality wins.** A shorter diff never justifies a
  dropped edge case, a skipped validation or an unhandled error.
- **Bug fix = root cause.** Fix in the shared path all callers route through, not the one
  path the report named. Grep every caller before editing.
- **No new dependency** without saying what it replaces and why a few lines won't do.

## 3. Verification — the rules that came from real incidents

- **Verify the rendered result, never computed state.** Green tests and a typecheck are
  not "done". Install the build and look at it.
- **The emulator rig is mandatory for app changes.** Setup in
  [`docs/STATE.md`](docs/STATE.md#the-emulator-rig). It has caught two ship-blockers that
  no web render structurally could (a native-only layout collapse, and a release manifest
  that silently blocked every plain `ws://`). A web export exercises different branches
  than the APK.
- **One rig is not every device.** The emulator runs gesture navigation only; a
  source-derived review still catches what one device config cannot.
- **A "was done" note about external state is a claim, not evidence.** Query prod, env,
  config or the network directly before depending on it.
- **Both suites green before any merge:** `cd daemon && npm test` · `cd app && npm test`.
  Both typecheck as part of `test`. They are deterministic — a flake is a bug, find it.
- **Silent failure is the worst shape.** Anything scheduled or backgrounded fails loud.
- **Incidents get structural fixes, not patches.** Ship the fix *plus* the change that
  makes the class of failure impossible or loud, and write up "why it can't happen twice".
- **Clean up after yourself.** No orphaned daemon / Expo / emulator processes.

## 4. How work is executed

- **Task-by-task, with an independent review per task, fixes applied before moving on.**
  The reviewer must be a separate context from the implementer — it has repeatedly caught
  real bugs. Keep this regardless of which model or tool runs it.
- A reviewer's finding is a claim too. **Disproving a review finding with evidence is a
  good outcome** and has happened several times; record the disproof.
- Each milestone gets a plan file in `docs/superpowers/plans/`, tasks numbered, and a
  ledger entry per task in `.superpowers/sdd/progress.md` (task, commits, review outcome,
  minors carried forward).
- **Close a milestone properly:** both suites green → coherent commits → update
  `docs/STATE.md` in place → move done/new items on `docs/roadmap.md` → ledger entry.
- Scope creep needs a new line on the plan — visible and deliberate.

## 5. Decisions

- Format: `**Decided (owner, YYYY-MM-DD):** <what> — <why>`. A dated decision with a
  rationale ends the debate; an undated one restarts it.
- **"Do not relitigate" markers are binding.** `docs/STATE.md` keeps the list. Do not
  re-pitch a decision flagged there without new evidence.
- **Killed ≠ forgotten.** A kill carries a revisit tripwire ("revisit when X").
- **Superseded decisions keep their rationale** — move them, don't delete them. The *why*
  is what stops the same wrong idea coming back.
- Open items on the roadmap carry exactly one tag: `[next]` · `[needs-you]` (blocked on
  the owner) · `[blocked]` (waiting on a dependency) · `[later]`.

## 6. Reporting to the owner

Enforced format, not a preference. Violating it fails the task even if the work is right.

1. **Answer first.** Line 1 is the outcome or the ask. Never open with process.
2. **Every open item = 4 slots, ≤1 line each:** where we are → do → why → owner tag
   (`[I do — say go]` / `[Your call]` + a recommendation / `[You do — steps]`).
3. **Plain English.** No paths or jargon unless the owner must type it.
4. **30-second rule.** Bold the anchors, cap lists at five, no preamble, no recap, state
   one concrete next action.
5. **Honesty over polish.** When a review disproves an earlier claim, say so plainly.

## 7. Security house rules

- The daemon is internet-reachable behind **one token**. Treat every RPC as hostile input.
- Never put the token in a URL, a log line or a notification body. Notifications are
  generic by design ("Approval needed") — no commands or paths leave the PC.
- Files over the wire are **read-only**. The agents edit; the phone reviews.
- **`allowedRoots` is UI scoping, not a containment boundary.** It includes every session
  cwd, and `sessions.new{cwd}` accepts any string — the same client can `term.create` a
  shell anywhere. Do not mistake it for a sandbox or build a security claim on it.
- `terminal.html` is the most security-load-bearing file in the repo and has **zero
  automated coverage** — change it with extra care (see roadmap).
- Path handling goes through the existing `realpath` traversal guard. Don't add a second
  path resolver.

## 8. Repo map

| Path | What |
|---|---|
| `daemon/` | Node/TS WebSocket daemon on the PC — owns sessions, PTY, files, system, tools |
| `app/` | Expo / React Native app (Android target; web export used for the tunnel) |
| `shared/protocol.ts` | The type contract both halves import — import-free by design |
| `docs/` | STATE, roadmap, plans, specs |
| `.superpowers/sdd/` | Ledger + design assets. Mostly gitignored; see its `.gitignore` |
| `research/` | One-off research write-ups |
