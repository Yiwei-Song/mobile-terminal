import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";

import { startDaemon, idle } from "./harness";

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

  // Pairing over Tailscale hands us an IPv6 host, and unbracketed that is not a
  // URL — the address's own ":" would be read as the port separator.
  it("brackets an IPv6 host, exactly once, and leaves other hosts alone", async () => {
    const { pairingUrl, daemonOrigin } = await importFor("android");
    const v6 = "fd7a:115c:a1e0:ab12:4843:cd96:6250:1a2b";
    for (const build of [pairingUrl, daemonOrigin]) {
      expect(build({ host: v6, port: 8790 })).toContain(`[${v6}]:8790`);
      // A host the user typed with brackets must not become [[…]].
      expect(build({ host: `[${v6}]`, port: 8790 })).toBe(build({ host: v6, port: 8790 }));
      expect(build({ host: "192.168.1.24", port: 8790 })).toContain("192.168.1.24:8790");
      expect(build({ host: "omen16", port: 8790 })).toContain("omen16:8790");
      expect(build({ host: "::1", port: 8790 })).toContain("[::1]:8790");
    }
    expect(pairingUrl({ host: v6, port: 8790 })).toBe(`ws://[${v6}]:8790/ws`);
    expect(daemonOrigin({ host: v6, port: 8790 })).toBe(`http://[${v6}]:8790`);
  });
});

// Served from the daemon itself (the Cloudflare tunnel: the web export at
// https://xyz.trycloudflare.com). There is no host or port to pair with then —
// the connection is wherever this page came from, and a tunnel is https with no
// port, so a hardcoded ws:// + ":443" would be wrong twice over.
describe("same-origin pairing", () => {
  const at = (protocol: string, hostname: string, port = "") => {
    Object.defineProperty(globalThis, "location", {
      value: { protocol, hostname, port, host: port === "" ? hostname : `${hostname}:${port}` },
      configurable: true,
    });
  };
  afterEach(() => {
    delete (globalThis as { location?: unknown }).location;
  });

  it("derives wss and no port from an https page", async () => {
    const { sameOriginPairing, pairingUrl, daemonOrigin, pairingLabel } = await importFor("web");
    at("https:", "xyz.trycloudflare.com");

    const p = sameOriginPairing("tok");
    expect(p).toEqual({ host: "xyz.trycloudflare.com", port: 443, token: "tok", origin: "https://xyz.trycloudflare.com" });
    expect(pairingUrl(p!)).toBe("wss://xyz.trycloudflare.com/ws");
    expect(daemonOrigin(p!)).toBe("https://xyz.trycloudflare.com");
    expect(pairingLabel(p!)).toBe("https://xyz.trycloudflare.com");
  });

  it("derives ws and keeps an explicit port from an http page", async () => {
    const { sameOriginPairing, pairingUrl, daemonOrigin } = await importFor("web");
    at("http:", "localhost", "8790");

    const p = sameOriginPairing("tok")!;
    expect(p.port).toBe(8790);
    expect(pairingUrl(p)).toBe("ws://localhost:8790/ws");
    expect(daemonOrigin(p)).toBe("http://localhost:8790");
  });

  it("is never same-origin on native, whatever globals exist", async () => {
    const { servedOrigin, sameOriginPairing } = await importFor("android");
    at("https:", "xyz.trycloudflare.com");

    expect(servedOrigin()).toBeNull();
    expect(sameOriginPairing("tok")).toBeNull();
  });

  it("leaves an explicit host/port pairing exactly as it was", async () => {
    const { pairingUrl, daemonOrigin } = await importFor("web");
    at("https:", "xyz.trycloudflare.com");
    const v6 = "fd7a:115c:a1e0:ab12:4843:cd96:6250:1a2b";

    // No origin on the pairing, no derivation: the native/LAN path is untouched
    // even when a `location` happens to exist.
    expect(pairingUrl(P)).toBe("ws://192.168.1.24:8790/ws");
    expect(daemonOrigin(P)).toBe("http://192.168.1.24:8790");
    expect(pairingUrl({ host: v6, port: 8790 })).toBe(`ws://[${v6}]:8790/ws`);
  });

  // An origin decides where the token is posted and what the terminal WebView
  // may load, and storage (or a QR) is untrusted input.
  it("keeps a stored origin only if it is exactly an origin", async () => {
    const { parsePairing } = await importFor("web");
    const base = { host: "h", port: 1, token: "t" };

    expect(parsePairing(JSON.stringify({ ...base, origin: "https://xyz.trycloudflare.com" }))?.origin).toBe(
      "https://xyz.trycloudflare.com",
    );
    for (const origin of ["https://evil.example/path", "javascript:alert(1)", "xyz.trycloudflare.com", 7, null, ""])
      expect(parsePairing(JSON.stringify({ ...base, origin })), String(origin)).toEqual(base);
  });

  // The tunnel's terminal iframe is pinned to this origin; the pin has to hold
  // for an https origin with no port too.
  it("pins the WebView to the tunnel origin", async () => {
    const { sameOrigin, allowPreviewNav } = await importFor("web");
    const O = "https://xyz.trycloudflare.com";

    expect(sameOrigin(`${O}/terminal`, O)).toBe(true);
    expect(sameOrigin("https://xyz.trycloudflare.com.evil.example/terminal", O)).toBe(false);
    expect(allowPreviewNav(`${O}/terminal?dev=1`, O)).toBe(false);
    expect(allowPreviewNav("https://example.com/", O)).toBe(true);
  });
});

