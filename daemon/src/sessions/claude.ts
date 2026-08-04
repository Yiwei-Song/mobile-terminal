import { randomUUID } from "node:crypto";
import type { CanUseTool, Query, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { SessionEvent, SessionStatus } from "../protocol.js";

// The SDK is injected so tests never spawn the real CLI.
export interface ClaudeDeps {
  query: typeof import("@anthropic-ai/claude-agent-sdk").query;
}

export interface StartOpts {
  cwd: string;
  prompt: string;
  resume?: string;
  // Display name for status events. Defaults to the first line of the prompt so
  // the caller can ignore it; `sessions.new` accepts one, so it can also pass through.
  title?: string;
  onEvent: (e: SessionEvent) => void;
  askPermission: (req: { requestId: string; toolName: string; summary: string; cwd: string }) => Promise<boolean>;
}

export class ClaudeSession {
  readonly id: Promise<string>;
  readonly done: Promise<void>;

  private readonly opts: StartOpts;
  private readonly title: string;
  private readonly q: Query;
  private sid: string;
  private inbox: SDKUserMessage[] = [];
  private wake: (() => void) | null = null;
  private closed = false;
  private pending = 0;
  // Once dead, nothing may report the session as alive again — a permission
  // answered after the CLI is gone would otherwise emit `running`.
  private terminal = false;

  static start(deps: ClaudeDeps, opts: StartOpts): ClaudeSession {
    return new ClaudeSession(deps, opts);
  }

  private constructor(deps: ClaudeDeps, opts: StartOpts) {
    this.opts = opts;
    this.title = titleOf(opts.title ?? opts.prompt);
    // On resume the id is known before the SDK confirms it, so events emitted
    // before `system.init` still carry the right session.
    this.sid = opts.resume ?? "";

    let settleId!: (id: string) => void;
    let failId!: (e: unknown) => void;
    this.id = new Promise<string>((res, rej) => {
      settleId = res;
      failId = rej;
    });
    // Nobody may be awaiting id/done at the moment they reject (the registry
    // awaits id, but a fast failure can beat it). An unhandled rejection would
    // take the whole daemon down, so keep a no-op handler on both.
    this.id.catch(() => {});

    this.send(opts.prompt);
    this.q = deps.query({
      prompt: this.input(),
      options: {
        cwd: opts.cwd,
        resume: opts.resume,
        canUseTool: this.permission(),
        includePartialMessages: false,
        // No `settingSources`: the SDK default loads the user's own settings
        // (CLAUDE.md, MCP servers, hooks, permissions). An allowlisted tool
        // skipping phone approval is the user's configured intent on their own
        // machine; the daemon itself adds no bypass.
      },
    });
    this.done = this.pump(settleId, failId);
    this.done.catch(() => {});
  }

  // Queue a user message. The SDK drains `input()`, so this works mid-session.
  send(text: string): void {
    this.inbox.push({
      type: "user",
      message: { role: "user", content: text },
      parent_tool_use_id: null,
      // This is keyboard input from the phone. Hosts must stamp it: an absent
      // origin is unattributed and fails closed at the SDK's trust gates.
      origin: { kind: "human" },
    });
    this.wake?.();
    this.wake = null;
  }

  interrupt(): void {
    // Streaming-input control request; rejects if nothing is running, which is
    // not worth killing the session over.
    void this.q.interrupt().catch(() => {});
  }

  // Ends the input stream and tears down the query. Without it a session
  // outlives the daemon's interest in it — interrupt() only stops a turn.
  close(): void {
    this.closed = true;
    this.wake?.();
    this.wake = null;
    this.q.close?.(); // optional-called: test fakes are bare generators
  }

  // ponytail: array + single waiter, not a channel library. One producer
  // (send) and one consumer (the SDK) is all this ever has.
  private async *input(): AsyncGenerator<SDKUserMessage> {
    for (;;) {
      while (this.inbox.length > 0) yield this.inbox.shift()!;
      if (this.closed) return;
      await new Promise<void>((r) => {
        this.wake = r;
      });
    }
  }

  private permission(): CanUseTool {
    return async (toolName, input, o) => {
      // The SDK's control-request id is already unique per prompt; only invent
      // one if a caller (or an older CLI) omits it.
      const requestId = o?.requestId ?? randomUUID();
      const summary = summarize(toolName, input);
      const cwd = this.opts.cwd;
      // Claude asks for several tools at once, so count outstanding prompts:
      // answering one must not report "running" while others still block.
      this.pending++;
      this.status("waiting_on_user");
      this.emit({ kind: "session.permission", sessionId: this.sid, requestId, toolName, summary, cwd });
      try {
        // A lost phone connection denies; it must never throw into the SDK.
        const allow = await this.opts.askPermission({ requestId, toolName, summary, cwd }).catch(() => false);
        return allow ? { behavior: "allow", updatedInput: input } : { behavior: "deny", message: "Denied from phone" };
      } finally {
        if (--this.pending === 0) this.status("running");
      }
    };
  }

  private async pump(settleId: (id: string) => void, failId: (e: unknown) => void): Promise<void> {
    try {
      for await (const m of this.q) {
        if (m.type === "system" && m.subtype === "init") {
          this.sid = m.session_id;
          settleId(m.session_id);
          this.status("running");
        } else if (m.type === "assistant") {
          for (const b of m.message.content) {
            if (b.type === "text") {
              if (b.text) this.emit({ kind: "session.text", sessionId: this.sid, role: "assistant", text: b.text });
            } else if (b.type === "tool_use") {
              const summary = summarize(b.name, b.input as Record<string, unknown>);
              this.emit({ kind: "session.tool", sessionId: this.sid, name: b.name, summary });
            }
          }
        } else if (m.type === "result") {
          this.emit({
            kind: "session.done",
            sessionId: this.sid,
            ok: m.subtype === "success",
            costUsd: m.total_cost_usd,
          });
          this.status("idle");
        }
      }
    } catch (e) {
      this.status("dead");
      failId(e);
      throw e;
    }
    // The stream only ends when the CLI is gone, so the session is over even if
    // it never sent a result (killed, transport dropped, close()). Without this
    // the manifest would sit at `running` forever.
    this.status("dead");
    // No-op once init has settled it; otherwise the CLI died quietly and an
    // awaited `id` would hang forever.
    failId(new Error("claude session ended before reporting a session id"));
  }

  private emit(e: SessionEvent): void {
    this.opts.onEvent(e);
  }

  // `dead` is the only one-way status: `idle` is per-turn and a later turn
  // legitimately goes back to running.
  private status(status: SessionStatus): void {
    if (this.terminal) return;
    this.terminal = status === "dead";
    this.emit({ kind: "session.status", sessionId: this.sid, status, title: this.title });
  }
}

// Tool name plus the field a human actually reads on a phone. Exported so the
// on-disk transcript reader renders a replayed tool call exactly like a live
// one — two summarizers would drift, and the difference would show as history
// that looks subtly unlike the session it belongs to.
export const summarize = (name: string, input: Record<string, unknown>): string => {
  const key = input?.["command"] ?? input?.["file_path"];
  return `${name}: ${typeof key === "string" ? key : JSON.stringify(input ?? {}).slice(0, 200)}`;
};

const titleOf = (s: string): string => s.trim().split(/\r?\n/)[0]!.slice(0, 60) || "session";
