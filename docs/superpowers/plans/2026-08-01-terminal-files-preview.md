# Terminal, Files, Diffs, Preview, Dev-Tools (Plan 4 of 6) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development, task-by-task. Checkbox steps.

**Goal:** The inspect-and-work-on-anything half of the product: a real terminal on the phone, a file browser with git diffs, a preview browser for the PC's dev servers, and one-tap start/stop of the tools that work needs (Docker, headless browser, anything in `tools.json`).

**Architecture:** All four features are daemon capabilities exposed through the existing authenticated WS seam (`protocol.ts` METHODS → `registry.handle`), so they inherit pairing, auth, reconnect, and the app's store patterns for free. The terminal is the one exception to "app renders everything": the daemon **serves an xterm.js page** and the app loads it in a WebView, which opens its own WS with the same token — avoiding Metro-bundling a terminal emulator and keeping high-volume PTY bytes off the app's store.

**Tech Stack:** daemon: `@lydell/node-pty` (prebuilt ConPTY — see Task 1 gate), `@xterm/xterm` (served, not bundled), existing `node:fs`/`child_process`, git via CLI. app: `react-native-webview` (terminal + preview), existing theme/components.

## Global Constraints

- Daemon `daemon/`, app `app/`. Both suites green before every commit (`cd daemon && npm test`, `cd app && npm test` — currently 82 / 67). TS strict, ESM.
- **Never execute destructive or machine-altering commands in tests.** PTY tests spawn only a harmless echo/idle process and kill what they spawn. Dev-tool tests use fake spawn. No test starts Docker.
- **Path-traversal guard is mandatory** on every file/diff endpoint: resolve + normalize, then require the result to be under an allowed root. Defense-in-depth (the terminal already grants shell access) but a read API must not be the easy way to slurp `~/.ssh`. Allowed roots = `config.fileRoots` (configurable) ∪ the cwds of known sessions.
- **Token never in a URL.** The terminal WebView loads `http://host:port/terminal` with no query string; the app passes the token via `postMessage` after load, and the page authenticates its own WS with it.
- Design: tokens only (`app/src/theme.ts`), touch ≥48, dark, mobile-first, lucide icons, no emoji. Terminal page styling matches the theme (its colors are duplicated in the served HTML — acceptable, note it).
- Every new RPC: METHODS entry + param validation + ClientMsg variant + handler + a real server+registry round-trip test.
- No `Date.now()` in daemon code. Commit trailer: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

## File Structure

```
daemon/src/
  term.ts          PtyManager: spawn/write/resize/kill, scrollback ring, data events
  files.ts         roots resolution + guard, list/read, git status/diff
  ports.ts         listening localhost TCP ports + owning process
  tools.ts         tools.json load, start/stop/status of long-running dev tools
  protocol.ts / registry.ts / index.ts / server.ts   + RPCs, events, static /terminal
  web/terminal.html  xterm.js page (served; gets token via postMessage)
app/
  src/lib/store.ts     + terminal list, files/diff, ports, tools state+actions
  app/terminal.tsx     WebView host + key accessory row
  app/files.tsx        browser + file viewer + diff viewer
  app/preview.tsx      WebView on a discovered port + port picker
  app/tools.tsx        dev-tools list with start/stop
  (home gains an entry point to these — a compact action row or tab)
```

---

### Task 1: PTY gate + terminal manager (daemon)

**GATE FIRST:** try `npm i @lydell/node-pty` in `daemon/` (prebuilt ConPTY binaries, drop-in `node-pty` API). If it fails to install/load, try `node-pty`. If neither loads on this Node/Windows combo, **report BLOCKED immediately** with the exact error — do not silently substitute pipes; a pipe-based fake terminal is a different (worse) product and the controller must decide.

**Files:** Create `daemon/src/term.ts`, `daemon/test/term.test.ts`.

**Interfaces:**
```ts
export interface PtyDeps { pty: { spawn(file: string, args: string[], opts: object): IPty } }
export interface TermInfo { termId: string; title: string; cwd: string; cols: number; rows: number; }
export class PtyManager {
  constructor(deps: PtyDeps, onData: (termId: string, data: string) => void, onExit: (termId: string, code: number) => void);
  create(opts: { cwd: string; cols: number; rows: number; shell?: string }): TermInfo; // default shell: powershell.exe
  write(termId: string, data: string): void;
  resize(termId: string, cols: number, rows: number): void;
  kill(termId: string): void;
  list(): TermInfo[];
  scrollback(termId: string): string;   // last ~64KB, replayed on (re)attach
  killAll(): void;                       // daemon shutdown
}
```
- Scrollback is a bounded string buffer per terminal (append + trim to 64KB) — a terminal that runs for hours must not grow unbounded.
- `termId` from `randomUUID()`.
- Deps-injected pty so unit tests use a fake; one test may spawn a REAL pty running `cmd /c echo hello` (harmless, self-killed) to prove the binding works.

