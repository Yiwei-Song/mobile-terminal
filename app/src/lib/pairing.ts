import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

/** Everything needed to reach one daemon. Exactly what the daemon's QR encodes. */
export interface Pairing {
  host: string;
  port: number;
  token: string;
}

// expo-secure-store has no web implementation (the browser has no keychain), so
// the web review build keeps the token in localStorage. The screens surface this
// flag as a visible note rather than silently downgrading the user's secret.
export const webInsecureStorage = Platform.OS === "web";

const KEY = "workbench.pairing";

/** The daemon's WS endpoint. One place, so a path change is one edit. */
export const pairingUrl = (p: Pick<Pairing, "host" | "port">): string => `ws://${p.host}:${p.port}/ws`;

// Storage is untrusted input: a partial write, an older app version, or a user
// poking localStorage all land here. Anything that is not a whole pairing is
// treated as "not paired" — that path already ends at the pair screen.
const parse = (raw: string | null): Pairing | null => {
  if (raw === null) return null;
  try {
    const v = JSON.parse(raw) as Partial<Pairing>;
    if (typeof v.host !== "string" || typeof v.port !== "number" || typeof v.token !== "string") return null;
    return { host: v.host, port: v.port, token: v.token };
  } catch {
    return null;
  }
};

export async function loadPairing(): Promise<Pairing | null> {
  return parse(webInsecureStorage ? localStorage.getItem(KEY) : await SecureStore.getItemAsync(KEY));
}

export async function savePairing(p: Pairing): Promise<void> {
  const raw = JSON.stringify(p);
  if (webInsecureStorage) localStorage.setItem(KEY, raw);
  else await SecureStore.setItemAsync(KEY, raw);
}

export async function clearPairing(): Promise<void> {
  if (webInsecureStorage) localStorage.removeItem(KEY);
  else await SecureStore.deleteItemAsync(KEY);
}