// The terminal WebView holds the daemon token, so this predicate is what stops
// a navigation carrying it off the machine it belongs to.
describe("sameOrigin", () => {
  const O = "http://192.168.1.24:8790";

  it("accepts the origin itself and any path, query or fragment on it", async () => {
    const { sameOrigin, daemonOrigin } = await importFor("android");
    expect(daemonOrigin(P)).toBe(O);
    expect(sameOrigin(O, O)).toBe(true);
    expect(sameOrigin(`${O}/terminal`, O)).toBe(true);
    expect(sameOrigin(`${O}/terminal?dev=1`, O)).toBe(true);
    expect(sameOrigin(`${O}#top`, O)).toBe(true);
  });

  it("refuses another origin, including one that only looks like a prefix", async () => {
    const { sameOrigin } = await importFor("android");
    expect(sameOrigin("http://evil.example/terminal", O)).toBe(false);
    // The separator check: a longer port must not pass as the same origin.
    expect(sameOrigin("http://192.168.1.24:87900/terminal", O)).toBe(false);
    expect(sameOrigin("http://192.168.1.24:8790.evil.example/x", O)).toBe(false);
    expect(sameOrigin("https://192.168.1.24:8790/terminal", O)).toBe(false);
    expect(sameOrigin("javascript:alert(1)", O)).toBe(false);
    // Only "/", "?" and "#" end an origin. Two separators a URL parser accepts
    // and a naive prefix check would not: userinfo, and Windows' backslash.
    expect(sameOrigin("http://192.168.1.24:8790@evil.example/", O)).toBe(false);
    expect(sameOrigin("http://192.168.1.24:8790\\evil", O)).toBe(false);
  });
});

// The preview WebView holds no token but loads pages nobody vetted, so its rule
// is sameOrigin inverted: the daemon's origin is the one place it may not go.
describe("allowPreviewNav", () => {
  const O = "http://192.168.1.24:8790";

  it("refuses the daemon's own origin, whatever the path", async () => {
    const { allowPreviewNav } = await importFor("android");
    expect(allowPreviewNav(O, O)).toBe(false);
    // The phishing case: the daemon's terminal page prompts for the token.
    expect(allowPreviewNav(`${O}/terminal?dev=1`, O)).toBe(false);
    expect(allowPreviewNav(`${O}#top`, O)).toBe(false);
  });

  it("allows any other http(s) origin, including a near-miss prefix", async () => {
    const { allowPreviewNav } = await importFor("android");
    expect(allowPreviewNav("http://192.168.1.24:5173/", O)).toBe(true);
    expect(allowPreviewNav("https://example.com/docs", O)).toBe(true);
    expect(allowPreviewNav("http://192.168.1.24:87900/", O)).toBe(true);
    // Same host+port over TLS is a different origin, so it is not the daemon.
    expect(allowPreviewNav(`https://192.168.1.24:8790/`, O)).toBe(true);
  });

  it("refuses everything that is not http(s)", async () => {
    const { allowPreviewNav } = await importFor("android");
    for (const u of [
      "javascript:alert(1)",
      "file:///C:/Windows/win.ini",
      "intent://scan#Intent;scheme=zxing;end",
      "data:text/html,<script>1</script>",
      "about:blank",
      "",
    ])
      expect(allowPreviewNav(u, O), u).toBe(false);
  });

  it("is given a public address, not the token", async () => {
    const { daemonOrigin } = await importFor("android");
    expect(daemonOrigin(P)).not.toContain(P.token);
  });
});

// verify against the real daemon over real sockets — a stub server would prove
// nothing about the three answers the pair screen branches on.
describe("verify", () => {
  const BASE = 20;
  const RealWS = globalThis.WebSocket;
  let opened = 0;

  // Counting sockets is how "it stopped trying" becomes observable: verify must
  // leave nothing retrying a dead (or refusing) address behind the pair screen.
  beforeEach(() => {
    opened = 0;
    globalThis.WebSocket = new Proxy(RealWS, {
      construct: (t, a) => {
        opened++;
        return Reflect.construct(t, a) as object;
      },
    });
  });
  afterEach(() => {
    globalThis.WebSocket = RealWS;
  });

  const stopped = async () => {
    const seen = opened;
    await new Promise((r) => setTimeout(r, BASE * 3)); // several backoff steps
    expect(opened, "no further connect attempts after verify resolved").toBe(seen);
  };

  it("says online for a live daemon", async () => {
    const { verify } = await importFor("android");
    const d = await startDaemon(idle());

    expect(await verify({ host: "127.0.0.1", port: d.port, token: d.token }, { baseDelayMs: BASE })).toBe("online");
    await stopped();
    await d.close();
  });

  it("says unauthorized for a wrong token", async () => {
    const { verify } = await importFor("android");
    const d = await startDaemon(idle());

    expect(await verify({ host: "127.0.0.1", port: d.port, token: "not-the-token" }, { baseDelayMs: BASE })).toBe(
      "unauthorized",
    );
    await stopped();
    await d.close();
  });

  it("says offline for a port nothing is listening on", async () => {
    const { verify } = await importFor("android");
    const d = await startDaemon(idle());
    await d.close(); // the port is free now, so the connect is refused

    expect(await verify({ host: "127.0.0.1", port: d.port, token: d.token }, { baseDelayMs: BASE })).toBe("offline");
    await stopped();
  });

  it("gives up on a host that never answers", async () => {
    const { verify } = await importFor("android");
    // Reserved-for-documentation address: nothing routes there, so the socket
    // sits in "connecting" and only the timeout ends it.
    expect(await verify({ host: "192.0.2.1", port: 8790, token: "t" }, { baseDelayMs: BASE, timeoutMs: 60 })).toBe(
      "offline",
    );
    await stopped();
  });
});
