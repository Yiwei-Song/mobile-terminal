import { describe, it, expect } from "vitest";
import { snapshot, topProcesses, killProcess } from "../src/system.js";
import type { SystemDeps } from "../src/system.js";

// Canned si returning the shapes the real library produces (bytes for mem/fs,
// KB for memRss, 0-100 for currentLoad/cpu, seconds for uptime).
const GB = 1024 ** 3;
const fakeSi = (procs: { pid: number; name: string; cpu: number; memRss: number }[] = []) =>
  ({
    currentLoad: async () => ({ currentLoad: 24.26 }),
    mem: async () => ({ total: 64 * GB, used: 32 * GB }),
    fsSize: async () => [
      { mount: "C:", size: 100 * GB, used: 41.22 * GB, use: 41.22 },
      { mount: "D:", size: 200 * GB, used: 50 * GB, use: 25 },
    ],
    time: async () => ({ uptime: 289201.6 }),
    processes: async () => ({ list: procs }),
  }) as unknown as SystemDeps["si"];

describe("snapshot", () => {
  it("maps si output to Metrics with rounding and pct", async () => {
    const m = await snapshot({ si: fakeSi() });
    expect(m.cpuPct).toBe(24.3);
    expect(m.mem).toEqual({ usedGb: 32, totalGb: 64, pct: 50 });
    expect(m.disks).toEqual([
      { mount: "C:", usedGb: 41.2, totalGb: 100, pct: 41.2 },
      { mount: "D:", usedGb: 50, totalGb: 200, pct: 25 },
    ]);
    expect(m.uptimeSec).toBe(289202);
  });
});

describe("topProcesses", () => {
  const procs = [
    { pid: 1, name: "a", cpu: 5, memRss: 2048 },
    { pid: 2, name: "b", cpu: 90, memRss: 1024 },
    { pid: 3, name: "c", cpu: 40, memRss: 512 },
  ];

  it("sorts by cpu desc and maps memRss KB to MB", async () => {
    const p = await topProcesses({ si: fakeSi(procs) });
    expect(p.map((x) => x.pid)).toEqual([2, 3, 1]);
    expect(p[0]).toEqual({ pid: 2, name: "b", cpuPct: 90, memMb: 1 });
    expect(p[2].memMb).toBe(2); // 2048 KB
  });

  it("caps at n", async () => {
    const p = await topProcesses({ si: fakeSi(procs) }, 2);
    expect(p.map((x) => x.pid)).toEqual([2, 3]);
  });
});

describe("killProcess", () => {
  it("refuses pid <= 0 without calling kill", async () => {
    expect(await killProcess(-1)).toEqual({ ok: false, error: "refused" });
    expect(await killProcess(0)).toEqual({ ok: false, error: "refused" });
  });

  it("refuses the daemon's own pid", async () => {
    expect(await killProcess(process.pid)).toEqual({ ok: false, error: "refused" });
  });

  it("maps a nonexistent-pid kill to {ok:false}", async () => {
    // A pid that (essentially) never exists -> ESRCH, wrapped not thrown.
    const r = await killProcess(2 ** 30);
    expect(r.ok).toBe(false);
    expect(r.error).toBeTruthy();
  });
});
