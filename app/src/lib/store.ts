import { create } from "zustand";
import type { ConfigInfo, Entry, Metrics, Port, Proc, Project, PushEvent, SessionEvent, SessionRow, SessionStatus, TermInfo, ToolStatus } from "@shared/protocol";

import { WorkbenchClient, type ClientOpts, type ConnState } from "./client";
import { loadSeen, saveSeen, type Seen } from "./seen";

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
  // Every session on the PC, grouped by folder — including ones started in the
  // desktop apps, which the daemon reads from their own stores. Separate from
  // `sessions` (the daemon's own manifest) because they answer different
  // questions: `sessions` is "what needs me", this is "what exists".
  projects: Project[];
  transcripts: Record<string, TranscriptItem[] | undefined>;
  pendingApprovals: Record<string, Approval[] | undefined>;
  connState: ConnState;
  lastSeen: number | undefined;
  // When the user last LOOKED at each session (ISO), persisted. Unread is
  // `updatedAt > seenAt[id]` — see groups.ts. Named apart from `lastSeen`
  // above, which is the socket's last frame and has nothing to do with reading.
  seenAt: Seen;
  // config.get's answer: hostname + version are what the header shows, and the
  // ntfy topic it also carries is what the settings screen will need.
  machine: ConfigInfo | null;
  // The System screen's live snapshot. Null until the first refresh; the screen
  // drives the ~3s interval — the store never owns a timer.
  metrics: Metrics | null;
  processes: Proc[];
  // power.state's answer: the keep-awake hold and eco flag the toggle reflects.
  powerState: { keepAwake: boolean; ecoMode: boolean } | null;
  // The live terminals. Only the list lives here — the bytes belong to the
  // WebView, which holds its own socket straight to the daemon.
  terminals: TermInfo[];
  // The user's declared dev services (tools.json) and what is listening on the
  // PC right now. Separate reads: a tool can be running before it binds, and a
  // port can be open without any tool of ours behind it.
  tools: ToolStatus[];
  ports: Port[];
  // The file browser's world. `dir` travels with `entries` so a screen never
  // renders one folder's rows under another's breadcrumb.
  roots: string[];
  dir: string | null;
  entries: Entry[];
  fileText: { path: string; text: string; truncated: boolean } | null;
  diff: { cwd: string; text: string } | null;
  // git.status's answer for `cwd`, or null when that folder is not a repo (the
  // call throws and the Changes affordance stays hidden). NOTE: the paths in
  // `files` are relative to the REPO TOP, not to `cwd` — shown as given.
  git: { cwd: string; branch: string; files: { path: string; status: string }[] } | null;
  // Set by the machine.reboot push once a reboot is scheduled: the screen shows a
  // countdown with an Abort while this is non-null. Cleared by abortReboot or a
  // fresh connect — a reboot means the PC is about to drop off anyway.
  rebootPending: { delaySec: number } | null;
  // Why the last thing the user asked for did not happen. Cleared by the next
  // one that does: a failed action is state, not a silent no-op.
  lastError: string | null;

  connect(url: string, token: string, opts?: ClientOpts): void;
  disconnect(): void;
  /** Mark a session read as of now, and persist it. */
  markSeen(sessionId: string): void;
  // userInitiated marks the pull-to-refresh path — only that one is worth a
  // banner. The automatic re-list on every reconnect fails all the time by
  // design and reporting it would make the screen shout at a walk out of range.
  refreshSessions(userInitiated?: boolean): Promise<void>;
  refreshProjects(userInitiated?: boolean): Promise<void>;
  // Seed a conversation from the agent's own transcript file on the PC. Never
  // rejects: history that cannot be read is an empty conversation, not a banner.
  loadTranscript(sessionId: string): Promise<void>;
  applyEvent(e: PushEvent): void;
  // Screen-driven polling read (metrics + processes together). Not tracked: a
  // blip on the 3s tick must not flash a banner — same reasoning as the
  // automatic re-list.
  refreshMetrics(): Promise<void>;
  killProcess(pid: number): Promise<{ ok: boolean; error?: string }>;
  refreshPowerState(): Promise<void>;
  setKeepAwake(on: boolean): Promise<void>;
  lockMachine(): Promise<void>;
  rebootMachine(delaySec: number): Promise<void>;
  abortReboot(): Promise<void>;
  refreshTerminals(): Promise<void>;
  // cols/rows are a placeholder: the WebView resizes the pty to its real fit the
  // moment it attaches, so the only thing that matters here is that they are legal.
  createTerminal(cwd: string): Promise<TermInfo>;
  killTerminal(termId: string): Promise<void>;
  refreshTools(): Promise<void>;
  startTool(name: string): Promise<void>;
  stopTool(name: string): Promise<void>;
  refreshPorts(): Promise<void>;
  refreshRoots(): Promise<void>;
  listDir(dir: string): Promise<void>;
  readFile(path: string): Promise<void>;
  loadDiff(cwd: string, file?: string): Promise<void>;
  // Never rejects: "not a repo" is the answer, not a failure, and it decides
  // whether the Changes affordance exists at all.
  loadGitStatus(cwd: string): Promise<void>;
  newSession(cwd: string, prompt: string, title?: string): Promise<string>;
  send(sessionId: string, text: string): Promise<void>;
  interrupt(sessionId: string): Promise<void>;
  approve(sessionId: string, requestId: string, allow: boolean): Promise<void>;
  // config.set answers with the whole ConfigInfo, so the settings screen never
  // has to guess what it saved — `machine` is the read-back.
  setNtfyTopic(topic: string | null): Promise<void>;
}

