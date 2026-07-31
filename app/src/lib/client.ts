import type { ServerMsg, SessionEvent } from "@shared/protocol";

export type ConnState = "connecting" | "online" | "offline";

export interface ClientHandlers {
  onEvent(e: SessionEvent): void;
  // lastSeen is the epoch ms of the last frame the daemon sent us — the only
  // honest thing to show next to an offline banner. Absent until first contact.
  onState(s: ConnState, lastSeen?: number): void;
}

export interface ClientOpts {
  // Tests inject a small base so a reconnect is observable without waiting a
  // real second; production never passes it.
  baseDelayMs?: number;
  requestTimeoutMs?: number;
}

// 1s → 2 → 4 → 8 → 15s, scaled with the injected base so the shape of the
// backoff is the same in tests as in production.
const CAP_STEPS = 15;

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class WorkbenchClient {
  private readonly base: number;
  private readonly defaultTimeout: number;
  private readonly pending = new Map<string, Pending>();
  private ws: WebSocket | null = null;
  private seq = 0;
  private attempt = 0;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private stopped = true;
  private authed = false;
  private lastSeen: number | undefined;

  constructor(
    private readonly url: string,
    private readonly token: string,
    private readonly handlers: ClientHandlers,
    opts: ClientOpts = {},
  ) {
    this.base = opts.baseDelayMs ?? 1000;
    this.defaultTimeout = opts.requestTimeoutMs ?? 10_000;
  }

  connect(): void {
    this.stopped = false;
    if (this.ws !== null) return;
    // A pending retry would open a second socket on top of this one. Cancel it
    // and start over: a manual reconnect means "try now", not "keep waiting".
    if (this.retry !== null) clearTimeout(this.retry);
    this.retry = null;
    this.attempt = 0;
    this.open();
  }

  close(): void {
    this.stopped = true;
    if (this.retry !== null) clearTimeout(this.retry);
    this.retry = null;
    const ws = this.ws;
    // Cleared before close() so the socket's own onclose sees a superseded
    // handle and does not schedule a reconnect we just asked to stop.
    this.ws = null;
    this.authed = false;
    ws?.close();
    this.failPending("client closed");
  }

  request<T = unknown>(method: string, params?: object, timeoutMs = this.defaultTimeout): Promise<T> {
    const ws = this.ws;
    // Honest offline: no queue. The store renders the connection state, and a
    // write that lands minutes later is worse than one that failed out loud.
    if (ws === null || !this.authed) return Promise.reject(new Error(`offline: cannot ${method}`));
    const id = String(++this.seq);
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      ws.send(JSON.stringify({ type: "req", id, method, params }));
    });
  }

  private open(): void {
    this.handlers.onState("connecting", this.lastSeen);
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.onopen = () => ws.send(JSON.stringify({ type: "auth", token: this.token }));
    ws.onmessage = (ev) => this.receive(ev.data);
    // A refused connect fires "error" then "close". Close is the only path that
    // retries; this handler exists so the error is not unhandled.
    ws.onerror = () => {};
    ws.onclose = () => {
      if (this.ws !== ws) return; // superseded by close() or a newer socket
      this.ws = null;
      this.authed = false;
      this.failPending("connection closed");
      this.handlers.onState("offline", this.lastSeen);
      if (this.stopped) return;
      const delay = Math.min(this.base * 2 ** this.attempt, this.base * CAP_STEPS);
      this.attempt++;
      this.retry = setTimeout(() => this.open(), delay);
    };
  }

  private receive(raw: unknown): void {
    // The one place wire data becomes typed. Only the daemon can reach an
    // authenticated socket and protocol.ts is its single source of truth, so a
    // second validator here would only duplicate the daemon's own tests.
    let m: ServerMsg;
    try {
      m = JSON.parse(String(raw)) as ServerMsg;
    } catch {
      return; // ponytail: garbage on the wire is dropped, not surfaced
    }
    this.lastSeen = Date.now();
    if (m.type === "auth.ok") {
      // Reset only after a successful auth: a server that accepts the TCP
      // connection and then closes must not reset the backoff on every attempt.
      this.attempt = 0;
      this.authed = true;
      this.handlers.onState("online", this.lastSeen);
    } else if (m.type === "res") {
      const p = this.pending.get(m.id);
      if (p === undefined) return; // already timed out
      this.pending.delete(m.id);
      clearTimeout(p.timer);
      if (m.ok) p.resolve(m.data);
      else p.reject(new Error(m.error));
    } else {
      this.handlers.onEvent(m.event);
    }
  }

  // Nothing will ever answer these; left pending they hang their awaiters forever.
  private failPending(why: string): void {
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error(why));
    }
    this.pending.clear();
  }
}
