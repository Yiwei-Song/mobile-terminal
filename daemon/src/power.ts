// Power control for the workbench host: keep-awake, lock, display-off, reboot.
// child_process spawn/exec are injected so unit tests capture the command line
// without ever spawning a real shell (these commands lock/reboot the machine).
import type { spawn as Spawn, exec as Exec, ChildProcess } from "child_process";

export interface PowerDeps {
  spawn: typeof Spawn;
  exec: typeof Exec;
}

// SetThreadExecutionState flags (winbase.h). The flag is per-thread and dies
// with the process, so holding a child alive holds the flag; killing it clears.
const ES_CONTINUOUS = 0x80000000; // keep the state until the next call / thread exit
const ES_SYSTEM_REQUIRED = 0x00000001; // system stays awake (no sleep)
const ES_DISPLAY_REQUIRED = 0x00000002; // display stays on too

// PowerShell that P/Invokes SetThreadExecutionState(mask) then blocks forever.
// While this child lives the flag holds; killing it lets the thread exit and
// the flag clears (ES_CONTINUOUS is not sticky past the process).
const keepAwakeScript = (mask: number): string =>
  `Add-Type -Name P -Namespace W -MemberDefinition '[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint e);'; ` +
  `[W.P]::SetThreadExecutionState(${mask >>> 0}); ` +
  `while($true){Start-Sleep -Seconds 3600}`;

// ponytail: a single PS child, not a pool — one host, one keep-awake flag.
export class KeepAwake {
  private child: ChildProcess | null = null;
  constructor(private readonly deps: PowerDeps) {}

  start(displayToo = false): void {
    if (this.child) return; // idempotent: already holding the flag
    const mask =
      ES_CONTINUOUS | ES_SYSTEM_REQUIRED | (displayToo ? ES_DISPLAY_REQUIRED : 0);
    this.child = this.deps.spawn(
      "powershell",
      ["-NoProfile", "-Command", keepAwakeScript(mask)],
      { windowsHide: true },
    );
    // If the child dies on its own (crash, killed elsewhere), drop the ref so
    // `active` is honest and a later start() can respawn.
    this.child.on("exit", () => {
      this.child = null;
    });
  }

  stop(): void {
    this.child?.kill();
    this.child = null;
  }

  get active(): boolean {
    return this.child !== null;
  }
}

// Promise wrapper over injected exec: resolve on success, reject on error.
const run = (deps: PowerDeps, cmd: string): Promise<void> =>
  new Promise((resolve, reject) => {
    deps.exec(cmd, (err) => (err ? reject(err) : resolve()));
  });

export function lockWorkstation(deps: PowerDeps): Promise<void> {
  return run(deps, "rundll32.exe user32.dll,LockWorkStation");
}

// P/Invoke script for a monitor-power-off broadcast:
//   PostMessage(HWND_BROADCAST, WM_SYSCOMMAND, SC_MONITORPOWER, 2)
// PostMessage (not SendMessage) so an unresponsive top-level window can't stall
// the broadcast — this is fire-and-forget, we don't need the return value.
export const displayOffScript = ((): string => {
  const HWND_BROADCAST = 0xffff;
  const WM_SYSCOMMAND = 0x0112;
  const SC_MONITORPOWER = 0xf170;
  const MONITOR_OFF = 2; // 2=off, 1=low power, -1=on
  return (
    `Add-Type -Name D -Namespace W -MemberDefinition '[DllImport("user32.dll")] public static extern bool PostMessage(int h, int m, int w, int l);'; ` +
    `[W.D]::PostMessage(${HWND_BROADCAST}, ${WM_SYSCOMMAND}, ${SC_MONITORPOWER}, ${MONITOR_OFF})`
  );
})();

export function displayOff(deps: PowerDeps): Promise<void> {
  // spawn with an args ARRAY (like KeepAwake): Node quotes each arg, so the
  // inner "user32.dll" quotes survive intact. Building one cmd string + exec
  // collides the nested quotes under cmd.exe and Add-Type throws.
  return new Promise((resolve, reject) => {
    const child = deps.spawn(
      "powershell",
      ["-NoProfile", "-Command", displayOffScript],
      { windowsHide: true },
    );
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`displayOff exited ${code}`)),
    );
    child.on("error", reject);
  });
}

export function reboot(deps: PowerDeps, delaySec: number): Promise<void> {
  return run(deps, `shutdown /r /t ${delaySec} /c "Workbench remote reboot"`);
}

export function abortReboot(deps: PowerDeps): Promise<void> {
  // `shutdown /a` fails (exit 1116) when nothing is scheduled — that's a no-op
  // success for us, not an error, so swallow that specific case.
  return run(deps, "shutdown /a").catch((err: { code?: string | number; message?: string; stderr?: string }) => {
    const msg = String(err.stderr ?? err.message ?? "");
    if (err.code === 1116 || /no shutdown was in progress/i.test(msg)) return;
    throw err;
  });
}
