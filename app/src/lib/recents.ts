import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

// Recently-used working folders, most-recent first. Same storage split as
// pairing.ts (keychain on device, localStorage on web) — reused rather than
// pulling in AsyncStorage for eight short strings.
const KEY = "workbench.recents";
const MAX = 8;
const web = Platform.OS === "web";

/**
 * The list after using `cwd`: it moves to the front, any earlier copy drops out,
 * and the tail past eight is forgotten. Pure, because the cap + dedupe is the
 * only part worth a test.
 */
export const withRecent = (list: string[], cwd: string): string[] => {
  const c = cwd.trim();
  if (c === "") return list;
  return [c, ...list.filter((x) => x !== c)].slice(0, MAX);
};

// Anything that isn't an array of strings is "no history" — a hand-edited
// localStorage value or an older format is not worth crashing the screen over.
const parse = (raw: string | null): string[] => {
  if (raw === null) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, MAX) : [];
  } catch {
    return [];
  }
};

export async function loadRecents(): Promise<string[]> {
  return parse(web ? localStorage.getItem(KEY) : await SecureStore.getItemAsync(KEY));
}

/** Record a folder as used and return the new list, ready to render. */
export async function pushRecent(cwd: string): Promise<string[]> {
  const next = withRecent(await loadRecents(), cwd);
  const raw = JSON.stringify(next);
  if (web) localStorage.setItem(KEY, raw);
  else await SecureStore.setItemAsync(KEY, raw);
  return next;
}
