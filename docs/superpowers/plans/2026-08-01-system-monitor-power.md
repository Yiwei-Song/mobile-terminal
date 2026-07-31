# System Monitor + Power Control (Plan 5 of 6) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development, task-by-task. Checkbox steps.

**Goal:** The "keep my machine healthy while I'm away" half of the product: a mobile System screen (live CPU/RAM/disk, process list, kill), and power control — keep-awake, privacy screen-lock, remote reboot with auto-resume of sessions — plus the boot-resume + manifest-recovery hardening the earlier reviews flagged.

**Architecture:** New daemon modules (`system.ts` metrics/kill, `power.ts` keep-awake/lock/reboot) exposed through the existing WS RPC seam (`registry.handle`) and protocol. Windows power actions use **no native FFI**: `systeminformation` for metrics, and built-in Windows executables (`rundll32 user32.dll,LockWorkStation`, `shutdown /r`, a persistent PowerShell `SetThreadExecutionState` P/Invoke for keep-awake) via `child_process`. App gets a System screen + reboot confirm, reachable from the MachineBar.

**Tech Stack:** daemon: Node/TS, `systeminformation` (one new dep), `node:child_process`. app: existing Expo/RN stack + a small time-series sparkline (hand-rolled SVG via react-native-svg, already installed — no chart lib).

## Global Constraints

- Daemon at `daemon/`, app at `app/`. Both suites green before every commit (`cd daemon && npm test`, `cd app && npm test`). TS strict, ESM.
- **NEVER actually reboot or lock the developer's machine in a test or verification.** Reboot tests assert command *construction* and the abort path (`shutdown /a`); boot-resume is verified by restarting the daemon *process*, never the OS. Any manual power verification uses `shutdown /r /t 90` immediately followed by `shutdown /a`, or a throwaway VM — documented, not executed against the user's box without a countdown they can abort.
- Power actions are **destructive/irreversible controls** → every one requires explicit on-phone confirmation (type-to-confirm for reboot, single confirm for lock/kill). No auto-approve.
- Design: tokens only (app/src/theme.ts), touch ≥48, dark, mobile-first, no emoji icons (lucide). Status/among power actions: reboot = danger, lock = warn/neutral, keep-awake = info toggle.
- Windows 11 Pro target. Keep-awake held whenever the daemon runs (Plan 1 decision — display may sleep, system may not), with an eco toggle.
- Auto-logon + instant-lock (user-approved reboot tradeoff) is a **documented manual setup step**, not daemon-automated. The daemon's role is: lock as its first act at startup, and re-attach sessions.
- Commit trailer: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

## File Structure

```
daemon/src/
  system.ts        metrics snapshot + top processes + kill (systeminformation)
  power.ts         KeepAwake (persistent PS SetThreadExecutionState), lock, reboot/abort
  boot.ts          boot-resume orchestration (called from index.ts)
  sessions/manifest.ts   + recovery (rename-aside on corrupt parse) [carried Plan-1/5 item]
  protocol.ts / registry.ts / index.ts   + new RPCs & wiring
  scripts/install-startup.ps1   Task Scheduler + auto-logon setup (documented, run by USER)
app/
  src/lib/store.ts       + system state (metrics, processes), power actions
  src/components/Sparkline.tsx   tiny SVG time-series
  src/components/MeterRow.tsx     labeled bar (CPU/RAM/disk)
  app/system.tsx          System screen (metrics, processes+kill, power controls)
  (MachineBar gains a tap target → /system)
README-phone.md          + auto-logon/reboot setup section
```

---

### Task 1: Manifest corruption recovery (carried finding)

**Files:** `daemon/src/sessions/manifest.ts`, `daemon/test/manifest.test.ts`

Carried from Plan-1 final review: a torn/hand-edited `sessions.json` makes the constructor's `JSON.parse` throw → daemon won't start (bricks reboot-resume, the very thing this plan builds on).

