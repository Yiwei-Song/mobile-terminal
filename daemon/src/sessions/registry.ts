import type { SessionEvent } from "../protocol.js";
import { ClaudeSession, type ClaudeDeps } from "./claude.js";
import type { Manifest, ManifestEntry } from "./manifest.js";

type StatusEvent = Extract<SessionEvent, { kind: "session.status" }>;

// Wires the WS methods to running CLI processes and the on-disk manifest.
export class Registry {
  private readonly live = new Map<string, ClaudeSession>();
  // Keyed by the SDK's requestId. The session is kept alongside so a dying one
  // can settle its own outstanding prompts without touching anyone else's.
  private readonly pending = new Map<string, { session: ClaudeSession; resolve: (allow: boolean) => void }>();

  constructor(
    private readonly deps: ClaudeDeps,
    private readonly manifest: Manifest,
    private readonly push: (e: SessionEvent) => void,
  ) {}

  // Throwing is the error channel: startServer turns it into { ok: false, error }.
  async handle(method: string, params: any): Promise<unknown> {
    switch (method) {
      case "sessions.list":
        return this.manifest.list();

      case "sessions.new": {
        const s = this.start({ cwd: params.cwd, prompt: params.prompt, title: params.title });
        // Rejects if the CLI died before `system.init`, which is exactly the
        // answer the phone needs — there is no session to talk to.
        return { sessionId: await s.id };
      }

      case "sessions.send": {
        const live = this.live.get(params.sessionId);
        if (live) {
          live.send(params.text);
          return {};
        }
        // Stopped but known: restart the CLI with --resume and let the text be
        // the prompt. Awaited so a second send finds it live instead of
        // starting a duplicate. Plan 5's boot-resume calls this same path.
        const prev = this.entry(params.sessionId);
        await this.start({ cwd: prev.cwd, prompt: params.text, title: prev.title, resume: prev.sessionId }).id;
        return {};
      }

      case "sessions.interrupt": {
        const live = this.live.get(params.sessionId);
        // A stopped session has no turn to stop; only a wholly unknown id errors.
        if (live) live.interrupt();
        else this.entry(params.sessionId);
        return {};
      }

      case "sessions.approve": {
        if (!this.live.has(params.sessionId)) this.entry(params.sessionId);
        const p = this.pending.get(params.requestId);
        this.pending.delete(params.requestId);
        // ponytail: a duplicate or late approve (phone retried, session already
        // gone) has nothing to resolve and is not worth an error.
        p?.resolve(params.allow);
        return {};
      }

      default:
        throw new Error(`unknown method: ${method}`);
    }
  }

  private entry(sessionId: string): ManifestEntry {
    const e = this.manifest.list().find((x) => x.sessionId === sessionId);
    if (!e) throw new Error("unknown session");
    return e;
  }

  private start(o: { cwd: string; prompt: string; title?: string; resume?: string }): ClaudeSession {
    // The row we own. On a fresh session the id only arrives with `system.init`,
    // so this — not the event — is what the manifest is keyed by.
    const entry: ManifestEntry = {
      sessionId: o.resume ?? "",
      agent: "claude",
      cwd: o.cwd,
      title: "",
      status: "running",
      updatedAt: "",
    };
    // Assigned before any event can fire: ClaudeSession emits nothing
    // synchronously from its constructor.
    let session!: ClaudeSession;
    session = ClaudeSession.start(this.deps, {
      cwd: o.cwd,
      prompt: o.prompt,
      title: o.title,
      resume: o.resume,
      onEvent: (e) => {
        if (e.kind === "session.status") this.record(entry, e, session);
        this.push(e);
      },
      // Async, not a sync closure: a throw here would escape the adapter's
      // .catch on the permission promise and reach the SDK.
      askPermission: async (req) =>
        new Promise<boolean>((resolve) => this.pending.set(req.requestId, { session, resolve })),
    });
    // On resume the id is known up front, so claim it now — a concurrent send
    // must not start a second CLI for the same session.
    if (o.resume) this.live.set(o.resume, session);

    void session.done
      // Rejects on a crash *and* on a deliberate close(); either way the adapter
      // has already emitted `dead`, so there is nothing extra to report.
      .catch(() => {})
      .then(() => {
        session.close();
        if (this.live.get(entry.sessionId) === session) this.live.delete(entry.sessionId);
        for (const [id, p] of this.pending) {
          if (p.session !== session) continue;
          this.pending.delete(id);
          // The CLI is gone; leaving the resolver would hang canUseTool forever.
          p.resolve(false);
        }
      });
    return session;
  }

  private record(entry: ManifestEntry, e: StatusEvent, session: ClaudeSession): void {
    // A terminal event can carry an empty id (the CLI died before `system.init`),
    // so adopt the event's id only when it actually has one.
    if (e.sessionId && e.sessionId !== entry.sessionId) {
      // A resume can come back under a fresh id (the CLI forked the transcript).
      // Drop the old key or the manifest keeps a row the phone can never resume
      // and the live map keeps a handle nothing will ever delete.
      if (entry.sessionId) {
        this.manifest.remove(entry.sessionId);
        if (this.live.get(entry.sessionId) === session) this.live.delete(entry.sessionId);
      }
      entry.sessionId = e.sessionId;
      this.live.set(e.sessionId, session);
    }
    // The adapter already truncated this to the prompt's first line, 60 chars.
    entry.title = e.title;
    entry.status = e.status;
    entry.updatedAt = new Date().toISOString();
    // Nothing worth persisting for a session that never had an id: boot-resume
    // would only try to resume a session the CLI never created.
    if (entry.sessionId) this.manifest.upsert({ ...entry });
  }
}
