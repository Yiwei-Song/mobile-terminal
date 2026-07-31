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

  connect(url: string, token: string, opts?: ClientOpts): void;
  disconnect(): void;
  refreshSessions(): Promise<void>;
  applyEvent(e: SessionEvent): void;
  newSession(cwd: string, prompt: string, title?: string): Promise<string>;
  send(sessionId: string, text: string): Promise<void>;
  interrupt(sessionId: string): Promise<void>;
  approve(sessionId: string, requestId: string, allow: boolean): Promise<void>;
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

  connect(url, token, opts) {
    get().disconnect();
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
    buffered = [];
    refreshing = false;
    set({ sessions: [], transcripts: {}, pendingApprovals: {}, connState: "offline", machine: null });
  },

  async refreshSessions() {
    if (client === null) return;
    refreshing = true;
    try {
      // Trust the server's order: the manifest already sorts attention-first.
      set({ sessions: await client.request<SessionRow[]>("sessions.list") });
    } finally {
      refreshing = false;
    }
    const held = buffered;
    buffered = [];
    const known = new Set(get().sessions.map((s) => s.sessionId));
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
      case "session.permission":
        // One card per outstanding request: Claude asks for several tools at
        // once and a single slot would drop all but the last.
        set({
          pendingApprovals: {
            ...state.pendingApprovals,
            [e.sessionId]: [...(state.pendingApprovals[e.sessionId] ?? []), e],
          },
        });
    }
  },

  async newSession(cwd, prompt, title) {
    // Empty title means "use the prompt's first line", which the daemon does for
    // an absent field. JSON has no undefined, so `null` would fail its validator.
    const r = await must().request<{ sessionId: string }>("sessions.new", { cwd, prompt, title: title || undefined });
    await get().refreshSessions();
    return r.sessionId;
  },

  async send(sessionId, text) {
    await must().request("sessions.send", { sessionId, text });
  },

  async interrupt(sessionId) {
    await must().request("sessions.interrupt", { sessionId });
  },

  async approve(sessionId, requestId, allow) {
    // Drop the card first: the thumb has answered, and a failed request leaves
    // the session's next status event to tell the truth.
    const list = (get().pendingApprovals[sessionId] ?? []).filter((a) => a.requestId !== requestId);
    set({ pendingApprovals: { ...get().pendingApprovals, [sessionId]: list } });
    await must().request("sessions.approve", { sessionId, requestId, allow });
  },
}));

const without = <T>(map: Record<string, T>, key: string): Record<string, T> => {
  const rest = { ...map };
  delete rest[key];
  return rest;
};

const must = (): WorkbenchClient => {
  if (client === null) throw new Error("not connected");
  return client;
};