- [ ] Step 1 (TDD): test — write `sessions.json` = `"{bad json"`, construct `Manifest` → does NOT throw, `list()` is `[]`, and a `sessions.json.corrupt-<sortable>` sibling exists (renamed aside). Also: valid file still loads.
- [ ] Step 2: wrap the load in try/catch; on parse failure `renameSync` the bad file to `${file}.corrupt` (overwrite if exists) and start empty. Use a fixed `.corrupt` suffix (no Date — clock ban); overwrite is fine.
- [ ] Step 3: suite green; commit.

### Task 2: System metrics + process control (daemon)

**Files:** Create `daemon/src/system.ts`, `daemon/test/system.test.ts`. Modify `daemon/package.json` (+`systeminformation`).

**Interfaces (produce):**
```ts
export interface Metrics {
  cpuPct: number;                       // 0-100 overall
  mem: { usedGb: number; totalGb: number; pct: number };
  disks: { mount: string; usedGb: number; totalGb: number; pct: number }[];
  uptimeSec: number;
}
export interface Proc { pid: number; name: string; cpuPct: number; memMb: number; }
export interface SystemDeps { si: typeof import("systeminformation"); }
export async function snapshot(deps: SystemDeps): Promise<Metrics>;
export async function topProcesses(deps: SystemDeps, n?: number): Promise<Proc[]>; // by cpu, default 15
export async function killProcess(pid: number): Promise<{ ok: boolean; error?: string }>; // process.kill, guard pid>0 and not self
```
- `systeminformation` is injected (`deps.si`) so tests use a fake — no real hardware reads in unit tests.
- `killProcess` refuses `pid <= 0` and `pid === process.pid` (never kill the daemon); real `process.kill(pid)` wrapped in try/catch → `{ok:false,error}` on ESRCH/EPERM.

- [ ] TDD: fake `si` returning canned `currentLoad`/`mem`/`fsSize`/`processes`; assert `snapshot` maps to `Metrics` (GB rounding, pct), `topProcesses` sorts by cpu desc and caps at n; `killProcess(-1)` and `killProcess(process.pid)` refuse without calling kill; a fake-pid kill error maps to `{ok:false}`. Commit.

### Task 3: Power control (daemon)

**Files:** Create `daemon/src/power.ts`, `daemon/test/power.test.ts`.

**Interfaces (produce):**
```ts
export interface PowerDeps { spawn: typeof import("child_process").spawn; exec: typeof import("child_process").exec; }
export class KeepAwake {                 // persistent PowerShell holding SetThreadExecutionState
  constructor(deps: PowerDeps);
  start(displayToo?: boolean): void;     // idempotent; ES_CONTINUOUS|ES_SYSTEM_REQUIRED (+ES_DISPLAY_REQUIRED)
  stop(): void;                          // kills the PS child → flags clear, system may sleep
  get active(): boolean;
}
export function lockWorkstation(deps: PowerDeps): Promise<void>;   // rundll32 user32.dll,LockWorkStation
export function displayOff(deps: PowerDeps): Promise<void>;         // PS SendMessage WM_SYSCOMMAND SC_MONITORPOWER 2
export function reboot(deps: PowerDeps, delaySec: number): Promise<void>;  // shutdown /r /t <n> /c "Workbench remote reboot"
export function abortReboot(deps: PowerDeps): Promise<void>;        // shutdown /a  (ignore "no shutdown in progress" error)
```
Implementation notes:
- KeepAwake spawns `powershell -NoProfile -Command <p/invoke script that calls SetThreadExecutionState then waits on stdin>`; keeping the process alive holds the flag; killing it releases (ES_CONTINUOUS is per-thread, dies with the process — exactly what we want). The exact PS: `Add-Type` a `SetThreadExecutionState` signature, call with the flag mask, then `while($true){Start-Sleep 3600}` (or read-host loop). Comment the flag values.
- `spawn`/`exec` injected so tests assert the **command line built** (never spawn a real shell). Reboot test: `reboot(deps, 30)` calls exec with `shutdown /r /t 30 ...`; `abortReboot` calls `shutdown /a` and swallows exit code 1116 ("no shutdown in progress").
- `// ponytail:` note KeepAwake is a single PS child, not a pool.

