import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, vi } from "vitest";

import { ToolRunner, loadToolSpecs, type ToolSpec } from "../src/tools.js";
import { fakeSpawn } from "./fixtures.js";

// Nothing in this file starts a real process. Every assertion is about the argv
// the runner built and the bookkeeping it kept — spawning a real `docker
// compose up` from a unit test would leave containers behind on the dev box.

const win = process.platform === "win32";

const SPECS: ToolSpec[] = [
  { name: "docker", command: "docker", args: ["compose", "up", "-d"], cwd: "D:\\proj", port: 5432 },
  { name: "vite", command: "npm", args: ["run", "dev"], port: 5173 },
];

const runner = () => {
  const spawn = fakeSpawn();
  return { spawn, tools: new ToolRunner(spawn.deps, SPECS) };
};

describe("ToolRunner.start", () => {
  it("spawns the declared command line in its cwd and reports running", () => {
    const { spawn, tools } = runner();
    const status = tools.start("docker");

    expect(spawn.calls).toHaveLength(1);
    expect(spawn.calls[0]!.command).toBe("docker");
    expect(spawn.calls[0]!.args).toEqual(["compose", "up", "-d"]);
    expect(spawn.calls[0]!.opts.cwd).toBe("D:\\proj");
    // .cmd shims (npm/npx/docker-compose) cannot be spawned without one.
    expect(spawn.calls[0]!.opts.shell).toBe(true);
    expect(status).toEqual({ name: "docker", running: true, pid: spawn.children[0]!.pid, port: 5432 });
  });

  it("is idempotent — a second start does not spawn a second child", () => {
    const { spawn, tools } = runner();
    const first = tools.start("docker");
    const second = tools.start("docker");
    expect(spawn.calls).toHaveLength(1);
    expect(second).toEqual(first);
  });

  it("refuses a name that is not in tools.json", () => {
    const { spawn, tools } = runner();
    expect(() => tools.start("rm -rf /")).toThrow(/unknown tool/);
    expect(spawn.calls).toHaveLength(0);
  });
});

describe("ToolRunner.stop", () => {
  it("kills the process TREE on win32, SYNCHRONOUSLY", () => {
    const { spawn, tools } = runner();
    tools.start("docker");
    const pid = spawn.children[0]!.pid;

    const status = tools.stop("docker");

    if (win) {
      // The tool's own children (containers' CLI, node workers) outlive a plain
      // kill on Windows — /T is the whole reason this is not child.kill().
      // And it must be spawnSync: an async spawn from process.on("exit") never
      // runs, which is exactly how tools used to survive the daemon.
      expect(spawn.sync).toEqual([
        { command: "taskkill", args: ["/pid", String(pid), "/T", "/F"], opts: expect.anything() },
      ]);
      expect(spawn.calls).toHaveLength(1); // the tool itself, and nothing async after it
    } else {
      expect(spawn.children[0]!.kill).toHaveBeenCalled();
    }
    expect(status).toEqual({ name: "docker", running: false, pid: undefined, port: 5432 });
  });

  it("is a no-op on a tool that is not running", () => {
    const { spawn, tools } = runner();
    expect(tools.stop("vite")).toEqual({ name: "vite", running: false, pid: undefined, port: 5173 });
    expect(spawn.calls).toHaveLength(0);
    expect(spawn.sync).toHaveLength(0);
  });

  it("survives a taskkill that fails (the fake always reports one)", () => {
    const { tools } = runner();
    tools.start("docker");
    // spawnSync reports a failed spawn in its return value rather than throwing
    // or emitting an unhandled "error" — so a missing taskkill.exe, or the
    // usual already-dead pid, must not take the daemon down.
    expect(() => tools.stop("docker")).not.toThrow();
    expect(tools.status()[0]!.running).toBe(false);
  });
});

describe("ToolRunner.status", () => {
  it("lists every declared spec, running or not", () => {
    const { tools } = runner();
    expect(tools.status()).toEqual([
      { name: "docker", running: false, pid: undefined, port: 5432 },
      { name: "vite", running: false, pid: undefined, port: 5173 },
    ]);
    tools.start("vite");
    expect(tools.status().map((s) => s.running)).toEqual([false, true]);
  });

  it("marks a tool stopped when its child exits on its own", () => {
    const { spawn, tools } = runner();
    tools.start("docker");
    spawn.children[0]!.fire("exit", 1);
    expect(tools.status()[0]!.running).toBe(false);
  });

  it("marks a tool stopped when its command fails to spawn (error, never exit)", () => {
    const { spawn, tools } = runner();
    tools.start("docker");
    spawn.children[0]!.fire("error", new Error("ENOENT"));
    expect(tools.status()[0]!.running).toBe(false);
  });

  it("a stale child's exit does not clear its live successor", () => {
    const { spawn, tools } = runner();
    tools.start("docker");
    const stale = spawn.children[0]!;
    tools.stop("docker");
    tools.start("docker"); // a new child now owns the "docker" slot

    stale.fire("exit", 0); // the first child's exit lands late

    expect(tools.status()[0]!.running).toBe(true);
    expect(tools.status()[0]!.pid).toBe(spawn.children[1]!.pid);
  });
});

describe("ToolRunner.stopAll", () => {
  it("kills every running tool and leaves the stopped ones alone", () => {
    const { spawn, tools } = runner();
    tools.start("docker");
    tools.start("vite");
    const pids = spawn.children.map((c) => c.pid);

    tools.stopAll();

    expect(tools.status().every((s) => !s.running)).toBe(true);
    if (win) {
      // Every kill on the SYNC path: stopAll is called from process.on("exit"),
      // where anything async is dead on arrival.
      expect(spawn.sync.map((c) => c.command)).toEqual(["taskkill", "taskkill"]);
      expect(spawn.sync.map((c) => c.args[1])).toEqual([String(pids[0]), String(pids[1])]);
      expect(spawn.calls).toHaveLength(2); // the two tools; stopAll spawned nothing
    } else {
      expect(spawn.children.every((c) => c.kill.mock.calls.length === 1)).toBe(true);
    }
  });
});

describe("loadToolSpecs", () => {
  const dir = () => mkdtempSync(join(tmpdir(), "wb-tools-"));
  const write = (body: string): string => {
    const d = dir();
    writeFileSync(join(d, "tools.json"), body);
    return d;
  };

  it("reads a valid file", () => {
    const d = write(JSON.stringify(SPECS));
    expect(loadToolSpecs(d)).toEqual(SPECS);
  });

  it("answers empty and stays quiet when the file is absent — that is the default", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(loadToolSpecs(dir())).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it.each([
    ["unparseable JSON", "{ not json"],
    ["not an array", JSON.stringify({ docker: "compose up" })],
    ["an entry with no command", JSON.stringify([{ name: "docker" }])],
    ["an entry with a non-string name", JSON.stringify([{ name: 7, command: "docker" }])],
    ["args that are not all strings", JSON.stringify([{ name: "d", command: "docker", args: ["up", 3] }])],
    ["duplicate names", JSON.stringify([{ name: "d", command: "a" }, { name: "d", command: "b" }])],
  ])("warns and answers empty for %s", (_what, body) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(loadToolSpecs(write(body))).toEqual([]);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it("never throws, whatever is in the file", () => {
    expect(() => loadToolSpecs(write("null"))).not.toThrow();
  });
});
