import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

import { WorkbenchClient, type ClientOpts, type ConnState } from "./client";

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

// The daemon pairs over Tailscale by IPv6, and an IPv6 literal in a URL must be
// bracketed or the ":" of the address is read as the port separator —
// ws://fd7a:…:8790/ws is not a URL at all. A hostname or IPv4 has no ":" and is
// left alone; an already-bracketed host is not bracketed twice.
const authority = (host: string, port: number): string =>
  `${host.includes(":") && !host.startsWith("[") ? `[${host}]` : host}:${port}`;

/** The daemon's WS endpoint. One place, so a path change is one edit. */
export const pairingUrl = (p: Pick<Pairing, "host" | "port">): string => `ws://${authority(p.host, p.port)}/ws`;

/** The daemon's HTTP origin — what the terminal WebView is allowed to load. */
export const daemonOrigin = (p: Pick<Pairing, "host" | "port">): string => `http://${authority(p.host, p.port)}`;

/**
 * Is `url` on `origin`? The terminal WebView holds the daemon token, so a page
 * that navigated anywhere else must not be allowed to load in it — this is the
 * check that keeps the token pointed at the machine it belongs to.
 *
 * Prefix, not `new URL().origin`: RN's URL polyfill has no `origin`. The
 * separator is what stops `http://10.0.0.5:87` matching `http://10.0.0.5:8787`.
 */
export const sameOrigin = (url: string, origin: string): boolean =>
  url === origin || ["/", "?", "#"].some((sep) => url.startsWith(origin + sep));

/**
 * May the preview frame navigate to `url`? The inverse of the terminal's rule:
 * the preview holds no token but loads pages we do not trust, so the daemon's
 * own origin is the one place it must never go — `/terminal?dev=1` prompts for
 * the daemon token, and inside the app that prompt looks entirely legitimate.
 *
 * http(s) only: everything else (intent:, file:, javascript:) is either handed
 * to the OS or run in the frame, and a dev server preview needs neither.
 */
export const allowPreviewNav = (url: string, origin: string): boolean =>
  /^https?:\/\//i.test(url) && !sameOrigin(url, origin);

// Both sources of a pairing are untrusted input — a partial write, an older app
// version, a user poking localStorage, or a QR that isn't ours. Anything that is
// not a whole pairing is "not paired", and that path already ends at the pair screen.
export const parsePairing = (raw: string | null): Pairing | null => {
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
  return parsePairing(webInsecureStorage ? localStorage.getItem(KEY) : await SecureStore.getItemAsync(KEY));
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

// A LAN daemon answers in well under a second; ten is the point where "still
// trying" stops being information. Matches the client's own request timeout.
const VERIFY_MS = 10_000;

/**
 * Is this pairing usable? Answers with the first connection state that is an
 * answer — "connecting" never is — then closes the socket.
 *
 * Uses a throwaway client, not the app's connection: a wrong host must not leave
 * the store retrying a dead address behind the pair screen.
 */
export const verify = (
  p: Pairing,
  opts: { timeoutMs?: number } & ClientOpts = {},
): Promise<ConnState> =>
  new Promise((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout>;
    const done = (s: ConnState) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      client.close(); // also stops the reconnect backoff after an "offline"
      resolve(s);
    };
    const client = new WorkbenchClient(
      pairingUrl(p),
      p.token,
      { onEvent: () => {}, onState: (s) => s !== "connecting" && done(s) },
      opts,
    );
    // A host that drops packets instead of refusing them never fires close, so
    // the socket would sit in "connecting" forever without this.
    timer = setTimeout(() => done("offline"), opts.timeoutMs ?? VERIFY_MS);
    client.connect();
  });
