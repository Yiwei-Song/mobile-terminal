// Machine metrics for the mobile System screen. `systeminformation` is injected
// (deps.si) so unit tests use a fake and never touch real hardware.
export interface Metrics {
  cpuPct: number; // 0-100 overall
  mem: { usedGb: number; totalGb: number; pct: number };
  disks: { mount: string; usedGb: number; totalGb: number; pct: number }[];
  uptimeSec: number;
}
export interface Proc {
  pid: number;
  name: string;
  cpuPct: number;
  memMb: number;
}
export interface SystemDeps {
  si: typeof import("systeminformation");
}

const GB = 1024 ** 3;
const gb = (bytes: number): number => Math.round((bytes / GB) * 10) / 10;
const pct = (used: number, total: number): number =>
  total > 0 ? Math.round((used / total) * 1000) / 10 : 0;

export async function snapshot(deps: SystemDeps): Promise<Metrics> {
  const { si } = deps;
  const [load, mem, disks, time] = await Promise.all([
    si.currentLoad(),
    si.mem(),
    si.fsSize(),
    si.time(),
  ]);
  return {
    cpuPct: Math.round(load.currentLoad * 10) / 10,
    mem: { usedGb: gb(mem.used), totalGb: gb(mem.total), pct: pct(mem.used, mem.total) },
    disks: disks.map((d) => ({
      mount: d.mount,
      usedGb: gb(d.used),
      totalGb: gb(d.size),
      // si already computes `use` as a percentage; fall back if it's missing.
      pct: typeof d.use === "number" ? Math.round(d.use * 10) / 10 : pct(d.used, d.size),
    })),
    uptimeSec: Math.round(time.uptime),
  };
}

export async function topProcesses(deps: SystemDeps, n = 15): Promise<Proc[]> {
  const { list } = await deps.si.processes();
  return list
    .map((p) => ({ pid: p.pid, name: p.name, cpuPct: p.cpu, memMb: Math.round((p.memRss / 1024) * 10) / 10 }))
    .sort((a, b) => b.cpuPct - a.cpuPct)
    .slice(0, n);
}

export async function killProcess(pid: number): Promise<{ ok: boolean; error?: string }> {
  // Guard before touching process.kill: a non-positive pid targets a process
  // group (or self on 0), and killing our own pid takes the daemon down.
  if (pid <= 0 || pid === process.pid) return { ok: false, error: "refused" };
  try {
    process.kill(pid);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as NodeJS.ErrnoException).code ?? String(e) };
  }
}
