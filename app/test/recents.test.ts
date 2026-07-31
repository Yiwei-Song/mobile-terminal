import { describe, it, expect, beforeEach, vi } from "vitest";

// Same stub shape as pairing.test: the storage backends are native modules, so
// what's under test is the cap/dedupe logic and the JSON round-trip, not them.
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

const importFor = async (os: string) => {
  platform.OS = os;
  vi.resetModules();
  return import("../src/lib/recents");
};

describe("withRecent", () => {
  it("moves an existing folder to the front instead of duplicating it", async () => {
    const { withRecent } = await importFor("android");
    expect(withRecent(["a", "b", "c"], "c")).toEqual(["c", "a", "b"]);
    expect(withRecent(["a", "b"], "a")).toEqual(["a", "b"]);
  });

  it("caps the list at eight, dropping the oldest", async () => {
    const { withRecent } = await importFor("android");
    const eight = ["1", "2", "3", "4", "5", "6", "7", "8"];
    expect(withRecent(eight, "new")).toEqual(["new", "1", "2", "3", "4", "5", "6", "7"]);
  });

  it("ignores blank input and trims", async () => {
    const { withRecent } = await importFor("android");
    expect(withRecent(["a"], "   ")).toEqual(["a"]);
    expect(withRecent(["a"], "  b  ")).toEqual(["b", "a"]);
  });
});

describe.each([
  ["android", keychain],
  ["web", web],
])("pushRecent/loadRecents on %s", (os, store) => {
  beforeEach(() => {
    keychain.clear();
    web.clear();
  });

  it("round-trips and keeps most-recent-first with dedupe", async () => {
    const { loadRecents, pushRecent } = await importFor(os);
    expect(await loadRecents()).toEqual([]);

    await pushRecent("D:\\a");
    await pushRecent("D:\\b");
    await pushRecent("D:\\a"); // moves to front, no dupe
    expect(store.size).toBe(1); // landed in this platform's store only
    expect(await loadRecents()).toEqual(["D:\\a", "D:\\b"]);
  });

  it("caps persisted history at eight", async () => {
    const { loadRecents, pushRecent } = await importFor(os);
    for (let i = 0; i < 10; i++) await pushRecent(`p${i}`);
    const list = await loadRecents();
    expect(list).toHaveLength(8);
    expect(list[0]).toBe("p9");
  });

  it("treats a garbage record as no history", async () => {
    const { loadRecents, pushRecent } = await importFor(os);
    await pushRecent("D:\\a");
    const key = [...store.keys()][0] as string;
    store.set(key, "{not json");
    expect(await loadRecents()).toEqual([]);
  });
});
