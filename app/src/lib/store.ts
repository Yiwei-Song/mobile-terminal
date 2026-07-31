import { create } from "zustand";
import type { ConfigInfo, SessionEvent, SessionRow, SessionStatus } from "@shared/protocol";

import { WorkbenchClient, type ClientOpts, type ConnState } from "./client";

// The permission event *is* the approval — a second shape would only be a copy
// that drifts from protocol.ts.
export type Approval = Extract<SessionEvent, { kind: "session.permission" }>;

// One entry per rendered line. Kept as a union rather than a formatted string so
// the UI decides how a tool call or a cost looks, not the store.
export type TranscriptItem =
  | { id: string; kind: "text"; role: "assistant" | "user"; text: string }
  | { id: string; kind: "tool"; name: string; summary: string }
  | { id: string; kind: "done"; ok: boolean; costUsd: number | null };

export interface Workbench {
  sessions: SessionRow[];
  transcripts: Record<string, TranscriptItem[] | undefined>;
  pendingApprovals: Record<string, Approval[] | undefined>;
  connState: ConnState;
  lastSeen: number | undefined;
  // config.get's answer: hostname + version are what the header shows, and the
  // ntfy topic it also carries is what the settings screen will need.
  machine: ConfigInfo | null;
  // Why the last thing the user asked for did not happen. Cleared by the next
  // one that does: a failed action is state, not a silent no-op.
  lastError: string | null;

  connect(url: string, token: string, opts?: ClientOpts): void;
  disconnect(): void;
  // userInitiated marks the pull-to-refresh path — only that one is worth a
  // banner. The automatic re-list on every reconnect fails all the time by
  // design and reporting it would make the screen shout at a walk out of range.
  refreshSessions(userInitiated?: boolean): Promise<void>;
  applyEvent(e: SessionEvent): void;
  newSession(cwd: string, prompt: string, title?: string): Promise<string>;
  send(sessionId: string, text: string): Promise<void>;
  interrupt(sessionId: string): Promise<void>;
  approve(sessionId: string, requestId: string, allow: boolean): Promise<void>;
  // config.set answers with the whole ConfigInfo, so the settings screen never
  // has to guess what it saved — `machine` is the read-back.
  setNtfyTopic(topic: string | null): Promise<void>;
}

// Same order the daemon's manifest sorts by: what needs the user first, dead last.
const ORDER: SessionStatus[] = ["waiting_on_user", "running", "idle", "dead"];
const rank = (s: SessionStatus): number => {
  const i = ORDER.indexOf(s);
  return i === -1 ? ORDER.length : i;
};

// ponytail: module-level, not in state — none of it is rendered, and putting a
// live socket in a React store only invites a re-render on every reconnect.
let client: WorkbenchClient | null = null;
// The pairing the live client was built for. Home calls connect() on every
// focus, and rebuilding the socket each time would tear down a live connection
// (or restart a backoff) for nothing — but a re-pair to a new host must not be
// ignored, which is why the check is on the pairing and not just on `client`.
let wired: { url: string; token: string } | null = null;
// A new session's first events arrive before sessions.new resolves, so they
// name an id no list has yet. Hold them until a refresh introduces the session.
let buffered: SessionEvent[] = [];
let refreshing = false;
let itemSeq = 0;

const nextId = (): string => String(++itemSeq);

const append = (
  map: Record<string, TranscriptItem[] | undefined>,
  sessionId: string,
  item: TranscriptItem,
): Record<string, TranscriptItem[] | undefined> => ({
  ...map,
  [sessionId]: [...(map[sessionId] ?? []), item],
});

