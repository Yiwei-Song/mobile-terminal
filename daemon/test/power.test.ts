import { describe, it, expect, vi } from "vitest";
import { KeepAwake, lockWorkstation, displayOff, reboot, abortReboot } from "../src/power.js";
import type { PowerDeps } from "../src/power.js";

// Fake spawn: never launches anything — records argv and hands back a fake child
// with just the kill()/on()/pid surface KeepAwake touches. `on("exit")` handlers
// are stored so a test can simulate the child dying on its own.
function fakeSpawn() {
  const calls: { cmd: string; args: string[] }[] = [];
  let exitHandler: ((code: number) => void) | null = null;
  let errorHandler: ((err: unknown) => void) | null = null;
  const child = {
    pid: 4242,
    kill: vi.fn(),
    on: (ev: string, cb: (arg: never) => void) => {
      if (ev === "exit") exitHandler = cb as (code: number) => void;
      if (ev === "error") errorHandler = cb as (err: unknown) => void;
      return child;
    },
  };
  const spawn = ((cmd: string, args: string[]) => {
    calls.push({ cmd, args });
    return child;
  }) as unknown as PowerDeps["spawn"];
  return {
    spawn,
    calls,
    child,
    fireExit: (code = 0) => exitHandler?.(code),
    fireError: (err: unknown) => errorHandler?.(err),
  };
}

// Fake exec: never runs a shell — records the command string and invokes the
// callback with a caller-supplied error (default: success).
function fakeExec(err: unknown = null) {
  const cmds: string[] = [];
  const exec = ((cmd: string, cb: (e: unknown) => void) => {
    cmds.push(cmd);
    cb(err);
    return {} as unknown;
  }) as unknown as PowerDeps["exec"];
  return { exec, cmds };
}

const depsWith = (over: Partial<PowerDeps>): PowerDeps =>
  ({ spawn: fakeSpawn().spawn, exec: fakeExec().exec, ...over });

describe("KeepAwake", () => {
  it("start builds the SetThreadExecutionState PS with system flag, no display", () => {
    const s = fakeSpawn();
    const ka = new KeepAwake(depsWith({ spawn: s.spawn }));
    ka.start();
    expect(s.calls).toHaveLength(1);
    expect(s.calls[0].cmd).toBe("powershell");
    const script = s.calls[0].args.join(" ");
    expect(script).toContain("SetThreadExecutionState");
    // ES_CONTINUOUS(0x80000000)|ES_SYSTEM_REQUIRED(0x1) = 2147483649
    expect(script).toContain("(2147483649)");
    expect(ka.active).toBe(true);
  });

  it("display mask differs from the no-display mask", () => {
    const noDisp = fakeSpawn();
    const disp = fakeSpawn();
    new KeepAwake(depsWith({ spawn: noDisp.spawn })).start(false);
    new KeepAwake(depsWith({ spawn: disp.spawn })).start(true);
    const a = noDisp.calls[0].args.join(" ");
    const b = disp.calls[0].args.join(" ");
    expect(a).not.toEqual(b);
    // +ES_DISPLAY_REQUIRED(0x2) = 2147483651
    expect(b).toContain("(2147483651)");
  });

  it("start is idempotent — no second child while active", () => {
    const s = fakeSpawn();
    const ka = new KeepAwake(depsWith({ spawn: s.spawn }));
    ka.start();
    ka.start();
    expect(s.calls).toHaveLength(1);
  });

  it("stop kills the child and flips active", () => {
    const s = fakeSpawn();
    const ka = new KeepAwake(depsWith({ spawn: s.spawn }));
    ka.start();
    ka.stop();
    expect(s.child.kill).toHaveBeenCalledOnce();
    expect(ka.active).toBe(false);
  });

  it("clears its ref when the child exits on its own", () => {
    const s = fakeSpawn();
    const ka = new KeepAwake(depsWith({ spawn: s.spawn }));
    ka.start();
    s.fireExit();
    expect(ka.active).toBe(false);
    ka.start(); // can respawn after a self-exit
    expect(s.calls).toHaveLength(2);
  });
});

describe("displayOff spawns powershell with an intact args array", () => {
  it("passes the P/Invoke script with inner \"user32.dll\" quotes preserved", async () => {
    const s = fakeSpawn();
    const p = displayOff(depsWith({ spawn: s.spawn }));
    s.fireExit(0); // child exits cleanly -> resolve
    await expect(p).resolves.toBeUndefined();

    expect(s.calls).toHaveLength(1);
    expect(s.calls[0].cmd).toBe("powershell");
    // Exact arg array — a quoting regression (collapsed inner quotes, a single
    // fused cmd string, wrong flags) fails here instead of slipping through.
    expect(s.calls[0].args).toEqual([
      "-NoProfile",
      "-Command",
      'Add-Type -Name D -Namespace W -MemberDefinition \'[DllImport("user32.dll")] public static extern bool PostMessage(int h, int m, int w, int l);\'; ' +
        "[W.D]::PostMessage(65535, 274, 61808, 2)",
    ]);
    // Belt-and-suspenders: the inner quotes really are literal double-quotes.
    expect(s.calls[0].args[2]).toContain('[DllImport("user32.dll")]');
  });

  it("rejects when the child exits nonzero", async () => {
    const s = fakeSpawn();
    const p = displayOff(depsWith({ spawn: s.spawn }));
    s.fireExit(1);
    await expect(p).rejects.toThrow(/exited 1/);
  });

  it("rejects when the child errors (spawn failure)", async () => {
    const s = fakeSpawn();
    const p = displayOff(depsWith({ spawn: s.spawn }));
    s.fireError(new Error("ENOENT"));
    await expect(p).rejects.toThrow(/ENOENT/);
  });
});

describe("exec-based commands build the exact command line", () => {
  it("lockWorkstation", async () => {
    const e = fakeExec();
    await lockWorkstation(depsWith({ exec: e.exec }));
    expect(e.cmds).toEqual(["rundll32.exe user32.dll,LockWorkStation"]);
  });

  it("reboot passes the delay and message", async () => {
    const e = fakeExec();
    await reboot(depsWith({ exec: e.exec }), 30);
    expect(e.cmds).toEqual(['shutdown /r /t 30 /c "Workbench remote reboot"']);
  });

  it("abortReboot issues shutdown /a", async () => {
    const e = fakeExec();
    await abortReboot(depsWith({ exec: e.exec }));
    expect(e.cmds).toEqual(["shutdown /a"]);
  });
});

describe("abortReboot error handling", () => {
  it("swallows the no-shutdown-in-progress error (exit 1116)", async () => {
    const e = fakeExec(Object.assign(new Error("exit 1116"), { code: 1116 }));
    await expect(abortReboot(depsWith({ exec: e.exec }))).resolves.toBeUndefined();
  });

  it("swallows when stderr says no shutdown was in progress", async () => {
    const e = fakeExec(Object.assign(new Error("cmd failed"), {
      stderr: "Unable to abort... No shutdown was in progress.",
    }));
    await expect(abortReboot(depsWith({ exec: e.exec }))).resolves.toBeUndefined();
  });

  it("still rejects on a genuine failure", async () => {
    const e = fakeExec(Object.assign(new Error("access denied"), { code: 5 }));
    await expect(abortReboot(depsWith({ exec: e.exec }))).rejects.toThrow(/access denied/);
  });
});
