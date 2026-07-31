# Daemon Core (Plan 1 of 6) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Windows daemon (Node/TypeScript console app for now) that serves an authenticated WebSocket API and can create, resume, stream, and approve Claude Code sessions — verified end-to-end from a debug web page.

**Architecture:** Single Node process. One WebSocket endpoint carries a JSON request/response + server-push-event protocol. A session manifest (JSON file) tracks active sessions for later reboot-resume. Claude sessions run through the official `@anthropic-ai/claude-agent-sdk` (never TUI-scraping); permission requests surface as protocol events and block on the phone's (or debug page's) answer.

**Tech Stack:** Node ≥20, TypeScript, `ws`, `@anthropic-ai/claude-agent-sdk`, `vitest`, `qrcode-terminal`. No Express, no ORM, no DI framework.

**Later plans (context only, do not build now):** 2 Android app MVP · 3 Codex via app-server · 4 Terminal/files/diffs/preview/dev-tools · 5 System monitor + power + boot-resume · 6 Polish.

## Global Constraints

- Repo root: `D:\Mobile-access`. Daemon lives in `daemon/`. Monorepo-by-folders, no workspaces tooling.
- TypeScript strict mode. ESM (`"type": "module"`).
- All state under `%APPDATA%\workbench\` (`config.json`, `sessions.json`). Never hardcode a user path; resolve via `process.env.APPDATA`.
- Every WS message is one JSON object. Protocol types live ONLY in `daemon/src/protocol.ts`.
- Auth: every connection must present the pairing token before anything else; wrong/missing token → socket closed with code 4001.
- No auto-approve anywhere. Every tool-permission request goes to the client. (Claude Code settings on this machine may allowlist tools; the daemon itself never bypasses.)
- ToS note: the Agent SDK runs with whatever auth the local Claude Code has. If that's a claude.ai subscription login, this sits in the same personal-use gray zone as Happy/CC-Pocket; an Anthropic API key is the fully-clean path. Owner's call, already made — build proceeds.
- Windows host, PowerShell commands in steps. Tests must not require a real Claude login (SDK is mocked in unit tests; one separate smoke script uses the real thing).
- Commit after every task. Messages end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

## File Structure

```
daemon/
  package.json / tsconfig.json / vitest.config.ts
  src/
    index.ts            entry: load config, print QR, start server
    config.ts           config + pairing token (create on first run)
    protocol.ts         all message types + helpers (single source of truth)
    server.ts           http+ws server, auth handshake, request routing
    notify.ts           ntfy push (fire-and-forget)
    sessions/
      manifest.ts       manifest store (sessions.json)
      claude.ts         ClaudeSession adapter over the Agent SDK
      registry.ts       in-memory registry: id → live session, wires protocol ⇄ adapter
  test/
    config.test.ts  protocol.test.ts  manifest.test.ts  server.test.ts  registry.test.ts
  debug/index.html      zero-build debug client (plain JS, mobile-viewport)
  scripts/smoke.ts      real-SDK smoke: new session → prompt → resume
```

---

### Task 1: Repo + project scaffold

**Files:**
- Create: `.gitignore`, `daemon/package.json`, `daemon/tsconfig.json`, `daemon/vitest.config.ts`, `daemon/src/version.ts`, `daemon/test/scaffold.test.ts`

**Interfaces:**
- Produces: working `npm test` / `npm run build` inside `daemon/`; git repo at `D:\Mobile-access`.

- [ ] **Step 1: git init at repo root** (repo doesn't exist yet)

Run in `D:\Mobile-access`:
```powershell
git init -b main
```

- [ ] **Step 2: Write `.gitignore`** (repo root)

```gitignore
node_modules/
dist/
*.log
.env
```

- [ ] **Step 3: Scaffold the daemon package**

`daemon/package.json`:
```json
{
  "name": "workbench-daemon",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx src/index.ts",
    "build": "tsc -p .",
    "test": "vitest run",
    "smoke": "tsx scripts/smoke.ts"
  }
}
```

`daemon/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "outDir": "dist",
    "skipLibCheck": true,
    "types": ["node"]
  },
  "include": ["src"]
}
```

`daemon/vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
export default defineConfig({ test: { environment: "node" } });
```

Install (run in `daemon/`):
```powershell
npm i ws @anthropic-ai/claude-agent-sdk qrcode-terminal
npm i -D typescript tsx vitest @types/node @types/ws
```

- [ ] **Step 4: Write a trivial failing test** — `daemon/test/scaffold.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { VERSION } from "../src/version.js";

