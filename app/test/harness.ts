import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect } from "vitest";

import { loadConfig } from "../../daemon/src/config.js";
import { startServer } from "../../daemon/src/server.js";
import type { PushEvent } from "../../daemon/src/protocol.js";
import { Manifest } from "../../daemon/src/sessions/manifest.js";
import { Registry } from "../../daemon/src/sessions/registry.js";
import type { ClaudeDeps } from "../../daemon/src/sessions/claude.js";
import { init, fakeMachine } from "../../daemon/test/fixtures.js";

// The real daemon, in process. Nothing here is a mock of the server or the
// registry — only the Claude CLI itself is faked, exactly as the daemon's own
// tests fake it. A client test that passes against a stub server would prove
// nothing about the protocol both sides actually speak.

// The slice of the SDK's query() shape the daemon actually uses. Declared here
// rather than imported: @anthropic-ai/claude-agent-sdk lives in daemon's
// node_modules, which a file under app/ cannot resolve.
export interface FakeArgs {
  prompt: AsyncIterable<{ message: { content: string } }>;
  options: {
    cwd: string;
    resume?: string;
    canUseTool: (
      name: string,
      input: Record<string, unknown>,
      o: { requestId: string },
    ) => Promise<{ behavior: string }>;
  };
}
export type FakeQuery = (a: FakeArgs) => AsyncIterable<unknown>;

export interface Daemon {
  port: number;
  token: string;
  url: string;
  dir: string;
  /** The fakes behind the daemon: canned si, recorded command lines, execOut
   *  stubs for netstat/tasklist/git, and the real ToolRunner over a fake spawn. */
  fm: ReturnType<typeof fakeMachine>;
  close(): Promise<void>;
}

export async function startDaemon(query: FakeQuery, opts: { dir?: string; port?: number } = {}): Promise<Daemon> {
  const dir = opts.dir ?? mkdtempSync(join(tmpdir(), "wb-app-"));
  const cfg = { ...loadConfig(dir), port: opts.port ?? 0 };
  const manifest = new Manifest(dir);
  // Same knot index.ts has: the registry is the server's handler, so it exists
  // before the push it broadcasts through does.
  let pushRef: (e: PushEvent) => void = () => {};
  const fm = fakeMachine();
  const registry = new Registry({ query } as unknown as ClaudeDeps, manifest, (e) => pushRef(e), cfg, fm.machine);
  const srv = await startServer(cfg, (method, params, push) => {
    pushRef = push;
    return registry.handle(method, params);
  });
  return { port: srv.port, token: cfg.token, url: `ws://127.0.0.1:${srv.port}/ws`, dir, fm, close: srv.close };
}

// Real sockets and a real event loop: assertions wait for the condition instead
// of guessing how many ticks it takes to cross a loopback connection.
export async function until(what: string, fn: () => boolean): Promise<void> {
  for (let i = 0; i < 600 && !fn(); i++) await new Promise((r) => setTimeout(r, 5));
  expect(fn(), what).toBe(true);
}

// A CLI that starts and then sits there — enough for anything that only needs a
// session to exist. Later calls get fresh ids so a test can hold two sessions.
export const idle = (): FakeQuery => {
  let n = 0;
  return () =>
    (async function* () {
      yield { ...init, session_id: `s${++n}` };
      await new Promise<void>(() => {});
    })();
};
