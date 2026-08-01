// Real-hardware smoke for src/system.ts: runs snapshot/topProcesses against the
// REAL `systeminformation` (read-only) and proves killProcess works against a
// THROWAWAY process we spawned ourselves — never a real app, never the daemon.
// Deliberately NOT part of `npm test` (touches real hardware + spawns a child):
//
//   npm run sysmoke
//
// Exit 0 and "SYSMOKE PASS" = the mapping is sane on this machine and kill kills.
import assert from "node:assert";
import { spawn } from "node:child_process";
import * as si from "systeminformation";
import { snapshot, topProcesses, killProcess } from "../src/system.js";

const finite = (n: number, label: string): number => {
  assert.ok(Number.isFinite(n) && !Number.isNaN(n), `${label} is not a finite number: ${n}`);
  return n;
};

// --- 1. Metrics against real si (read-only) ---
const m = await snapshot({ si });
console.log("Metrics (real systeminformation):");
console.log(`  cpuPct     ${finite(m.cpuPct, "cpuPct")}%`);
console.log(`  mem        ${finite(m.mem.usedGb, "mem.usedGb")} / ${finite(m.mem.totalGb, "mem.totalGb")} GB  (${finite(m.mem.pct, "mem.pct")}%)`);
for (const d of m.disks)
  console.log(`  disk ${d.mount.padEnd(6)} ${finite(d.usedGb, "disk.usedGb")} / ${finite(d.totalGb, "disk.totalGb")} GB  (${finite(d.pct, "disk.pct")}%)`);
console.log(`  uptimeSec  ${finite(m.uptimeSec, "uptimeSec")}`);

// Sanity ranges: not just finite, but physically plausible.
assert.ok(m.cpuPct >= 0 && m.cpuPct <= 100, `cpuPct out of range: ${m.cpuPct}`);
assert.ok(m.mem.totalGb > 0, `total RAM should be > 0, got ${m.mem.totalGb}`);
assert.ok(m.mem.usedGb > 0 && m.mem.usedGb <= m.mem.totalGb, `used RAM implausible: ${m.mem.usedGb}/${m.mem.totalGb}`);
assert.ok(m.uptimeSec > 0, `uptime should be > 0, got ${m.uptimeSec}`);
assert.ok(m.disks.length > 0, "expected at least one disk");

const procs = await topProcesses({ si }, 5);
console.log("\nTop 5 processes by CPU:");
for (const p of procs)
  console.log(`  pid ${String(p.pid).padStart(7)}  cpu ${finite(p.cpuPct, "proc.cpuPct").toFixed(1).padStart(6)}%  mem ${finite(p.memMb, "proc.memMb").toFixed(1).padStart(8)}MB  ${p.name}`);
assert.ok(procs.length > 0, "expected at least one process");
// pid 0 ("System Idle Process") and pid 4 ("System") are real Windows kernel
// rows, so >= 0, not > 0.
for (const p of procs) assert.ok(p.pid >= 0 && typeof p.name === "string" && p.name.length > 0, `bad proc row: ${JSON.stringify(p)}`);
// sorted by cpu desc
for (let i = 1; i < procs.length; i++) assert.ok(procs[i - 1].cpuPct >= procs[i].cpuPct, "processes not sorted by cpu desc");

// --- 2. Kill a THROWAWAY process (never a real app) ---
console.log("\nKill test (throwaway process only):");
const alive = (p: number): boolean => {
  try {
    process.kill(p, 0); // signal 0 = existence probe, doesn't actually signal
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code !== "ESRCH";
  }
};
const victim = spawn(process.execPath, ["-e", "setInterval(()=>{}, 1e9)"], { stdio: "ignore" });
// try/finally: if any assert between spawn and killProcess throws, we still kill
// the victim instead of leaking it. killProcess kills it on the happy path; the
// finally kill() is then a harmless no-op on an already-dead pid.
try {
  await new Promise<void>((r, rej) => {
    victim.once("spawn", () => r());
    victim.once("error", rej);
  });
  const pid = victim.pid!;
  console.log(`  spawned throwaway pid ${pid}`);
  assert.ok(pid > 0 && pid !== process.pid, "sanity: throwaway must have a real pid distinct from us");

  assert.ok(alive(pid), "throwaway should be alive before we kill it");

  const res = await killProcess(pid);
  console.log(`  killProcess(${pid}) -> ${JSON.stringify(res)}`);
  assert.deepStrictEqual(res, { ok: true }, `killProcess should report ok, got ${JSON.stringify(res)}`);

  // The OS reaps asynchronously; poll briefly for it to actually go.
  let gone = false;
  for (let i = 0; i < 40 && !gone; i++) {
    if (!alive(pid)) gone = true;
    else await new Promise((r) => setTimeout(r, 50));
  }
  assert.ok(gone, `throwaway pid ${pid} still alive after killProcess — kill did not kill`);
  console.log(`  confirmed pid ${pid} is gone (process.kill(pid,0) -> ESRCH)`);
} finally {
  victim.kill();
}

// --- Guard still works live: refuses to kill the daemon (self) ---
const self = await killProcess(process.pid);
console.log(`  killProcess(self=${process.pid}) -> ${JSON.stringify(self)}`);
assert.deepStrictEqual(self, { ok: false, error: "refused" }, "guard must refuse killing self");
assert.ok(alive(process.pid), "we must still be alive (obviously) after the refused self-kill");

console.log("\nSYSMOKE PASS");