- [ ] TDD with a fake spawn/exec capturing argv: KeepAwake.start builds the SetThreadExecutionState PS and start is idempotent (second call no second child); stop kills it and `active` flips; lockWorkstation/displayOff/reboot/abortReboot build the exact expected command; abortReboot swallows the no-shutdown error. Commit.

### Task 4: New RPCs + wiring + boot-resume (daemon)

**Files:** `daemon/src/protocol.ts` (+methods/types), `daemon/src/registry.ts` or a small power/system handler composed in `index.ts`, `daemon/src/index.ts`, create `daemon/src/boot.ts`, tests.

**New RPCs** (add to METHODS + params validation + ClientMsg union + handler):
- `system.metrics` → `Metrics`
- `system.processes` → `Proc[]`
- `system.kill` `{pid}` → `{ok, error?}`
- `power.state` → `{ keepAwake: boolean, ecoMode: boolean }`
- `power.keepAwake` `{on: boolean}` → new state (on=hold always; off=eco, release when no running session — for this plan: off just stops the hold; the session-aware eco can be a follow-up, keep it simple: on/off manual hold)
- `power.lock` → locks + display off, `{ok}`
- `power.reboot` `{delaySec}` (clamp 5..120) → `{ok}` (schedules; pushes a `session`-style event? add a `machine.reboot` event so the app can show a countdown) 
- `power.abortReboot` → `{ok}`

**boot.ts:** `runBootResume(manifest, registry, { lock })` — (1) if configured, lock workstation (privacy-by-default at startup); (2) call `manifest.normalizeAfterRestart()` (exists from Plan 1) so stale running→idle; (3) for each manifest entry, ensure it's resumable (no work auto-continues — Plan 1 decision; sessions come back idle/attached, user taps to continue); (4) fire an ntfy "Machine back online — N sessions restored". Wire into `index.ts` startup (after Manifest, before/around Registry). KeepAwake.start() also called at startup (held whenever daemon runs).

- [ ] TDD: RPC round-trips through real server+registry with fake system/power deps (metrics/processes/kill/power.state/keepAwake/lock/reboot/abort return expected shapes; reboot clamps delay; kill refuses self). boot.ts: seed manifest with running+idle+dead, run boot-resume, assert normalizeAfterRestart applied (running→idle, dead stays) and lock called. Commit.

### Task 5: Startup install script + README (daemon, documented not executed)

**Files:** Create `daemon/scripts/install-startup.ps1`, update `README-phone.md`.

- `install-startup.ps1`: registers a Task Scheduler job running the daemon at user logon (`schtasks /create /tn WorkbenchDaemon /tr "node <path>\dist\index.js" /sc onlogon /rl highest`), prints next-steps for **auto-logon** (netplwiz / `Set-ItemProperty` AutoAdminLogon+DefaultUserName/Password under Winlogon — WARN about the plaintext-password + BitLocker-mitigation tradeoff the user already accepted), and how the daemon locks on start. The script only sets up the scheduled task automatically; it PRINTS (does not silently apply) the auto-logon registry changes, since they store a password — user runs that part deliberately.
- README-phone.md: new "Remote reboot & always-on" section — what auto-logon does, the security tradeoff (BitLocker strongly recommended), how to enable, how reboot-from-phone behaves (reboots → auto-login → locked → daemon restores sessions idle → you tap to continue).
- [ ] No test (scripts/docs). Lint the PS mentally for correctness; commit.

### Task 6: App store + Sparkline/MeterRow components

**Files:** `app/src/lib/store.ts` (+system state/actions), create `app/src/components/Sparkline.tsx`, `app/src/components/MeterRow.tsx`, `app/test/system.test.ts`.

