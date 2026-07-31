import { describe, it, expect, beforeEach, vi } from "vitest";

// Both storage backends are native modules, so they are stubbed: what is under
// test is the branch between them, the JSON round-trip, and the "garbage in
// storage is not a pairing" rule.
const platform = { OS: "android" };
vi.mock("react-native", () => ({ Platform: platform }));

const keychain = new Map<string, string>();
vi.mock("expo-secure-store", () => ({
  getItemAsync: (k: string) => Promise.resolve(keychain.get(k) ?? null),
  setItemAsync: (k: string, v: string) => Promise.resolve(void keychain.set(k, v)),
  deleteItemAsync: (k: string) => Promise.resolve(void keychain.delete(k)),
}));

const web = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  value: {
    getItem: (k: string) => web.get(k) ?? null,
    setItem: (k: string, v: string) => void web.set(k, v),
    removeItem: (k: string) => void web.delete(k),
  },
  configurable: true,
});

// webInsecureStorage is decided at import time, so each platform needs a fresh
// module instance.
const importFor = async (os: string) => {
  platform.OS = os;
  vi.resetModules();
  return import("../src/lib/pairing");
};

const P = { host: "192.168.1.24", port: 8790, token: "abc123" };

describe.each([
  ["android", "keychain", keychain],
  ["web", "localStorage", web],
])("pairing on %s", (os, backend, store) => {
  beforeEach(() => {
    keychain.clear();
    web.clear();
  });

  it(`round-trips through ${backend} and clears`, async () => {
    const { loadPairing, savePairing, clearPairing, webInsecureStorage } = await importFor(os);
    expect(webInsecureStorage).toBe(os === "web");

    expect(await loadPairing()).toBeNull();
    await savePairing(P);
    // The value really landed in this platform's store, not the other one.
    expect(store.size).toBe(1);
    expect(await loadPairing()).toEqual(P);

    await clearPairing();
    expect(await loadPairing()).toBeNull();
  });

  it("treats an unparseable or incomplete record as not paired", async () => {
    const { loadPairing, savePairing } = await importFor(os);
    await savePairing(P);
    const key = [...store.keys()][0] as string;

    store.set(key, "{not json");
    expect(await loadPairing()).toBeNull();

    // An older/partial write: host + token but no port is not a reachable daemon.
    store.set(key, JSON.stringify({ host: P.host, token: P.token }));
    expect(await loadPairing()).toBeNull();
  });
});

describe("pairingUrl", () => {
  it("points at the daemon's /ws path", async () => {
    const { pairingUrl } = await importFor("android");
    expect(pairingUrl(P)).toBe("ws://192.168.1.24:8790/ws");
  });
});
