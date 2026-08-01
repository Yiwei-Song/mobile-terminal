import { hostname } from "node:os";
import type { ConfigInfo, PermissionEvent, PushEvent, SessionEvent } from "../protocol.js";
import { setNtfyTopic, type Config } from "../config.js";
import { VERSION } from "../version.js";
import { snapshot, topProcesses, killProcess, type SystemDeps } from "../system.js";
import { KeepAwake, lockWorkstation, displayOff, reboot, abortReboot, type PowerDeps } from "../power.js";
import type { PtyManager } from "../term.js";
import { allowedRoots, list as listDir, read as readFile, gitStatus, gitDiff, type Exec } from "../files.js";
import { listeningPorts } from "../ports.js";
import { ClaudeSession, type ClaudeDeps } from "./claude.js";
import type { Manifest, ManifestEntry } from "./manifest.js";

type StatusEvent = Extract<SessionEvent, { kind: "session.status" }>;

// The daemon-owned singletons the system.*/power.*/term.* RPCs act on. Bundled
// into one ctor arg (not four) so the registry's signature stays readable;
// injected so tests drive real snapshot/lock/reboot code with fake si +
// spawn/exec, and the real PtyManager over a fake pty.
// ponytail: PtyManager rides here rather than as a sixth ctor parameter — it is
// exactly what this bag already is (a host-level singleton a handler acts on),
// so every existing construction site keeps its shape.
export interface MachineDeps {
  system: SystemDeps; // { si } for metrics/processes
  keepAwake: KeepAwake; // the one keep-awake hold the daemon holds while it runs
  power: PowerDeps; // { spawn, exec } for lock/displayOff/reboot
  pty: PtyManager; // the live terminals; its onData/onExit push term.* events
  // ponytail: git/netstat ride here rather than a second deps bag — this bag is
  // already "the host-level things a handler acts on". Deliberately NOT
  // power.exec: that one is string-based (a shell), and these commands take a
  // filename that came off the wire. See files.ts's Exec.
  execFile: Exec;
}

// shutdown /r wants whole seconds; 5..120 keeps a fat-fingered 0 from rebooting
// now and a bogus huge value from parking the machine for a day. NaN (can't come
// off the wire, but a direct caller could) floors to 5.
export const clampRebootDelay = (s: number): number =>
  Number.isFinite(s) ? Math.min(120, Math.max(5, Math.round(s))) : 5;

// Wires the WS methods to running CLI processes and the on-disk manifest.
export class Registry {
  private readonly live = new Map<string, ClaudeSession>();
  // Keyed by `${sessionId}:${requestId}`: two sessions are two CLI processes and
  // can hand out the same requestId, so the bare id would let the second prompt
  // overwrite the first's resolver — and let an approve answer the wrong session.
  // The session is kept alongside so a dying one can settle its own outstanding
  // prompts without touching anyone else's. The event is the full payload the
  // phone first saw — kept so sessions.pending can re-deliver it after a
  // reconnect, since the push only fires once.
  private readonly pending = new Map<string, { session: ClaudeSession; event: PermissionEvent; resolve: (allow: boolean) => void }>();

  constructor(
    private readonly deps: ClaudeDeps,
    private readonly manifest: Manifest,
    private readonly push: (e: PushEvent) => void,
    // ponytail: config lives here because the registry already *is* the server's
    // request handler and config.* is two lines. A second handler object (and
    // the composition in index.ts) would be more wiring than it answers. Same
    // reasoning extends system.*/power.* — one dispatch, one place to test.
    private readonly cfg: Config,
    private readonly machine: MachineDeps,
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
        const sessionId = await s.id;
        this.echo(sessionId, params.prompt);
        return { sessionId };
      }

      case "sessions.send": {
        const live = this.live.get(params.sessionId);
        if (live) {
          live.send(params.text);
          this.echo(params.sessionId, params.text);
          return {};
        }
        // Stopped but known: restart the CLI with --resume and let the text be
        // the prompt. Awaited so a second send finds it live instead of
        // starting a duplicate. Plan 5's boot-resume calls this same path.
        const prev = this.entry(params.sessionId);
        // The resume can come back under a forked id, so echo the id the CLI
        // actually reported — not the one the phone asked for.
        this.echo(await this.start({ cwd: prev.cwd, prompt: params.text, title: prev.title, resume: prev.sessionId }).id, params.text);
        return {};
      }

      case "config.get":
        return this.configInfo();

      case "config.set":
        setNtfyTopic(this.cfg, params.ntfyTopic);
        return this.configInfo();

      case "sessions.interrupt": {
        const live = this.live.get(params.sessionId);
        // A stopped session has no turn to stop; only a wholly unknown id errors.
        if (live) live.interrupt();
        else this.entry(params.sessionId);
        return {};
      }

