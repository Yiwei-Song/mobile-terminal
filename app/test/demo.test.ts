import { describe, it, expect, vi, afterEach } from "vitest";

import { since, cwdTail } from "../src/lib/format";

// demo.ts and store.ts both read module-level state (the env flag, the store
// instance), so each case needs a fresh module graph — and both imports have to
// come from the same one, or the seed would land in a different store.
const load = async (flag?: string, variant?: string) => {
  if (flag === undefined) delete process.env.EXPO_PUBLIC_DEMO;
  else process.env.EXPO_PUBLIC_DEMO = flag;
  if (variant === undefined) delete process.env.EXPO_PUBLIC_DEMO_STATE;
  else process.env.EXPO_PUBLIC_DEMO_STATE = variant;
  vi.resetModules();
  const demo = await import("../src/lib/demo");
  const { useWorkbench } = await import("../src/lib/store");
  return { ...demo, state: () => useWorkbench.getState() };
};

afterEach(() => {
  delete process.env.EXPO_PUBLIC_DEMO;
  delete process.env.EXPO_PUBLIC_DEMO_STATE;
});

describe("demo mode", () => {
  it("is off unless the flag is exactly 1, and seeds nothing on its own", async () => {
    expect((await load()).demoMode).toBe(false);
    expect((await load("0")).demoMode).toBe(false);
    expect((await load("true")).demoMode).toBe(false);
    // Importing the module must not touch the store — only the screen's
    // explicit seedDemo() call does, and only when demoMode is on.
    const off = await load();
    expect(off.state().sessions).toEqual([]);
    expect(off.state().machine).toBeNull();
  });

  it("seeds an attention-first list with a pending approval", async () => {
    const { demoMode, seedDemo, state } = await load("1");
    expect(demoMode).toBe(true);
    seedDemo();

    expect(state().connState).toBe("online");
    expect(state().machine?.hostname).toBe("OMEN16");
    expect(state().sessions.length).toBeGreaterThanOrEqual(5);
    // Journey principle 1: the row that needs the user is the first one.
    expect(state().sessions[0]?.status).toBe("waiting_on_user");
    expect(state().sessions.map((s) => s.status)).toContain("dead");
    const asks = state().pendingApprovals[state().sessions[0]!.sessionId] ?? [];
    expect(asks).toHaveLength(1);
    // The worst case the approval card has to survive.
    expect(asks[0]!.summary).toContain("\n");
    expect(Object.keys(state().transcripts).length).toBeGreaterThan(1);
  });

  it("renders the offline and unauthorized stories on request", async () => {
    const off = await load("1", "offline");
    off.seedDemo();
    expect(off.state().connState).toBe("offline");
    expect(off.state().sessions).toEqual([]);
    expect(off.state().lastSeen).toBeTypeOf("number");

    const empty = await load("1", "empty");
    empty.seedDemo();
    expect(empty.state().connState).toBe("online");
    expect(empty.state().sessions).toEqual([]);

    const un = await load("1", "unauthorized");
    un.seedDemo();
    expect(un.state().connState).toBe("unauthorized");
  });
});

describe("row formatting", () => {
  it("says how stale a row is, coarsely", () => {
    const ago = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
    expect(since(ago(0.2))).toBe("just now");
    expect(since(ago(5))).toBe("5m");
    expect(since(ago(190))).toBe("3h");
    expect(since(ago(60 * 50))).toBe("2d");
    // The phone's clock running behind the PC's is not a negative age.
    expect(since(Date.now() + 60_000)).toBe("just now");
  });

  it("keeps the project end of a path", () => {
    expect(cwdTail("D:\\projects\\api-server")).toBe("…\\projects\\api-server");
    expect(cwdTail("/home/yiwei/code/scraper")).toBe("…/code/scraper");
    // Nothing to trim: showing "…" would claim there was.
    expect(cwdTail("D:\\proj")).toBe("D:\\proj");
  });
});