export const useWorkbench = create<Workbench>((set, get) => ({
  sessions: [],
  transcripts: {},
  pendingApprovals: {},
  connState: "offline",
  lastSeen: undefined,
  machine: null,
  lastError: null,

  connect(url, token, opts) {
    if (client !== null && wired?.url === url && wired.token === token) {
      // Same pairing: keep the socket. connect() on a client that already has
      // one is a no-op, and on one waiting out a backoff it means "try now" —
      // which is exactly what the offline screen's Retry button asks for.
      // opts are ignored here: they belong to the client this path is keeping.
      client.connect();
      return;
    }
    get().disconnect();
    wired = { url, token };
    client = new WorkbenchClient(
      url,
      token,
      {
        onEvent: (e) => get().applyEvent(e),
        onState: (connState, lastSeen) => {
          set({ connState, lastSeen });
          if (connState !== "online") return;
          // There is no "session removed" event, so the list is only ever truth
          // at (re)connect time — re-list on every online, not just the first.
          void get().refreshSessions().catch(() => {});
          void client
            ?.request<ConfigInfo>("config.get")
            .then((machine) => set({ machine }))
            .catch(() => {});
        },
      },
      opts,
    );
    client.connect();
  },

  disconnect() {
    client?.close();
    client = null;
    wired = null;
    buffered = [];
    refreshing = false;
    set({ sessions: [], transcripts: {}, pendingApprovals: {}, connState: "offline", machine: null, lastError: null });
  },

  async refreshSessions(userInitiated) {
    if (client === null) return;
    refreshing = true;
    try {
      // Trust the server's order: the manifest already sorts attention-first.
      const req = client.request<SessionRow[]>("sessions.list");
      set({ sessions: await (userInitiated === true ? track(req) : req) });
      // A permission is pushed once, at fire time. A phone that was disconnected
      // then (notification → open app later → reconnect) never saw that push, so
      // ask for the outstanding set — this is what makes the card reappear. The
      // daemon is authoritative, so replace rather than append.
      const pending = await client.request<Approval[]>("sessions.pending");
      set({ pendingApprovals: bySession(pending) });
    } finally {
      refreshing = false;
    }
    const held = buffered;
    buffered = [];
    const known = new Set(get().sessions.map((s) => s.sessionId));
    // This list is the only truth about which sessions still exist — the daemon
    // has no "session removed" event. Whatever it left out is gone, and holding
    // its transcript means a detail screen could still render a dead session.
    set({
      transcripts: onlyKnown(get().transcripts, known),
      pendingApprovals: onlyKnown(get().pendingApprovals, known),
    });
    // Anything still unknown belongs to a session this refresh did not return —
    // dropping it is what keeps the buffer from growing without bound.
    for (const e of held) if (known.has(e.sessionId)) get().applyEvent(e);
  },

  applyEvent(e) {
    // A session that died before the CLI reported an id: there is no row to file
    // this under and never will be.
    if (e.sessionId === "") return;
    const state = get();
    if (!state.sessions.some((s) => s.sessionId === e.sessionId)) {
      buffered.push(e);
      // Sessions can also be started from another phone, so a refresh is not
      // only sessions.new's job. Guarded, or the drop-then-rebuffer loop below
      // would fire a request per event.
      if (!refreshing) void state.refreshSessions().catch(() => {});
      return;
    }
    switch (e.kind) {
      case "session.status": {
        const sessions = state.sessions
          .map((s) =>
            s.sessionId === e.sessionId
              ? { ...s, status: e.status, title: e.title, updatedAt: new Date().toISOString() }
              : s,
          )
          // Stable, so same-status rows keep the order the server gave them.
          .sort((a, b) => rank(a.status) - rank(b.status));
        // The daemon denies a dead session's outstanding prompts server-side;
        // leaving the cards up would offer buttons that answer nothing.
        const pendingApprovals =
          e.status === "dead" ? without(state.pendingApprovals, e.sessionId) : state.pendingApprovals;
        set({ sessions, pendingApprovals });
        return;
      }
      case "session.text":
        // No optimistic echo on send: the daemon broadcasts the user's text back
        // and that echo is the single source of truth, so there is nothing to
        // de-dupe against. Costs one LAN round-trip of latency.
        set({ transcripts: append(state.transcripts, e.sessionId, { id: nextId(), kind: "text", role: e.role, text: e.text }) });
        return;
      case "session.tool":
        set({ transcripts: append(state.transcripts, e.sessionId, { id: nextId(), kind: "tool", name: e.name, summary: e.summary }) });
        return;
      case "session.done":
        set({ transcripts: append(state.transcripts, e.sessionId, { id: nextId(), kind: "done", ok: e.ok, costUsd: e.costUsd }) });
        return;
      case "session.permission": {
        // One card per outstanding request: Claude asks for several tools at
        // once and a single slot would drop all but the last.
        const asks = state.pendingApprovals[e.sessionId] ?? [];
        // Idempotent: a buffered permission replayed after a refresh already
        // pulled it in via sessions.pending must not double the card.
        if (asks.some((a) => a.requestId === e.requestId)) return;
        set({ pendingApprovals: { ...state.pendingApprovals, [e.sessionId]: [...asks, e] } });
        return;
      }
    }
  },

  async newSession(cwd, prompt, title) {
    // Empty title means "use the prompt's first line", which the daemon does for
    // an absent field. JSON has no undefined, so `null` would fail its validator.
    const r = await track(must().request<{ sessionId: string }>("sessions.new", { cwd, prompt, title: title || undefined }));
    // The session already exists on the daemon; a refresh that rejects here
    // (offline blip) must not fail newSession and send the user back to retry —
    // that starts a SECOND real session. Buffering covers the event gap until
    // the next refresh lands.
    await get().refreshSessions().catch(() => {});
    return r.sessionId;
  },

  async send(sessionId, text) {
    await track(must().request("sessions.send", { sessionId, text }));
  },

  async interrupt(sessionId) {
    await track(must().request("sessions.interrupt", { sessionId }));
  },

  async approve(sessionId, requestId, allow) {
    // Drop the card first: the thumb has answered, and the UI should not wait a
    // round-trip to acknowledge it.
    const asks = get().pendingApprovals[sessionId] ?? [];
    const answered = asks.find((a) => a.requestId === requestId);
    const list = asks.filter((a) => a.requestId !== requestId);
    // Last card answered drops the key, not an empty array: `in` and Object.keys
    // are how a screen asks whether a session is waiting on the user.
    set({
      pendingApprovals:
        list.length > 0
          ? { ...get().pendingApprovals, [sessionId]: list }
          : without(get().pendingApprovals, sessionId),
    });
    try {
      await track(must().request("sessions.approve", { sessionId, requestId, allow }));
    } catch (e) {
      // The request never reached the daemon, which is still blocking canUseTool.
      // A dropped card here dead-ends the session, so put it back for the thumb
      // to answer again (lastError already carries the why). The pending-recovery
      // on the next refresh heals it too; this is the immediate correct behavior.
      if (answered !== undefined) {
        const now = get().pendingApprovals[sessionId] ?? [];
        if (!now.some((a) => a.requestId === requestId))
          set({ pendingApprovals: { ...get().pendingApprovals, [sessionId]: [...now, answered] } });
      }
      throw e;
    }
  },

  async setNtfyTopic(topic) {
    set({ machine: await track(must().request<ConfigInfo>("config.set", { ntfyTopic: topic })) });
  },
}));

// sessions.pending returns one flat list across all sessions; the store keys
// approvals by session.
const bySession = (approvals: Approval[]): Record<string, Approval[]> => {
  const out: Record<string, Approval[]> = {};
  for (const a of approvals) (out[a.sessionId] ??= []).push(a);
  return out;
};

const onlyKnown = <T>(map: Record<string, T | undefined>, known: Set<string>): Record<string, T | undefined> =>
  Object.fromEntries(Object.entries(map).filter(([id]) => known.has(id)));

const without = <T>(map: Record<string, T>, key: string): Record<string, T> => {
  const rest = { ...map };
  delete rest[key];
  return rest;
};

// Every user-initiated action goes through here: succeed and the banner clears,
// fail and the reason survives the rejection the caller still gets.
const track = async <T>(p: Promise<T>): Promise<T> => {
  try {
    const r = await p;
    useWorkbench.setState({ lastError: null });
    return r;
  } catch (e) {
    useWorkbench.setState({ lastError: e instanceof Error ? e.message : String(e) });
    throw e;
  }
};

const must = (): WorkbenchClient => {
  if (client === null) throw new Error("not connected");
  return client;
};