- store: `metrics: Metrics | null`, `processes: Proc[]`, actions `refreshMetrics()` (system.metrics + system.processes), `killProcess(pid)`, `powerState`, `setKeepAwake(on)`, `lockMachine()`, `rebootMachine(delaySec)`, `abortReboot()`. Poll metrics only while the System screen is focused (screen drives an interval calling refreshMetrics every ~3s — not a store-owned timer).
- `Sparkline.tsx`: takes `number[]` (0-100), renders a small SVG polyline in accent, bg track — tokens only, no chart lib. Pure; unit-test the point-mapping (values → SVG path/points) at a fixed size.
- `MeterRow.tsx`: label + value + horizontal bar (pct → width%), color thresholds (green <70, amber <90, red ≥90) — never color-only (numeric % always shown).
- [ ] TDD the pure bits (sparkline point mapping, meter color threshold fn). `cd app && npm test` green. Commit.

### Task 7: System screen (app)

**Files:** Create `app/app/system.tsx`, wire MachineBar → /system, demo seeding for system data.

**Layout:** BackButton + "System" title + machine name. Live section: three MeterRows (CPU/RAM/disk) with a CPU Sparkline (last ~20 samples), uptime. Processes: list (name, pid mono, cpu%, mem) sorted by cpu, each with a kill affordance (trash icon → confirm sheet showing the process name → system.kill). Power controls (bottom, thumb-reachable, clearly grouped and visually weighted as serious): Keep-awake toggle (info) with state; "Lock screen, keep working" button (locks + display off, one confirm); **Reboot** (danger, type-to-confirm "REBOOT", shows count of running sessions that will be interrupted, then countdown with an Abort button while `machine.reboot` pending). Offline → screen shows last-known + disabled controls (can't reboot a PC you can't reach).
- demo.ts: seed metrics/processes when EXPO_PUBLIC_DEMO=1 so the screen renders for the gate.
- MachineBar (home) gets a tap → /system (the hostname/health strip becomes the entry point).
- [ ] Implement; `tsc` + tests green; commit. **Rendered gate:** system screen populated (metrics + processes), reboot confirm (type-to-confirm), reboot countdown+abort, offline-disabled. Save `.superpowers/sdd/task-7-system-*.png` (390×844, demo).

### Task 8: Real verification + safety + review fixes

- Daemon real metrics smoke: a `npm run sysmoke` (or extend e2e) that calls `snapshot`/`topProcesses` against REAL `systeminformation` once and prints — proves the mapping works on the actual machine (read-only, safe). Kill: verify against a throwaway spawned process (spawn `node -e "setInterval(()=>{},1e9)"`, kill it by pid, assert it dies) — NEVER a real app.
- Power: verify KeepAwake actually holds — start it, `powercfg /requests` shows an EXECUTION request, stop it, request clears (documented commands; run read-only `powercfg /requests` to confirm). Lock/reboot: **do NOT execute** against the dev machine; assert command construction only (Task 3 covers). If a live reboot proof is wanted, document the `shutdown /r /t 90` + phone-Abort procedure for the user to run deliberately.
- App real: against the live daemon (no demo), open /system, confirm real CPU/RAM/processes stream, toggle keep-awake and confirm via `powercfg /requests`, and screenshot. Do NOT tap reboot.
- Whole-plan review + fix pass.

## Self-Review (write-time)

- Spec coverage: system monitor ✅ kill ✅ keep-awake ✅ privacy-lock ✅ remote reboot + auto-resume ✅ boot-resume ✅ manifest recovery ✅ (carried). Deferred: session-aware eco keep-awake (manual on/off only here), wake-on-LAN (Plan 6/never — needs 2nd device), interactive GUI (out of product scope).
- Safety: destructive-action confirmations + the hard "never reboot the dev box in a test" constraint are stated in Global Constraints and Tasks 3/8. No `Date.now()` in daemon (`.corrupt` fixed suffix).
- Placeholder scan: none. Types single-sourced (Metrics/Proc in system.ts, re-exported via shared/ if the app needs them — Task 6 imports from a shared path or duplicates the 2 interfaces; prefer adding them to shared/protocol.ts alongside the RPCs so app+daemon agree).
