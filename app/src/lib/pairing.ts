import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

import { WorkbenchClient, type ClientOpts, type ConnState } from "./client";

/** Everything needed to reach one daemon. Exactly what the daemon's QR encodes. */
export interface Pairing {
  host: string;
  port: number;
  token: string;
  /**
   * Set only when this build was served BY the daemon (the tunnel case: the web
   * export at https://xyz.trycloudflare.com). Then the daemon is this page's own
   * origin, and host/port cannot describe it — a tunnel is https with no port,
   * so the socket has to be wss and the URL must carry no ":443". When present
   * it wins; host/port are kept alongside only so the UI has something to show.
   */
  origin?: string;
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

type Addr = Pick<Pairing, "host" | "port" | "origin">;

/** The daemon's WS endpoint. One place, so a path change is one edit. */
export const pairingUrl = (p: Addr): string =>
  `${p.origin === undefined ? `ws://${authority(p.host, p.port)}` : p.origin.replace(/^http/, "ws")}/ws`;

/** The daemon's HTTP origin — what the terminal WebView is allowed to load. */
export const daemonOrigin = (p: Addr): string => p.origin ?? `http://${authority(p.host, p.port)}`;

/** How the user reads this pairing back: an origin, or the host:port they typed. */
export const pairingLabel = (p: Addr): string => p.origin ?? authority(p.host, p.port);

// An origin and nothing else: scheme, authority, no path — the same shape
// sameOrigin() compares against, so a trailing "/" or a path here would silently
// break the WebView's origin pin.
const ORIGIN_RE = /^https?:\/\/[^/?#\\]+$/;

/**
 * The origin serving this build, when it could be the daemon's — i.e. a browser
 * (the app's web export, served by the daemon over the tunnel). null on native,
 * where there is no `location` and the daemon is always somewhere else.
 */
export const servedOrigin = (): string | null => {
  if (Platform.OS !== "web") return null;
  const l = (globalThis as { location?: { protocol?: string; host?: string } }).location;
  const o = l ? `${l.protocol}//${l.host}` : "";
  return ORIGIN_RE.test(o) ? o : null;
};

/**
 * A pairing for the daemon that served this page. The token is the only thing
 * the user has to supply: everything else is where the page came from.
 */
export const sameOriginPairing = (token: string): Pairing | null => {
  const origin = servedOrigin();
  if (origin === null) return null;
  const l = location;
  // host/port are display-only here (origin wins in every builder above), but a
  // Pairing without them is not a Pairing — a tunnel has no port, so the scheme's
  // default stands in.
  return { host: l.hostname, port: Number(l.port) || (l.protocol === "https:" ? 443 : 80), token, origin };
};

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
    // An origin decides where the token is sent and what the WebView may load,
    // so anything that is not exactly an origin is dropped rather than trusted.
    const origin = typeof v.origin === "string" && ORIGIN_RE.test(v.origin) ? v.origin : undefined;
    return origin === undefined ? { host: v.host, port: v.port, token: v.token } : { host: v.host, port: v.port, token: v.token, origin };
  } catch {
    return null;
  }
};

export async function loadPairing(): Promise<Pairing | null> {
  const stored = parsePairing(webInsecureStorage ? localStorage.getItem(KEY) : await SecureStore.getItemAsync(KEY));
  if (stored === null) return null;
  // A page served BY a daemon is talking to that daemon, whatever storage
  // remembers. Without this, a pairing saved on the LAN (host:port, no origin)
  // survives into a tunnel session and the app keeps dialling an address that
  // only ever existed on the other side of the world. The token is the only
  // part of a stored pairing worth keeping once the origin can speak for itself.
  const served = servedOrigin();
  if (served !== null && stored.origin !== served) return sameOriginPairing(stored.token);
  return stored;
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