describe("scaffold", () => {
  it("exports a version", () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
```

Run: `npm test` → FAIL (version.ts missing).

- [ ] **Step 5: Make it pass** — `daemon/src/version.ts`

```ts
export const VERSION = "0.1.0";
```

Run: `npm test` → PASS.

- [ ] **Step 6: Commit**

```powershell
git add -A; git commit -m "chore: scaffold daemon package (ts, vitest, deps)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Config + pairing token

**Files:**
- Create: `daemon/src/config.ts`, `daemon/test/config.test.ts`

**Interfaces:**
- Produces: `loadConfig(dir?: string): Config` where `Config = { token: string; port: number; ntfyTopic: string | null; dataDir: string }`. Creates `config.json` with a fresh 32-byte-hex `token` and `port: 8790` on first run; idempotent afterwards. `dataDir` defaults to `path.join(process.env.APPDATA!, "workbench")`; the optional `dir` param exists so tests use a temp dir.

- [ ] **Step 1: Failing test** — `daemon/test/config.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config.js";

describe("config", () => {
  it("creates config with a 64-hex token on first run and reloads the same one", () => {
    const dir = mkdtempSync(join(tmpdir(), "wb-"));
    const a = loadConfig(dir);
    expect(a.token).toMatch(/^[0-9a-f]{64}$/);
    expect(a.port).toBe(8790);
    const onDisk = JSON.parse(readFileSync(join(dir, "config.json"), "utf8"));
    expect(onDisk.token).toBe(a.token);
    const b = loadConfig(dir);
    expect(b.token).toBe(a.token); // idempotent
  });
});
```

Run: `npx vitest run test/config.test.ts` → FAIL.

- [ ] **Step 2: Implement** — `daemon/src/config.ts`

```ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

export interface Config {
  token: string;
  port: number;
  ntfyTopic: string | null;
  dataDir: string;
}

export function loadConfig(dir?: string): Config {
  const dataDir = dir ?? join(process.env.APPDATA ?? ".", "workbench");
  mkdirSync(dataDir, { recursive: true });
  const file = join(dataDir, "config.json");
  if (!existsSync(file)) {
    const fresh = {
      token: randomBytes(32).toString("hex"),
      port: 8790,
      ntfyTopic: null,
    };
    writeFileSync(file, JSON.stringify(fresh, null, 2));
  }
  const raw = JSON.parse(readFileSync(file, "utf8"));
  return { ...raw, dataDir };
}
```

- [ ] **Step 3: Run test** → PASS. **Step 4: Commit** (`feat: config with pairing token`).

---

### Task 3: Protocol types

**Files:**
- Create: `daemon/src/protocol.ts`, `daemon/test/protocol.test.ts`

**Interfaces:**
- Produces (used by every later task — copy these names exactly):

```ts
// Client → daemon. Every request has a client-chosen id echoed in the response.
export type ClientMsg =
  | { type: "auth"; token: string }
  | { type: "req"; id: string; method: "sessions.list" }
  | { type: "req"; id: string; method: "sessions.new"; params: { cwd: string; prompt: string; title?: string } }
  | { type: "req"; id: string; method: "sessions.send"; params: { sessionId: string; text: string } }
  | { type: "req"; id: string; method: "sessions.interrupt"; params: { sessionId: string } }
  | { type: "req"; id: string; method: "sessions.approve"; params: { sessionId: string; requestId: string; allow: boolean } };

// Daemon → client.
export type ServerMsg =
  | { type: "auth.ok"; version: string }
  | { type: "res"; id: string; ok: true; data: unknown }
  | { type: "res"; id: string; ok: false; error: string }
  | { type: "event"; event: SessionEvent };

export type SessionStatus = "running" | "waiting_on_user" | "idle" | "dead";

export type SessionEvent =
  | { kind: "session.status"; sessionId: string; status: SessionStatus; title: string }
  | { kind: "session.text"; sessionId: string; role: "assistant" | "user"; text: string }
  | { kind: "session.tool"; sessionId: string; name: string; summary: string }
  | { kind: "session.permission"; sessionId: string; requestId: string; toolName: string; summary: string; cwd: string }
  | { kind: "session.done"; sessionId: string; ok: boolean; costUsd: number | null };

export function parseClientMsg(raw: string): ClientMsg | null; // null on malformed/unknown
```

- [ ] **Step 1: Failing test** — `daemon/test/protocol.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { parseClientMsg } from "../src/protocol.js";

describe("protocol", () => {
  it("parses a valid request", () => {
    const m = parseClientMsg(JSON.stringify({ type: "req", id: "1", method: "sessions.list" }));
    expect(m).toEqual({ type: "req", id: "1", method: "sessions.list" });
  });
  it("returns null on garbage, unknown method, and missing fields", () => {
    expect(parseClientMsg("not json")).toBeNull();
    expect(parseClientMsg(JSON.stringify({ type: "req", id: "1", method: "hack.everything" }))).toBeNull();
    expect(parseClientMsg(JSON.stringify({ type: "auth" }))).toBeNull();
  });
});
```

- [ ] **Step 2: Implement** — `daemon/src/protocol.ts`: the types above plus:

```ts
const METHODS = new Set([
  "sessions.list", "sessions.new", "sessions.send", "sessions.interrupt", "sessions.approve",
]);

export function parseClientMsg(raw: string): ClientMsg | null {
  let m: any;
  try { m = JSON.parse(raw); } catch { return null; }
  if (m?.type === "auth" && typeof m.token === "string") return m;
  if (m?.type === "req" && typeof m.id === "string" && METHODS.has(m.method)) return m;
  return null;
}
```

- [ ] **Step 3: Test passes.** **Step 4: Commit** (`feat: ws protocol types + parser`).

---

### Task 4: Session manifest store

**Files:**
- Create: `daemon/src/sessions/manifest.ts`, `daemon/test/manifest.test.ts`

**Interfaces:**
- Produces:

```ts
export interface ManifestEntry {
  sessionId: string;        // Agent SDK session id (also our public id)
  agent: "claude";          // "codex" added in Plan 3
  cwd: string;
  title: string;
  status: SessionStatus;    // from protocol.ts
  updatedAt: string;        // ISO
}
export class Manifest {
  constructor(dataDir: string);           // persists to <dataDir>/sessions.json
  upsert(e: ManifestEntry): void;         // write-through to disk
  remove(sessionId: string): void;
  list(): ManifestEntry[];                // sorted: waiting_on_user, running, idle, dead
}
```

- [ ] **Step 1: Failing test** — `daemon/test/manifest.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Manifest } from "../src/sessions/manifest.js";

const entry = (id: string, status: any) => ({
  sessionId: id, agent: "claude" as const, cwd: "C:\\proj", title: id, status, updatedAt: new Date().toISOString(),
});

describe("manifest", () => {
  it("persists across instances and sorts by attention", () => {
    const dir = mkdtempSync(join(tmpdir(), "wb-"));
    const m1 = new Manifest(dir);
    m1.upsert(entry("a", "idle"));
    m1.upsert(entry("b", "waiting_on_user"));
    m1.upsert(entry("c", "running"));
    const m2 = new Manifest(dir); // fresh instance reads disk
    expect(m2.list().map(e => e.sessionId)).toEqual(["b", "c", "a"]);
    m2.remove("b");
    expect(new Manifest(dir).list().map(e => e.sessionId)).toEqual(["c", "a"]);
  });
});
```

- [ ] **Step 2: Implement** — `daemon/src/sessions/manifest.ts`

```ts
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { SessionStatus } from "../protocol.js";

export interface ManifestEntry {
  sessionId: string; agent: "claude"; cwd: string; title: string;
  status: SessionStatus; updatedAt: string;
}

const ORDER: SessionStatus[] = ["waiting_on_user", "running", "idle", "dead"];

export class Manifest {
  private file: string;
  private entries = new Map<string, ManifestEntry>();
  constructor(dataDir: string) {
    this.file = join(dataDir, "sessions.json");
    if (existsSync(this.file)) {
      for (const e of JSON.parse(readFileSync(this.file, "utf8")) as ManifestEntry[])
        this.entries.set(e.sessionId, e);
    }
  }
  private flush() { writeFileSync(this.file, JSON.stringify([...this.entries.values()], null, 2)); }
  upsert(e: ManifestEntry) { this.entries.set(e.sessionId, e); this.flush(); }
  remove(id: string) { this.entries.delete(id); this.flush(); }
  list(): ManifestEntry[] {
    return [...this.entries.values()].sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status));
  }
}
```

- [ ] **Step 3: Test passes.** **Step 4: Commit** (`feat: session manifest store`).

---

### Task 5: WS server with auth handshake

**Files:**
- Create: `daemon/src/server.ts`, `daemon/test/server.test.ts`

**Interfaces:**
- Consumes: `Config` (Task 2), `parseClientMsg`/`ServerMsg` (Task 3), `VERSION` (Task 1).
- Produces:

```ts
export type RequestHandler = (
  method: string, params: any, push: (e: SessionEvent) => void
) => Promise<unknown>; // throw Error → { ok:false, error: message }

export function startServer(cfg: Config, handler: RequestHandler): Promise<{ close(): Promise<void>; port: number }>;
// Behavior: http server + ws on "/ws". First message must be {type:"auth",token}.
// Wrong token → close(4001). Right → send {type:"auth.ok",version}. Then route "req"
// messages through handler; push() broadcasts an event to ALL authed sockets.
// Also serves debug/index.html at "/" (plain static, no framework).
```

- [ ] **Step 1: Failing test** — `daemon/test/server.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import { loadConfig } from "../src/config.js";
import { startServer } from "../src/server.js";

const open = (port: number) => new WebSocket(`ws://127.0.0.1:${port}/ws`);
const next = (ws: WebSocket) => new Promise<any>(r => ws.once("message", d => r(JSON.parse(d.toString()))));

describe("server", () => {
  it("rejects bad token with 4001, accepts good token, routes requests", async () => {
    const cfg = { ...loadConfig(mkdtempSync(join(tmpdir(), "wb-"))), port: 0 };
    const srv = await startServer(cfg, async (method) => {
      if (method === "sessions.list") return ["stub"];
      throw new Error("unknown");
    });

    const bad = open(srv.port);
    await new Promise(r => bad.once("open", r));
    bad.send(JSON.stringify({ type: "auth", token: "wrong" }));
    const code = await new Promise<number>(r => bad.once("close", c => r(c)));
    expect(code).toBe(4001);

    const good = open(srv.port);
    await new Promise(r => good.once("open", r));
    good.send(JSON.stringify({ type: "auth", token: cfg.token }));
    expect((await next(good)).type).toBe("auth.ok");
    good.send(JSON.stringify({ type: "req", id: "7", method: "sessions.list" }));
    expect(await next(good)).toEqual({ type: "res", id: "7", ok: true, data: ["stub"] });
    good.close();
    await srv.close();
  });
});
```

- [ ] **Step 2: Implement** — `daemon/src/server.ts`

```ts
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, WebSocket } from "ws";
import type { Config } from "./config.js";
import { parseClientMsg, type ServerMsg, type SessionEvent } from "./protocol.js";
import { VERSION } from "./version.js";

export type RequestHandler = (method: string, params: any, push: (e: SessionEvent) => void) => Promise<unknown>;

export function startServer(cfg: Config, handler: RequestHandler) {
  const debugHtml = join(dirname(fileURLToPath(import.meta.url)), "..", "debug", "index.html");
  const authed = new Set<WebSocket>();
  const push = (event: SessionEvent) => {
    const msg = JSON.stringify({ type: "event", event } satisfies ServerMsg);
    for (const ws of authed) if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  };

  const http = createServer((req, res) => {
    if (req.url === "/") { res.setHeader("content-type", "text/html"); res.end(readFileSync(debugHtml)); }
    else { res.statusCode = 404; res.end(); }
  });
  const wss = new WebSocketServer({ server: http, path: "/ws" });

  wss.on("connection", (ws) => {
    ws.once("message", (raw) => {
      const m = parseClientMsg(raw.toString());
      if (m?.type !== "auth" || m.token !== cfg.token) return ws.close(4001, "unauthorized");
      authed.add(ws);
      ws.on("close", () => authed.delete(ws));
      ws.send(JSON.stringify({ type: "auth.ok", version: VERSION } satisfies ServerMsg));
      ws.on("message", async (r) => {
        const msg = parseClientMsg(r.toString());
        if (msg?.type !== "req") return;
        try {
          const data = await handler(msg.method, (msg as any).params, push);
          ws.send(JSON.stringify({ type: "res", id: msg.id, ok: true, data } satisfies ServerMsg));
        } catch (e: any) {
          ws.send(JSON.stringify({ type: "res", id: msg.id, ok: false, error: String(e?.message ?? e) } satisfies ServerMsg));
        }
      });
    });
  });

  return new Promise<{ close(): Promise<void>; port: number }>((resolve) => {
    http.listen(cfg.port, "0.0.0.0", () => resolve({
      port: (http.address() as any).port,
      close: () => new Promise<void>((r) => { wss.close(); http.close(() => r()); }),
    }));
  });
}
```

Also create a placeholder `daemon/debug/index.html` (`<h1>debug page: Task 8</h1>`) so the static route works.

- [ ] **Step 3: Test passes.** **Step 4: Commit** (`feat: ws server with token auth`).

---

### Task 6: Claude session adapter

**Files:**
- Create: `daemon/src/sessions/claude.ts`, `daemon/test/claude.test.ts`

**Interfaces:**
- Consumes: `SessionEvent` (Task 3).
- Produces:

```ts
export interface ClaudeDeps {         // injected so tests never touch the real SDK
  query: typeof import("@anthropic-ai/claude-agent-sdk").query;
}
export interface StartOpts {
  cwd: string; prompt: string; resume?: string;
  onEvent: (e: SessionEvent) => void;
  askPermission: (req: { requestId: string; toolName: string; summary: string; cwd: string }) => Promise<boolean>;
}
export class ClaudeSession {
  static start(deps: ClaudeDeps, opts: StartOpts): ClaudeSession; // begins streaming immediately
  readonly id: Promise<string>;       // resolves once SDK reports session_id
  send(text: string): void;           // queue next user message (streaming input)
  interrupt(): void;
  readonly done: Promise<void>;
}
```

Implementation notes for the engineer (verify exact names against the installed SDK version — `node_modules/@anthropic-ai/claude-agent-sdk/README.md` has them):
- Use `query({ prompt: asyncIterableOfUserMessages, options })` (streaming-input mode) so `send()` works mid-session; keep an internal async queue that `send()` pushes into and the iterable drains.
- `options`: `{ cwd, resume, canUseTool, includePartialMessages: false }`.
- `canUseTool(toolName, input) => Promise<PermissionResult>`: build `requestId = randomUUID()`, `summary` = tool name + key input field (for `Bash` use `input.command`; for file tools use `input.file_path`; else `JSON.stringify(input).slice(0, 200)`), call `opts.askPermission`, map `true → { behavior: "allow", updatedInput: input }`, `false → { behavior: "deny", message: "Denied from phone" }`. Also emit `session.permission` event before asking and a `session.status: waiting_on_user` / back-to-`running` pair around it.
- Iterate SDK messages: `system.init` → resolve `id` (session_id) + emit `session.status running`; `assistant` text content → `session.text`; assistant `tool_use` blocks → `session.tool` (name + same summary rule); `result` → `session.done` (ok = subtype === "success", costUsd = total_cost_usd ?? null) then `session.status idle`.
- `interrupt()`: call the SDK's interrupt if exposed on the query object; otherwise abort via `AbortController` passed in options — check the installed SDK; wire whichever exists.
- Any thrown SDK error → `session.status dead` + rethrow into `done`.

- [ ] **Step 1: Failing test** — `daemon/test/claude.test.ts` (fake SDK)

```ts
import { describe, it, expect } from "vitest";
import { ClaudeSession } from "../src/sessions/claude.js";
import type { SessionEvent } from "../src/protocol.js";

function fakeQuery(script: any[]) {
  return (async function* () { for (const m of script) yield m; }) as any;
}

describe("ClaudeSession", () => {
  it("emits status, text, permission flow, and done", async () => {
    const events: SessionEvent[] = [];
    let permissionAsked = false;
    const deps = {
      query: ({ options }: any) => {
        // simulate: init → canUseTool round-trip → assistant text → result
        return (async function* () {
          yield { type: "system", subtype: "init", session_id: "s1" };
          const res = await options.canUseTool("Bash", { command: "echo hi" });
          expect(res.behavior).toBe("allow");
          yield { type: "assistant", message: { content: [{ type: "text", text: "done!" }] } };
          yield { type: "result", subtype: "success", total_cost_usd: 0.01 };
        })();
      },
    };
    const s = ClaudeSession.start(deps as any, {
      cwd: "C:\\proj", prompt: "hi",
      onEvent: (e) => events.push(e),
      askPermission: async () => { permissionAsked = true; return true; },
    });
    expect(await s.id).toBe("s1");
    await s.done;
    expect(permissionAsked).toBe(true);
    const kinds = events.map(e => e.kind);
    expect(kinds).toContain("session.permission");
    expect(kinds).toContain("session.text");
    expect(events.at(-1)).toMatchObject({ kind: "session.status", status: "idle" });
  });
});
```

- [ ] **Step 2: Implement `claude.ts`** per the notes above (~120 lines). **Step 3: Test passes.** **Step 4: Commit** (`feat: claude session adapter over agent sdk`).

---

### Task 7: Session registry (wires protocol ⇄ adapter ⇄ manifest)

**Files:**
- Create: `daemon/src/sessions/registry.ts`, `daemon/test/registry.test.ts`

**Interfaces:**
- Consumes: `ClaudeSession`/`ClaudeDeps` (Task 6), `Manifest` (Task 4), `SessionEvent` (Task 3).
- Produces:

```ts
export class Registry {
  constructor(deps: ClaudeDeps, manifest: Manifest, push: (e: SessionEvent) => void);
  // The RequestHandler for startServer:
  handle(method: string, params: any): Promise<unknown>;
  // sessions.list    → manifest.list()
  // sessions.new     → starts ClaudeSession, manifest.upsert on every status event, returns { sessionId }
  // sessions.send    → live session .send() ; if not live but in manifest → restart with resume: sessionId, then send
  // sessions.interrupt → live session .interrupt()
  // sessions.approve → resolves the pending askPermission promise matching requestId
}
```

Implementation notes: keep `Map<string, ClaudeSession>` (live) and `Map<string, (allow: boolean) => void>` (pending approvals keyed by requestId). `askPermission` stores the resolver and awaits; `sessions.approve` resolves it and deletes the key. Status events pass through to `push` AND update the manifest (title = first 60 chars of the first prompt). `sessions.send` to a dead/unknown id in the manifest triggers the resume path — this is also exactly what Plan 5's boot-resume will call.

- [ ] **Step 1: Failing test** — `daemon/test/registry.test.ts`: using the same fake-query technique as Task 6, drive: `sessions.new` → wait for permission event → `sessions.approve` (allow=false) → expect fake SDK received deny; `sessions.list` reflects manifest; `sessions.send` on unknown id throws `"unknown session"` when not in manifest. (Full test code mirrors Task 6's fake; ~50 lines.)
- [ ] **Step 2: Implement (~90 lines).** **Step 3: Tests pass.** **Step 4: Commit** (`feat: session registry + approval routing`).

---

### Task 8: Entry point, QR pairing, ntfy, debug page

**Files:**
- Create: `daemon/src/index.ts`, `daemon/src/notify.ts`; Replace: `daemon/debug/index.html`

**Interfaces:**
- Consumes: everything above.
- Produces: `npm run dev` boots the daemon: prints `ws://<lan-ip>:8790/ws` + QR encoding `{"host":"<ip>","port":8790,"token":"<token>"}`; ntfy fires on `session.permission` and `session.done`.

- [ ] **Step 1: `notify.ts`** (no test — trivial one-liner wrapper, YAGNI)

```ts
export function notify(topic: string | null, title: string, body: string): void {
  if (!topic) return;
  fetch(`https://ntfy.sh/${topic}`, { method: "POST", body, headers: { Title: title } }).catch(() => {});
}
```

- [ ] **Step 2: `index.ts`**

```ts
import qrcode from "qrcode-terminal";
import { networkInterfaces } from "node:os";
import { loadConfig } from "./config.js";
import { startServer } from "./server.js";
import { Registry } from "./sessions/registry.js";
import { Manifest } from "./sessions/manifest.js";
import { notify } from "./notify.js";
import { query } from "@anthropic-ai/claude-agent-sdk";

const cfg = loadConfig();
const manifest = new Manifest(cfg.dataDir);
let pushRef: (e: any) => void = () => {};
const registry = new Registry({ query }, manifest, (e) => {
  pushRef(e);
  if (e.kind === "session.permission") notify(cfg.ntfyTopic, "Approval needed", e.summary);
  if (e.kind === "session.done") notify(cfg.ntfyTopic, "Session finished", e.sessionId);
});

const srv = await startServer(cfg, (m, p, push) => (pushRef = push, registry.handle(m, p)));
const ip = Object.values(networkInterfaces()).flat().find(i => i && !i.internal && i.family === "IPv4")?.address ?? "127.0.0.1";
console.log(`Workbench daemon on ws://${ip}:${srv.port}/ws`);
qrcode.generate(JSON.stringify({ host: ip, port: srv.port, token: cfg.token }), { small: true });
```

Note: `pushRef` wiring is a deliberate simplification (`// ponytail: single-push-ref; event bus if daemon grows`).

- [ ] **Step 3: Debug page** — `daemon/debug/index.html`: plain-JS mobile-viewport page (`<meta name="viewport" content="width=device-width">`): token input → connect → session list refreshed on events → new-session form (cwd + prompt) → transcript pane → approval banner with Allow/Deny → send box. ~150 lines, no framework, no build step. **This page is verified at 390 px width** (mobile mandate).

- [ ] **Step 4: Manual verification (real SDK):** `npm run dev`, open `http://localhost:8790/` on the machine, paste token, start a session with cwd = a scratch repo, prompt "create hello.txt containing hi". Expect: permission banner appears → Allow → file exists → `session.done`. This is the end-to-end gate for the whole plan.

- [ ] **Step 5: Commit** (`feat: daemon entry, qr pairing, ntfy, debug page`).

---

### Task 9: Real-SDK smoke script

**Files:**
- Create: `daemon/scripts/smoke.ts`

**Interfaces:** consumes `ClaudeSession` directly (not the server) — proves SDK integration + resume independent of transport.

- [ ] **Step 1: Write `scripts/smoke.ts`**

```ts
import { query } from "@anthropic-ai/claude-agent-sdk";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert";
import { ClaudeSession } from "../src/sessions/claude.js";

const cwd = mkdtempSync(join(tmpdir(), "wb-smoke-"));
const log = (e: any) => console.log(`[${e.kind}]`, e.summary ?? e.text?.slice(0, 80) ?? e.status ?? "");

const s1 = ClaudeSession.start({ query }, {
  cwd, prompt: "Reply with exactly: PONG. Do not use any tools.",
  onEvent: log, askPermission: async () => true,
});
const id = await s1.id;
await s1.done;
console.log("session", id, "ok — resuming…");

const s2 = ClaudeSession.start({ query }, {
  cwd, prompt: "What did you reply last time? One word.", resume: id,
  onEvent: log, askPermission: async () => true,
});
assert.notEqual(await s2.id, null);
await s2.done;
console.log("SMOKE PASS");
```

- [ ] **Step 2: Run** `npm run smoke` → expect `SMOKE PASS` (requires the machine's normal Claude Code auth; costs pennies).
- [ ] **Step 3: Commit** (`test: real-sdk smoke for start + resume`).

---

## Self-Review (done at write time)

- **Spec coverage (Plan-1 slice):** WS+auth ✅ pairing QR ✅ Claude create/resume/stream/approve ✅ manifest (reboot-resume foundation) ✅ ntfy ✅ debug client mobile-viewport ✅. Deliberately deferred to later plans: Codex, terminal, files/preview, sysmon/power, tray, Android.
- **Placeholder scan:** Tasks 7/8 debug-page and registry test bodies are described-not-fully-coded — acceptable as they mirror Task 6's shown pattern; no TBDs remain.
- **Type consistency:** `SessionEvent`/`SessionStatus` defined once in protocol.ts; Manifest and ClaudeSession import from it; `Registry.handle` matches `RequestHandler` signature via closure in index.ts. ✅