      case "sessions.approve": {
        if (!this.live.has(params.sessionId)) this.entry(params.sessionId);
        // The composite key is what binds the answer to the session that asked:
        // a requestId from another session simply does not match.
        const key = `${params.sessionId}:${params.requestId}`;
        const p = this.pending.get(key);
        this.pending.delete(key);
        // ponytail: a duplicate or late approve (phone retried, session already
        // gone) has nothing to resolve and is not worth an error.
        // `=== true`: anything else off the wire denies rather than approving.
        p?.resolve(params.allow === true);
        return {};
      }

      case "sessions.pending":
        // The push that carried these fired once. A phone that reconnects (or
        // reopens from a notification) asks here so the approval card reappears.
        return [...this.pending.values()].map((p) => p.event);

      case "system.metrics":
        return snapshot(this.machine.system);

      case "system.processes":
        return topProcesses(this.machine.system);

      case "system.kill":
        // Its own {ok,error?} is the answer — a refused/failed kill is data the
        // phone shows, not an RPC error.
        return killProcess(params.pid);

      case "power.state":
        return this.powerState();

      case "power.keepAwake":
        if (params.on) this.machine.keepAwake.start();
        else this.machine.keepAwake.stop();
        return this.powerState();

      case "power.lock":
        await lockWorkstation(this.machine.power);
        // Display-off is a best-effort follow-on: a monitor that won't turn off
        // must not report the lock — which did happen — as a failure.
        await displayOff(this.machine.power).catch(() => {});
        return { ok: true };

      case "power.reboot": {
        const delaySec = clampRebootDelay(params.delaySec);
        await reboot(this.machine.power, delaySec);
        // Only after the schedule takes: the countdown the app shows must match a
        // reboot that is actually pending, not one the shutdown call rejected.
        this.push({ kind: "machine.reboot", delaySec });
        return { ok: true };
      }

      case "power.abortReboot":
        await abortReboot(this.machine.power);
        return { ok: true };

      case "term.list":
        return this.machine.pty.list();

      case "term.create":
        return this.machine.pty.create({ cwd: params.cwd, cols: params.cols, rows: params.rows });

      // write/resize/kill are no-ops on an id that just exited — the manager
      // decided that, and it is the right answer for ids that come off the wire.
      case "term.write":
        this.machine.pty.write(params.termId, params.data);
        return {};

      case "term.resize":
        this.machine.pty.resize(params.termId, params.cols, params.rows);
        return {};

      case "term.kill":
        this.machine.pty.kill(params.termId);
        return {};

      case "term.scrollback":
        return { data: this.machine.pty.scrollback(params.termId) };

      // Everything below refuses a path outside the roots by throwing, which
      // startServer turns into { ok: false, error: "outside allowed roots" }.
      case "files.roots":
        return this.roots();

      case "files.list":
        return listDir(params.dir, this.roots());

      case "files.read":
        return readFile(params.path, this.roots());

      case "git.status":
        return gitStatus(params.cwd, this.roots(), this.machine.execFile);

      case "git.diff":
        return { diff: await gitDiff(params.cwd, this.roots(), this.machine.execFile, params.file) };

      case "ports.list":
        return listeningPorts(this.machine.execFile);

      default:
        throw new Error(`unknown method: ${method}`);
    }
  }

  // The transcript is only assembled from pushed events, so text nobody echoes
  // is text a second phone never sees. Broadcast, so the sender gets it back
  // too — de-duping its own optimistic line is the client's business.
  // Ordering: callers await the CLI's real session id before echoing, so an
  // assistant event could in theory be pushed ahead of the prompt that caused
  // it. Accepted — the CLI reads the prompt before it replies, so the window is
  // the id round-trip and nothing has been observed landing inside it.
  private echo(sessionId: string, text: string): void {
    this.push({ kind: "session.text", sessionId, role: "user", text });
  }

  // ntfyTopic may be absent from a hand-edited config.json; the wire type says
  // string | null, so normalize rather than send undefined (which JSON drops).
  private configInfo(): ConfigInfo {
    return { ntfyTopic: this.cfg.ntfyTopic ?? null, version: VERSION, hostname: hostname() };
  }

  // ecoMode is always false for this plan: keepAwake is a manual on/off hold.
  // The session-aware "release when nothing is running" mode is a follow-up.
  private powerState(): { keepAwake: boolean; ecoMode: boolean } {
    return { keepAwake: this.machine.keepAwake.active, ecoMode: false };
  }

  // Recomputed per request, not cached: a session started a second ago must be
  // browsable now, and a removed one must stop being reachable immediately.
  private roots(): string[] {
    return allowedRoots(this.cfg, this.manifest.list().map((s) => s.cwd));
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
      // `entry.sessionId` is already resolved here: a permission can only fire
      // after the CLI reported its id (or was resumed under a known one).
      askPermission: async (req) =>
        new Promise<boolean>((resolve) =>
          this.pending.set(`${entry.sessionId}:${req.requestId}`, {
            session,
            event: { kind: "session.permission", sessionId: entry.sessionId, ...req },
            resolve,
          }),
        ),
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