- [ ] Gate; TDD (fake pty: create→write forwards to pty, onData buffers into scrollback + fires callback, scrollback trims at cap, resize/kill forward, exit fires onExit and removes from list; one real-pty echo test). Commit.

### Task 2: Terminal RPCs + served xterm page (daemon)

**Files:** `daemon/src/protocol.ts` (+`term.*` methods, `term.data`/`term.exit` events on the `PushEvent` union alongside `MachineEvent`), `registry.ts` (+handlers), `index.ts` (wire PtyManager, killAll on exit), `server.ts` (serve `/terminal` + `/vendor/xterm.js` + `/vendor/xterm.css` from `@xterm/xterm` in node_modules), create `daemon/src/web/terminal.html`.

**RPCs:** `term.list` → `TermInfo[]`; `term.create {cwd, cols, rows}` → `TermInfo`; `term.write {termId, data}`; `term.resize {termId, cols, rows}`; `term.kill {termId}`; `term.scrollback {termId}` → `{data}`.
**Events:** `{kind:"term.data", termId, data}`, `{kind:"term.exit", termId, code}`.

**terminal.html:** dark, theme-matched, full-viewport xterm; on load posts `ready` to the RN WebView and waits for a `{token, host, port, termId?, cwd}` message; then opens `ws://host:port/ws`, auths, `term.scrollback` → write, subscribes to `term.data`; sends keystrokes via `term.write`; `FitAddon`-style resize → `term.resize` (hand-roll a simple fit if the addon is awkward). Also usable standalone from a desktop browser for debugging (falls back to `?dev=1` prompting for a token — but **never** accepts a token from the query string in the app path; the dev fallback may read `sessionStorage`, not the URL).

- [ ] TDD the RPCs (real server+registry, fake pty): create→list→write→scrollback→kill; `term.data` event pushed on pty output. Static routes return 200 + correct content-type. Commit.

### Task 3: Terminal screen (app)

**Files:** create `app/app/terminal.tsx`; `app/src/lib/store.ts` (+`terminals: TermInfo[]`, `refreshTerminals`, `createTerminal(cwd)`, `killTerminal(id)`); add `react-native-webview`.

- Terminal list (when >1) / direct open; "New terminal" picks a cwd (reuse the recents from `new.tsx`).
- WebView → `http://<host>:<port>/terminal`, `onLoad` → `postMessage({token, host, port, termId, cwd})`. `originWhitelist` limited to the daemon origin. No token in the URL.
- **Key accessory row** above the keyboard (the thing that makes a phone terminal usable): Esc, Tab, Ctrl (sticky modifier), ↑ ↓ ← →, `/`, `|`, `-`, and a Paste button. Each ≥48, horizontally scrollable, sends the right escape sequence via `injectJavaScript` → page → `term.write`.
- Offline/unauthorized: disable input, show the standard hints.
- [ ] Implement; `tsc` + tests green; commit. **Rendered gate:** terminal with real output + accessory row (screenshot), and the empty/new state.

### Task 4: Files, diffs, ports (daemon)

**Files:** create `daemon/src/files.ts`, `daemon/src/ports.ts`, tests; `protocol.ts`/`registry.ts` wiring.

```ts
// files.ts
export function allowedRoots(cfg: Config, sessionCwds: string[]): string[];
export function isUnderRoot(p: string, roots: string[]): boolean;   // resolve+normalize, case-insensitive on win32
export interface Entry { name: string; path: string; dir: boolean; size: number }
export function list(dir: string, roots: string[]): Entry[];         // throws "outside allowed roots"
export function read(file: string, roots: string[], maxBytes?: number): { text: string; truncated: boolean }; // default 256KB
export function gitStatus(cwd: string, roots: string[], exec): Promise<{ branch: string; files: {path: string; status: string}[] }>;
export function gitDiff(cwd: string, roots: string[], exec, file?: string): Promise<string>;  // unified diff text
// ports.ts
export interface Port { port: number; pid: number; process: string }
export function listeningPorts(exec): Promise<Port[]>;   // netstat -ano + tasklist/si mapping; localhost listeners only
```
- Traversal tests are the important ones: `..\..\..\Windows\System32\config\SAM`, absolute path outside roots, a symlink-ish trick, and a path that only *looks* like a root prefix (`C:\workroot-evil` vs root `C:\work`) must all be refused.
- `git` via injected exec; tests use a fake exec returning canned porcelain/diff output (no real repo needed), plus one real-git test against the repo itself (read-only `git status --porcelain`).

**RPCs:** `files.list {dir}`, `files.read {path}`, `files.roots`, `git.status {cwd}`, `git.diff {cwd, file?}`, `ports.list`.

- [ ] TDD (traversal refusals first); commit.

### Task 5: Files + diff screens (app)

**Files:** create `app/app/files.tsx` (browser + viewer), `app/src/components/DiffView.tsx`; store additions.

