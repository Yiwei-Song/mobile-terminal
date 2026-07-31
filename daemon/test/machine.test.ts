import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import { loadConfig } from "../src/config.js";
import { startServer } from "../src/server.js";
import { Manifest } from "../src/sessions/manifest.js";
import { Registry, clampRebootDelay } from "../src/sessions/registry.js";
import { fakeMachine } from "./fixtures.js";

// system.*/power.* over the real wire: startServer -> Registry -> fake machine.
const harness = async (procs: Parameters<typeof fakeMachine>[0] = []) => {
  const dir = mkdtempSync(join(tmpdir(), "wb-"));
  const cfg = { ...loadConfig(dir), port: 0 };
  const events: any[] = [];
  const fm = fakeMachine(procs);
  const registry = new Registry(
    { query: () => (async function* () {})() } as any,
    new Manifest(dir),
    (e) => events.push(e),
    cfg,
    fm.machine,
  );
  // The registry's own push (constructor arg) collects events; the server's push
  // is unused here, exactly as the config round-trip test drives it.
  const srv = await startServer(cfg, (method, params) => registry.handle(method, params));
  const ws = new WebSocket(`ws://127.0.0.1:${srv.port}/ws`);
  await new Promise((r) => ws.once("open", r));
  ws.send(JSON.stringify({ type: "auth", token: cfg.token }));
  await new Promise((r) => ws.once("message", r));
  const call = (id: string, method: string, params?: unknown) =>
    new Promise<any>((r) => {
      ws.once("message", (d) => r(JSON.parse(d.toString())));
      ws.send(JSON.stringify({ type: "req", id, method, params }));
    });
  return { call, srv, ws, fm, events, done: async () => { ws.close(); await srv.close(); } };
};

describe("system RPCs", () => {
  it("system.metrics returns a Metrics shape", async () => {
    const h = await harness();
    const res = await h.call("1", "system.metrics");
    expect(res.ok).toBe(true);
    expect(res.data.mem).toEqual({ usedGb: 16, totalGb: 32, pct: 50 });
    expect(res.data.cpuPct).toBe(10);
    expect(res.data.disks[0].mount).toBe("C:");
    expect(typeof res.data.uptimeSec).toBe("number");
    await h.done();
  });

  it("system.processes returns Proc[] sorted by cpu", async () => {
    const h = await harness([
      { pid: 1, name: "a", cpu: 5, memRss: 1024 },
      { pid: 2, name: "b", cpu: 80, memRss: 2048 },
    ]);
    const res = await h.call("1", "system.processes");
    expect(res.data.map((p: any) => p.pid)).toEqual([2, 1]);
    expect(res.data[0]).toEqual({ pid: 2, name: "b", cpuPct: 80, memMb: 2 });
    await h.done();
  });

  it("system.kill refuses the daemon's own pid as data, not an RPC error", async () => {
    const h = await harness();
    const res = await h.call("1", "system.kill", { pid: process.pid });
    expect(res.ok).toBe(true);
    expect(res.data).toEqual({ ok: false, error: "refused" });
    await h.done();
  });
});

describe("power RPCs", () => {
  it("power.state reflects the keep-awake hold, ecoMode always false", async () => {
    const h = await harness();
    expect((await h.call("1", "power.state")).data).toEqual({ keepAwake: false, ecoMode: false });
    await h.done();
  });

  it("power.keepAwake toggles the hold on and off", async () => {
    const h = await harness();
    expect((await h.call("1", "power.keepAwake", { on: true })).data).toEqual({ keepAwake: true, ecoMode: false });
    expect(h.fm.keepAwake.active).toBe(true);
    expect((await h.call("2", "power.keepAwake", { on: false })).data).toEqual({ keepAwake: false, ecoMode: false });
    expect(h.fm.keepAwake.active).toBe(false);
    await h.done();
  });

  it("power.lock issues the LockWorkStation command and returns ok", async () => {
    const h = await harness();
    expect((await h.call("1", "power.lock")).data).toEqual({ ok: true });
    expect(h.fm.execCmds).toContain("rundll32.exe user32.dll,LockWorkStation");
    await h.done();
  });

  // NaN can't come off the wire (JSON.stringify turns it into null, which the
  // validator rejects); the clamp guards a direct caller, so test it directly.
  it("clampRebootDelay floors/ceils/NaN-guards to 5..120", () => {
    expect(clampRebootDelay(2)).toBe(5);
    expect(clampRebootDelay(999)).toBe(120);
    expect(clampRebootDelay(-5)).toBe(5);
    expect(clampRebootDelay(NaN)).toBe(5);
    expect(clampRebootDelay(30)).toBe(30);
  });

  it("power.reboot clamps the wire delay and pushes a machine.reboot event", async () => {
    for (const [input, want] of [[2, 5], [999, 120], [-5, 5]] as [number, number][]) {
      const h = await harness();
      const res = await h.call("1", "power.reboot", { delaySec: input });
      expect(res.data).toEqual({ ok: true });
      // The scheduled command carried the clamped value...
      expect(h.fm.execCmds).toContain(`shutdown /r /t ${want} /c "Workbench remote reboot"`);
      // ...and so did the event the app counts down from.
      expect(h.events).toContainEqual({ kind: "machine.reboot", delaySec: want });
      await h.done();
    }
  });

  it("power.abortReboot issues shutdown /a and returns ok", async () => {
    const h = await harness();
    expect((await h.call("1", "power.abortReboot")).data).toEqual({ ok: true });
    expect(h.fm.execCmds).toContain("shutdown /a");
    await h.done();
  });
});
