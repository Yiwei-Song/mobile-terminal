// "You have looked at this session up to here": sessionId -> ISO timestamp.
// Same storage split as recents.ts — keychain on device, localStorage on web —
// with one difference: the platform is sniffed and expo-secure-store is imported
// on demand, because store.ts pulls this module in and store.ts has to stay
// importable from plain node (its vitest suite drives a real daemon).
const KEY = "workbench.seen";

export type Seen = Record<string, string>;

const webStore = (): Storage | null => (typeof localStorage === "undefined" ? null : localStorage);

// A hand-edited value or an older format is "nothing seen yet", never a crash on
// the one screen the app opens on.
const parse = (raw: string | null): Seen => {
  if (raw === null) return {};
  try {
    const v = JSON.parse(raw) as unknown;
    if (typeof v !== "object" || v === null || Array.isArray(v)) return {};
    return Object.fromEntries(Object.entries(v).filter(([, at]) => typeof at === "string")) as Seen;
  } catch {
    return {};
  }
};

export async function loadSeen(): Promise<Seen> {
  const web = webStore();
  if (web !== null) return parse(web.getItem(KEY));
  try {
    const SecureStore = await import("expo-secure-store");
    return parse(await SecureStore.getItemAsync(KEY));
  } catch {
    return {};
  }
}

export async function saveSeen(seen: Seen): Promise<void> {
  const raw = JSON.stringify(seen);
  const web = webStore();
  if (web !== null) {
    web.setItem(KEY, raw);
    return;
  }
  try {
    const SecureStore = await import("expo-secure-store");
    await SecureStore.setItemAsync(KEY, raw);
  } catch {
    // A phone that cannot write the keychain still shows the right dots this
    // run; losing them on restart is not worth failing a tap over.
  }
}
