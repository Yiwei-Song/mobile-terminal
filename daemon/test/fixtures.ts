import { vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SDKAssistantMessage, SDKResultMessage, SDKSystemMessage } from "@anthropic-ai/claude-agent-sdk";
import { KeepAwake, type PowerDeps } from "../src/power.js";
import type { SystemDeps } from "../src/system.js";
import { PtyManager, type IPty, type PtyDeps } from "../src/term.js";
import { ToolRunner, type ToolDeps, type ToolSpec } from "../src/tools.js";
import type { MachineDeps } from "../src/sessions/registry.js";
import type { Exec } from "../src/files.js";

const GB = 1024 ** 3;

// A canned `si` — same shapes the real library returns, so snapshot/topProcesses
// run their real mapping over it.
const fakeSi = (procs: { pid: number; name: string; cpu: number; memRss: number }[] = []) =>
  ({
    currentLoad: async () => ({ currentLoad: 10 }),
    mem: async () => ({ total: 32 * GB, used: 16 * GB }),
    fsSize: async () => [{ mount: "C:", size: 100 * GB, used: 50 * GB, use: 50 }],
    time: async () => ({ uptime: 3600 }),
    processes: async () => ({ list: procs }),
  }) as unknown as SystemDeps["si"];

// A spawn whose child never exits on its own: KeepAwake's hold stays "active"
// until it kill()s the child (matching the real long-running PS).
const heldSpawn = (): PowerDeps["spawn"] =>
  (() => ({ pid: 1, kill() {}, on() { return this; } })) as unknown as PowerDeps["spawn"];

// A spawn whose child exits(0) on the next tick: displayOff (used by power.lock)
// awaits that exit, so this lets the lock RPC resolve. Records nothing — the
// exec side records the command lines that matter.
const exitingSpawn = (): PowerDeps["spawn"] =>
  ((_cmd: string, _args: string[]) => {
    const handlers: Record<string, (a: unknown) => void> = {};
    setImmediate(() => handlers["exit"]?.(0));
    return { pid: 2, kill() {}, on(ev: string, cb: (a: unknown) => void) { handlers[ev] = cb; return this; } };
  }) as unknown as PowerDeps["spawn"];

// Fake pty: never spawns anything. Records the spawn argv and exposes hooks so
// a test can push output / fire an exit as if the child had done it.
export function fakePty() {
  const spawns: { file: string; args: string[]; opts: any }[] = [];
  const children: any[] = [];
  const spawn = (file: string, args: string[], opts: object): IPty => {
    spawns.push({ file, args, opts: opts as any });
    let dataCb: ((d: string) => void) | null = null;
    let exitCb: ((e: { exitCode: number }) => void) | null = null;
    const child = {
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
      onData: (cb: (d: string) => void) => (dataCb = cb),
      onExit: (cb: (e: { exitCode: number }) => void) => (exitCb = cb),
      emit: (d: string) => dataCb?.(d),
      fireExit: (exitCode = 0) => exitCb?.({ exitCode }),
    };
    children.push(child);
    return child;
  };
  return { deps: { pty: { spawn } } satisfies PtyDeps, spawns, children };
}

// A spawn that starts nothing: records every argv and hands back a child whose
// exit/error can be fired by the test. Shared by the ToolRunner tests and by
// fakeMachine — the one thing neither may do is launch a real Docker.
export function fakeSpawn() {
  const calls: { command: string; args: string[]; opts: any }[] = [];
  const sync: { command: string; args: string[]; opts: any }[] = [];
  const children: any[] = [];
  let pid = 1000;
  const spawn = ((command: string, args: string[], opts: object) => {
    calls.push({ command, args, opts: opts as any });
    const handlers: Record<string, ((a: unknown) => void)[]> = {};
    const child = {
      pid: ++pid,
      kill: vi.fn(),
      on(ev: string, cb: (a: unknown) => void) {
        (handlers[ev] ??= []).push(cb);
        return this;
      },
      fire: (ev: string, a?: unknown) => handlers[ev]?.forEach((cb) => cb(a)),
    };
    children.push(child);
    return child;
  }) as unknown as ToolDeps["spawn"];
  // The kill path. Records argv and answers with the everyday taskkill outcome
  // — non-zero + an error, because the pid is usually already gone — so every
  // test that stops a tool also proves the runner ignores the result.
  const spawnSync = ((command: string, args: string[], opts: object) => {
    sync.push({ command, args, opts: opts as any });
    return { status: 1, error: new Error("ERROR: The process ... not found."), signal: null };
  }) as unknown as ToolDeps["spawnSync"];
  return { deps: { spawn, spawnSync } satisfies ToolDeps, calls, sync, children };
}