- Browser: root picker (from `files.roots`), breadcrumb, folder/file rows (mono names, size, lucide folder/file icons), tap folder → descend, tap file → viewer. Up/back handled by the breadcrumb + BackButton.
- Viewer: monospace text with line numbers; markdown files get a rendered toggle (raw ↔ rendered — a minimal renderer: headings, bold/italic, code fences, lists, links; no new dependency if a tiny hand-rolled renderer suffices, else `react-native-markdown-display`); truncation notice when >256KB.
- **DiffView**: parse unified diff → per-file sections, `+` accent-tinted / `-` danger-tinted / context muted, line numbers, collapsed context runs (>6 lines → "… N unchanged"), horizontal scroll per line (never clip code — the Plan-2 lesson). Entry: a "Changes" affordance on a session (uses that session's cwd) and from the files screen.
- [ ] Implement; tests for the diff parser (pure, real unified-diff fixtures incl. new file/deleted file/rename headers); commit. **Rendered gate:** browser, file viewer, markdown rendered, diff with adds/deletes.

### Task 6: Preview + dev-tools (daemon + app)

**Files:** create `daemon/src/tools.ts`, tests; app `app/app/preview.tsx`, `app/app/tools.tsx`.

```ts
// tools.ts — long-running dev services declared in <dataDir>/tools.json
export interface ToolSpec { name: string; command: string; args?: string[]; cwd?: string; port?: number }
export interface ToolStatus { name: string; running: boolean; pid?: number; port?: number }
export class ToolRunner {
  constructor(deps: { spawn: typeof import("child_process").spawn }, specs: ToolSpec[]);
  start(name: string): ToolStatus;   // idempotent
  stop(name: string): ToolStatus;    // kill process tree on win32 (taskkill /T /F)
  status(): ToolStatus[];
  stopAll(): void;
}
```
- `tools.json` ships with a documented example (Docker Desktop / `docker compose up -d` in a chosen folder / a Playwright headless server), but **defaults to empty** — the user opts in. Missing/invalid file → empty list + a logged warning, never a crash.
- RPCs: `tools.list`, `tools.start {name}`, `tools.stop {name}`; `ports.list` (Task 4) powers preview.
- App **preview.tsx**: port picker (from `ports.list`, showing `:5173 (node)`), WebView to `http://<host>:<port>`, reload + open-in-external buttons, back/forward. Mobile viewport by default (this is how you check your own site on a phone).
- App **tools.tsx**: rows per tool (name, status dot, port), Start/Stop buttons (≥48, confirm on stop), empty state explaining `tools.json` with the file path.
- [ ] TDD ToolRunner with fake spawn (start idempotent, stop builds `taskkill /pid <pid> /T /F` on win32, status reflects children, stopAll); commit. **Rendered gate:** preview on a real dev server, tools list (populated + empty).

### Task 7: Navigation + home integration

**Files:** `app/app/index.tsx` (+ entry points), possibly a small `app/src/components/ActionRow.tsx`.

- Home gains a compact, thumb-reachable way into the four new surfaces (Terminal, Files, Preview, Tools) without burying the session list — a single horizontal row of labeled icon buttons under the MachineBar is the lazy correct answer; the session list stays the hero.
- Session screen gains a "Changes" action opening the diff for that session's cwd.
- All new screens honor offline/unauthorized (disabled + the established hints).
- [ ] Implement; commit. **Rendered gate:** home with the action row (populated + offline).

### Task 8: Whole-journey design review + fixes

Controller-driven, same as Plan 2 Task 9: render every new screen and state at 390×844 (demo mode seeded with terminal output, file tree, a diff, ports, tools), dispatch a design reviewer against the Design System + Journey principles + the a11y checklist, fix findings, re-render until clean.

### Task 9: Real E2E + docs

- Real: run a terminal that executes `dir` and shows output; browse to a real folder and read a real file; `git diff` a real change in this repo; start a real dev server (the app's own `expo start --web`) and preview it from the app; a `tools.json` entry that starts something harmless (`node -e "http.createServer(...).listen(4321)"`) started and stopped from the phone UI. Screenshot each.
- Docs: README-phone.md gains Terminal / Files / Preview / Tools sections + the `tools.json` format and example.
- Both suites green; whole-plan review + fix pass.

## Self-Review (write-time)

- Spec coverage vs the design doc's Plan-4 slice: terminal ✅ files ✅ diffs ✅ markdown render ✅ preview ✅ dev-tools launcher (Docker/headless browser via generic specs) ✅ port discovery ✅. Deferred: file *editing* (read-only by design — the agents edit; the phone reviews), file upload/download, multi-root search.
- Risks named: node-pty native install (Task 1 gate, BLOCKED path defined), xterm-in-WebView token handoff (postMessage, no URL token), traversal guard (tests written first), PTY output volume over WS (bounded scrollback; separate socket from the app store).
- No placeholders; interfaces exact; types single-sourced in `protocol.ts` / re-exported via `shared/protocol.ts` where the app needs them.