// power.state and power.keepAwake both answer with this shape.
type PowerState = { keepAwake: boolean; ecoMode: boolean };

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
  projects: [],
  transcripts: {},
  pendingApprovals: {},
  connState: "offline",
  lastSeen: undefined,
  seenAt: {},
  machine: null,
  metrics: null,
  processes: [],
  powerState: null,
  terminals: [],
  tools: [],
  ports: [],
  roots: [],
  dir: null,
  entries: [],
  fileText: null,
  diff: null,
  git: null,
  rebootPending: null,
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
          // Back online = the reboot (if any) happened and the PC returned, so a
          // still-set countdown is stale. Clearing here is the "cleared on a
          // subsequent connect" half of rebootPending's lifecycle.
          set({ rebootPending: null });
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
    set({
      sessions: [],
      projects: [],
      transcripts: {},
      pendingApprovals: {},
      connState: "offline",
      machine: null,
      metrics: null,
      processes: [],
      powerState: null,
      terminals: [],
      tools: [],
      ports: [],
      roots: [],
      dir: null,
      entries: [],
      fileText: null,
      diff: null,
      git: null,
      rebootPending: null,
      lastError: null,
    });
  },

  markSeen(sessionId) {
    // Not cleared by disconnect(): what you have read is the phone's own memory,
    // not the daemon's state.
    // Phone clock can trail the daemon's; seeing the row means seeing everything
    // up to its updatedAt, so a lagging phone clock can never leave the dot stuck.
    const row = get().sessions.find((s) => s.sessionId === sessionId);
    const now = new Date().toISOString();
    const stamp = row !== undefined && row.updatedAt > now ? row.updatedAt : now;
    const seenAt = { ...get().seenAt, [sessionId]: stamp };
    set({ seenAt });
    void saveSeen(seenAt);
  },

  // Read straight off the daemon's scan of both agents' own stores. Replaces
  // wholesale rather than merging: the PC is authoritative about what exists,
  // and a session archived or deleted there must stop appearing here.
  async refreshProjects(userInitiated) {
    if (client === null) return;
    const req = client.request<Project[]>("sessions.projects");
    set({ projects: await (userInitiated === true ? track(req) : req) });
  },

  /**
   * History for a session, read off disk by the daemon.
   *
   * Only when the conversation is empty here: once live events have arrived they
   * are the newer truth, and replacing them with a file read would drop whatever
   * landed in between. This is what makes a session survive a daemon restart —
   * and what makes a session started in the desktop app readable at all.
   */
  async loadTranscript(sessionId) {
    if (client === null) return;
    if ((get().transcripts[sessionId] ?? []).length > 0) return;
    try {
      const entries = await client.request<{ kind: "text" | "tool"; [k: string]: unknown }[]>("sessions.transcript", { sessionId });
      // Re-checked after the await: a live event may have arrived while the
      // request was in flight, and it outranks the file.
      if ((get().transcripts[sessionId] ?? []).length > 0) return;
      set({
        transcripts: {
          ...get().transcripts,
          // Ids are positional and local to this replay — nothing correlates
          // them with live event ids, and nothing needs to.
          [sessionId]: entries.map((e, i) => ({ ...e, id: `history-${i}` }) as TranscriptItem),
        },
      });
    } catch {
      // An unreadable transcript is an empty one; the screen says so already.
    }
  },

  async refreshSessions(userInitiated) {
    if (client === null) return;
    // Everything this list can be evidence about. A sessions.list answer only
    // speaks for the sessions that already existed when it was asked for: one
    // created while it was in flight is legitimately missing from it, and
    // refreshes overlap constantly (newSession does one, and so does every
    // event naming a not-yet-listed session). Reading that absence as "removed"
    // is how a brand-new session's buffered echo — the only copy of the user's
    // own prompt, since nothing ever re-sends a session.text — was thrown away.
    const asked = new Set([...get().sessions.map((s) => s.sessionId), ...buffered.map((e) => e.sessionId)]);
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
    const known = new Set(get().sessions.map((s) => s.sessionId));
    // This list is the only truth about which sessions still exist — the daemon
    // has no "session removed" event. Whatever it left out is gone, and holding
    // its transcript means a detail screen could still render a dead session.
    // Bounded by `asked`, per above: absent-and-never-asked-about means "too
    // new to be in this answer", not "removed".
    const gone = (id: string): boolean => !known.has(id) && asked.has(id);
    set({
      transcripts: dropWhere(get().transcripts, gone),
      pendingApprovals: dropWhere(get().pendingApprovals, gone),
    });
    // Placed now, or kept for the next list to judge. Dropping the rest is what
    // keeps the buffer bounded — and an event kept here is judged on the very
    // next pass, because by then `asked` names its session.
    buffered = held.filter((e) => !known.has(e.sessionId) && !gone(e.sessionId));
    for (const e of held) if (known.has(e.sessionId)) get().applyEvent(e);
    // Nothing else is guaranteed to ask again (the session may have been started
    // from another phone), and a kept event must not sit in the buffer forever.
    if (buffered.length > 0) void get().refreshSessions().catch(() => {});
  },

  applyEvent(e) {
    // Not a session event — it has no sessionId, so it must be handled before the
    // per-session bookkeeping below (which would otherwise buffer it forever under
    // an id no list will ever have). The PC is about to reboot; the screen shows a
    // countdown then the socket drops on its own.
    if (e.kind === "machine.reboot") {
      set({ rebootPending: { delaySec: e.delaySec } });
      return;
    }
    // term.* rides the same channel but belongs to the terminal WebView, which
    // holds its own socket. Everything below is per-session bookkeeping, so
    // anything without a sessionId is not ours — this also makes the store
    // forward-compatible with kinds it has never heard of.
    if (!("sessionId" in e)) return;
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

  async refreshMetrics() {
    if (client === null) return;
    // One round of both reads; the screen's interval calls this every ~3s. Not
    // wrapped in track — a missed tick is not worth a banner.
    const [metrics, processes] = await Promise.all([
      client.request<Metrics>("system.metrics"),
      client.request<Proc[]>("system.processes"),
    ]);
    set({ metrics, processes });
  },

  async killProcess(pid) {
    // The RPC answers {ok,error?}: a refused/failed kill is data the screen shows,
    // not a thrown RPC error. track still catches a genuine transport failure.
    const r = await track(must().request<{ ok: boolean; error?: string }>("system.kill", { pid }));
    // Only a real kill changes the list; a refusal leaves it as-is.
    if (r.ok) await get().refreshMetrics().catch(() => {});
    return r;
  },

  async refreshTerminals() {
    if (client === null) return;
    // Not tracked: the list refreshes on focus and after a kill, and a blip on
    // either is not worth a banner — same reasoning as the automatic re-list.
    set({ terminals: await client.request<TermInfo[]>("term.list") });
  },

  async createTerminal(cwd) {
    const t = await track(must().request<TermInfo>("term.create", { cwd, cols: 80, rows: 24 }));
    // Append rather than re-list: the screen navigates into it immediately, and
    // a rejected refresh must not lose a pty that already exists.
    set({ terminals: [...get().terminals, t] });
    return t;
  },

  async killTerminal(termId) {
    await track(must().request("term.kill", { termId }));
    // term.exit arrives on the event channel, but this store deliberately ignores
    // it (it belongs to the WebView's socket), so drop the row here.
    set({ terminals: get().terminals.filter((t) => t.termId !== termId) });
  },

  async refreshTools() {
    if (client === null) return;
    // Not tracked: the screen re-asks on focus, and the empty state already
    // explains itself — same reasoning as the automatic re-list.
    set({ tools: await client.request<ToolStatus[]>("tools.list") });
  },

  // Both answer with the tool's new status, so the row reads back what took
  // rather than guessing. Tracked: the thumb asked for this one.
  async startTool(name) {
    set({ tools: replaceTool(get().tools, await track(must().request<ToolStatus>("tools.start", { name }))) });
  },

  async stopTool(name) {
    set({ tools: replaceTool(get().tools, await track(must().request<ToolStatus>("tools.stop", { name }))) });
  },

  async refreshPorts() {
    if (client === null) return;
    // Same: the preview screen polls this to notice a dev server coming up.
    set({ ports: await client.request<Port[]>("ports.list") });
  },

  async refreshRoots() {
    if (client === null) return;
    // Not tracked: the screen re-asks on every focus and a blip there is not
    // worth a banner — the empty-roots state already explains itself.
    set({ roots: await client.request<string[]>("files.roots") });
  },

  async listDir(dir) {
    // `dir` lands with its own listing, never before it: a rejected descent must
    // leave the breadcrumb where the user still is.
    set({ entries: await track(must().request<Entry[]>("files.list", { dir })), dir });
  },

  async readFile(path) {
    const r = await track(must().request<{ text: string; truncated: boolean }>("files.read", { path }));
    set({ fileText: { path, ...r } });
  },

  async loadDiff(cwd, file) {
    const r = await track(must().request<{ diff: string }>("git.diff", { cwd, file }));
    set({ diff: { cwd, text: r.diff } });
  },

  async loadGitStatus(cwd) {
    if (client === null) return;
    try {
      const r = await client.request<{ branch: string; files: { path: string; status: string }[] }>("git.status", { cwd });
      set({ git: { cwd, ...r } });
    } catch {
      // Not a repo (or git is not installed): there are no changes to offer.
      set({ git: null });
    }
  },

  async refreshPowerState() {
    if (client === null) return;
    set({ powerState: await client.request<PowerState>("power.state") });
  },

  async setKeepAwake(on) {
    // The RPC answers with the new state, so the toggle reads back what took.
    set({ powerState: await track(must().request<PowerState>("power.keepAwake", { on })) });
  },

  async lockMachine() {
    await track(must().request("power.lock"));
  },

  async rebootMachine(delaySec) {
    // The machine.reboot push (applyEvent) is what sets rebootPending — only after
    // the daemon confirms the shutdown was actually scheduled.
    await track(must().request("power.reboot", { delaySec }));
  },

  async abortReboot() {
    await track(must().request("power.abortReboot"));
    set({ rebootPending: null });
  },
}));