// A full MachineDeps backed by fakes: real KeepAwake (hold state observable via
// .active), real snapshot/lock/reboot code over fake si + a recording exec, and
// a real PtyManager over a fake pty (`children` drives its output/exit).
// The two specs every registry/app test sees on the tools screen. Named here so
// a test asserting a status list does not have to restate them.
export const TOOL_SPECS: ToolSpec[] = [
  { name: "docker", command: "docker", args: ["compose", "up", "-d"], cwd: "D:\\proj", port: 5432 },
  { name: "vite", command: "npm", args: ["run", "dev"], port: 5173 },
];

export function fakeMachine(procs: Parameters<typeof fakeSi>[0] = []) {
  const execCmds: string[] = [];
  const exec = ((cmd: string, cb: (e: unknown) => void) => { execCmds.push(cmd); cb(null); return {}; }) as unknown as PowerDeps["exec"];
  const power: PowerDeps = { spawn: exitingSpawn(), exec };
  const keepAwake = new KeepAwake({ spawn: heldSpawn(), exec });
  const ptyFake = fakePty();
  // The push the registry was built with is what these forward to; index.ts
  // wires the same two callbacks to term.data / term.exit events.
  const onTerm = { data: (_id: string, _d: string) => {}, exit: (_id: string, _c: number) => {} };
  const pty = new PtyManager(ptyFake.deps, (id, d) => onTerm.data(id, d), (id, c) => onTerm.exit(id, c));
  // The argv-style exec the git/ports RPCs run on: records what was asked for
  // and answers from `execOut`, keyed by the command name a test wants to stub.
  const execFileCalls: { file: string; args: string[]; cwd?: string }[] = [];
  const execOut: Record<string, string> = {};
  const execFile: Exec = async (file, args, cwd) => {
    execFileCalls.push({ file, args, cwd });
    return execOut[file] ?? "";
  };
  // A real ToolRunner over a spawn that starts nothing: the tools.* RPCs run
  // their real code and the test reads the argv the runner built.
  const toolSpawn = fakeSpawn();
  const tools = new ToolRunner(toolSpawn.deps, TOOL_SPECS);
  // An empty temp dir, so discovery finds no agent stores and every existing
  // test keeps the session set it declares. A discovery test passes its own tree.
  const machine: MachineDeps = { system: { si: fakeSi(procs) }, keepAwake, power, pty, execFile, tools, home: mkdtempSync(join(tmpdir(), "wb-home-")) };
  return { machine, keepAwake, execCmds, execFileCalls, execOut, pty, ptyFake, onTerm, tools, toolSpawn };
}

// Shared fake SDK messages. `satisfies`-checked against the real SDK types, so a
// shape change in the SDK breaks these tests instead of only production.
export const init = {
  type: "system",
  subtype: "init",
  session_id: "s1",
  uuid: "00000000-0000-4000-8000-000000000000",
  cwd: "C:\\proj",
  apiKeySource: "oauth",
  claude_code_version: "0.0.0-test",
  tools: [],
  mcp_servers: [],
  model: "claude-test",
  permissionMode: "default",
  slash_commands: [],
  output_style: "default",
  skills: [],
  plugins: [],
} satisfies SDKSystemMessage;

export const result = {
  type: "result",
  subtype: "success",
  session_id: "s1",
  uuid: "00000000-0000-4000-8000-000000000009",
  is_error: false,
  duration_ms: 1,
  duration_api_ms: 1,
  num_turns: 1,
  result: "ok",
  stop_reason: "end_turn",
  total_cost_usd: 0.01,
  // ponytail: usage/modelUsage are unread by the adapter; cast rather than
  // hand-build every token counter the API type requires.
  usage: {} as SDKResultMessage["usage"],
  modelUsage: {},
  permission_denials: [],
} satisfies SDKResultMessage;

export const assistant = (content: SDKAssistantMessage["message"]["content"]) =>
  ({
    type: "assistant",
    session_id: "s1",
    uuid: "00000000-0000-4000-8000-000000000001",
    parent_tool_use_id: null,
    // ponytail: BetaMessage's envelope fields (usage, container, diagnostics…)
    // are never read by the adapter, so the wrapper is cast; `content` — the
    // part the adapter parses — stays type-checked through the parameter.
    message: { role: "assistant", content } as SDKAssistantMessage["message"],
  }) satisfies SDKAssistantMessage;

export const toolOpts = (requestId: string) => ({
  signal: new AbortController().signal,
  toolUseID: "tu_1",
  requestId,
});

export const tick = () => new Promise<void>((r) => setImmediate(r));
