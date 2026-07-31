import { describe, it, expect, afterEach } from "vitest";

import { sparklinePoints, meterColor } from "../src/components/meters";
import { useWorkbench } from "../src/lib/store";
import { startDaemon, until, idle } from "./harness";

const state = () => useWorkbench.getState();

describe("sparklinePoints", () => {
  it("maps values to coords across the box, newest last, 0 at the bottom", () => {
    // w=100 h=40 max=100: stepX=50, y = 40 - v/100*40.
    expect(sparklinePoints([0, 50, 100], 100, 40)).toBe("0,40 50,20 100,0");
  });

  it("clamps out-of-range values into the box", () => {
    expect(sparklinePoints([-10, 150], 100, 40, 100)).toBe("0,40 100,0");
  });

  it("is safe for an empty array", () => {
    expect(sparklinePoints([], 100, 40)).toBe("");
  });

  it("is safe for a single value (one coord, no divide-by-zero)", () => {
    expect(sparklinePoints([50], 100, 40)).toBe("0,20");
  });
});

describe("meterColor", () => {
  it("is green below 70", () => {
    expect(meterColor(0)).toBe("accent");
    expect(meterColor(69)).toBe("accent");
  });
  it("is amber from 70 up to but not including 90", () => {
    expect(meterColor(70)).toBe("warn");
    expect(meterColor(89)).toBe("warn");
  });
  it("is red at 90 and above", () => {
    expect(meterColor(90)).toBe("danger");
    expect(meterColor(100)).toBe("danger");
  });
});

describe("system store", () => {
  afterEach(() => state().disconnect());

  const online = async (url: string, token: string) => {
    state().connect(url, token, { baseDelayMs: 10 });
    await until("online", () => state().connState === "online");
  };

  it("sets rebootPending directly from a machine.reboot event", () => {
    expect(state().rebootPending).toBeNull();
    state().applyEvent({ kind: "machine.reboot", delaySec: 42 });
    expect(state().rebootPending).toEqual({ delaySec: 42 });
    // No sessionId, so it must not have been buffered as a phantom session.
    expect(state().sessions).toEqual([]);
  });

  it("pulls metrics and processes from the real daemon", async () => {
    const d = await startDaemon(idle());
    await online(d.url, d.token);

    expect(state().metrics).toBeNull();
    await state().refreshMetrics();
    // fakeMachine's canned si: 10% cpu, 16/32 GB mem, C: 50%.
    expect(state().metrics).toMatchObject({
      cpuPct: 10,
      mem: { usedGb: 16, totalGb: 32, pct: 50 },
    });
    expect(Array.isArray(state().processes)).toBe(true);

    await d.close();
  });

  it("re-plumbs machine.reboot end to end: rebootMachine → event → rebootPending", async () => {
    const d = await startDaemon(idle());
    await online(d.url, d.token);

    // The fake exec records the shutdown command and resolves; nothing reboots.
    // The daemon then pushes machine.reboot, which the client no longer drops.
    await state().rebootMachine(30);
    await until("countdown armed", () => state().rebootPending !== null);
    expect(state().rebootPending).toEqual({ delaySec: 30 });

    await state().abortReboot();
    expect(state().rebootPending).toBeNull();

    await d.close();
  });

  it("reads power state and reflects a keep-awake toggle", async () => {
    const d = await startDaemon(idle());
    await online(d.url, d.token);

    await state().refreshPowerState();
    expect(state().powerState).toEqual({ keepAwake: false, ecoMode: false });

    await state().setKeepAwake(true);
    expect(state().powerState).toEqual({ keepAwake: true, ecoMode: false });

    await d.close();
  });
});
