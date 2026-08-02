import { describe, it, expect, beforeEach, vi } from "vitest";
import type { SessionRow } from "@shared/protocol";

// Storage is a native module (expo-secure-store), so it is stubbed exactly as
// pairing.test.ts stubs it — what is under test is markSeen's clock-skew guard,
// not the keychain round-trip.
const keychain = new Map<string, string>();
vi.mock("expo-secure-store", () => ({
  getItemAsync: (k: string) => Promise.resolve(keychain.get(k) ?? null),
  setItemAsync: (k: string, v: string) => Promise.resolve(void keychain.set(k, v)),
  deleteItemAsync: (k: string) => Promise.resolve(void keychain.delete(k)),
}));

// store.ts's top-level hydration (loadSeen().then(...)) fires at import time, so
// each test needs a fresh module instance to control what it races against.
const importStore = async () => {
  vi.resetModules();
  keychain.clear();
  return import("../src/lib/store");
};

const row = (over: Partial<SessionRow> = {}): SessionRow => ({
  sessionId: "s1",
  agent: "claude",
  cwd: "C:\\proj",
  title: "t",
  status: "idle",
  updatedAt: new Date().toISOString(),
  ...over,
});

describe("markSeen and the clock-skew guard", () => {
  beforeEach(() => {
    keychain.clear();
  });

  it("clears the unread dot even when the phone's clock trails the daemon's", async () => {
    const { useWorkbench } = await importStore();
    const { isUnread } = await import("../src/lib/groups");

    // The row's updatedAt is minutes ahead of "now" — a lagging phone clock.
    const future = new Date(Date.now() + 5 * 60_000).toISOString();
    useWorkbench.setState({ sessions: [row({ updatedAt: future })] });

    useWorkbench.getState().markSeen("s1");

    const seenAt = useWorkbench.getState().seenAt;
    expect(isUnread(row({ updatedAt: future }), seenAt)).toBe(false);
  });

  it("stamps the phone's own clock in the normal case", async () => {
    const { useWorkbench } = await importStore();
    const { isUnread } = await import("../src/lib/groups");

    const past = new Date(Date.now() - 60_000).toISOString();
    useWorkbench.setState({ sessions: [row({ updatedAt: past })] });

    const before = Date.now();
    useWorkbench.getState().markSeen("s1");
    const after = Date.now();

    const stamp = useWorkbench.getState().seenAt["s1"]!;
    expect(Date.parse(stamp)).toBeGreaterThanOrEqual(before);
    expect(Date.parse(stamp)).toBeLessThanOrEqual(after);
    expect(isUnread(row({ updatedAt: past }), useWorkbench.getState().seenAt)).toBe(false);
  });

  it("falls back to the phone's clock when the session is not in the list", async () => {
    const { useWorkbench } = await importStore();
    useWorkbench.getState().markSeen("unknown");
    const stamp = useWorkbench.getState().seenAt["unknown"]!;
    expect(Date.parse(stamp)).not.toBeNaN();
  });
});