// Read marks are on disk, so hydrate once at start-up rather than making every
// screen ask. Marks made before storage answers win — the user's tap now is
// newer than anything the file can hold.
void loadSeen()
  .then((stored) => {
    const current = useWorkbench.getState().seenAt;
    const merged = { ...stored, ...current };
    useWorkbench.setState({ seenAt: merged });
    // A markSeen before hydration already saved its own (partial) map to disk —
    // merge back in what hydration just found, or the rest of it is missing from
    // disk until the next markSeen happens to save again.
    if (Object.keys(current).length > 0) void saveSeen(merged).catch(() => {});
  })
  // storage failure = everything reads unread once, acceptable
  .catch(() => {});

// sessions.pending returns one flat list across all sessions; the store keys
// approvals by session.
const bySession = (approvals: Approval[]): Record<string, Approval[]> => {
  const out: Record<string, Approval[]> = {};
  for (const a of approvals) (out[a.sessionId] ??= []).push(a);
  return out;
};

// The answer for one tool, dropped into the list in place. Never appends: the
// daemon's list is every declared spec, and a name that is not already there
// came from a tools.json the phone has not re-read yet.
const replaceTool = (tools: ToolStatus[], next: ToolStatus): ToolStatus[] =>
  tools.map((t) => (t.name === next.name ? next : t));

const dropWhere = <T>(map: Record<string, T | undefined>, drop: (id: string) => boolean): Record<string, T | undefined> =>
  Object.fromEntries(Object.entries(map).filter(([id]) => !drop(id)));

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
