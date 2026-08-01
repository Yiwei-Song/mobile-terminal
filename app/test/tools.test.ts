import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, afterEach } from "vitest";

import { useWorkbench } from "../src/lib/store";
import { startDaemon, until, idle } from "./harness";

const state = () => useWorkbench.getState();

const online = async (url: string, token: string) => {
  state().connect(url, token, { baseDelayMs: 10 });
  await until("online", () => state().connState === "online");
};

// Against the real daemon (fake spawn behind the ToolRunner, so nothing starts a
// container) — the same reasoning the rest of app/test uses: a store test
// against a stub server would prove nothing about the protocol both sides speak.
describe("tools store", () => {
  afterEach(() => state().disconnect());

  it("lists the tools the daemon's tools.json declared", async () => {
    const d = await startDaemon(idle());
    await online(d.url, d.token);

    expect(state().tools).toEqual([]);
    await state().refreshTools();
    expect(state().tools).toEqual([
      { name: "docker", running: false, port: 5432 },
      { name: "vite", running: false, port: 5173 },
    ]);

    await d.close();
  });

  it("start and stop replace only that tool's row, in place", async () => {
    const d = await startDaemon(idle());
    await online(d.url, d.token);
    await state().refreshTools();

    await state().startTool("vite");
    expect(state().tools.map((t) => t.running)).toEqual([false, true]);
    // The row keeps its position and its port; only the live fields moved.
    expect(state().tools[1]).toMatchObject({ name: "vite", running: true, port: 5173 });
    expect(typeof state().tools[1]!.pid).toBe("number");
    // ...and a real command line was built, from tools.json and nothing else.
    expect(d.fm.toolSpawn.calls[0]).toMatchObject({ command: "npm", args: ["run", "dev"] });

    await state().stopTool("vite");
    expect(state().tools.map((t) => t.running)).toEqual([false, false]);

    await d.close();
  });

  it("a name the daemon does not know rejects and lands in lastError", async () => {
    const d = await startDaemon(idle());
    await online(d.url, d.token);
    await state().refreshTools();

    await expect(state().startTool("calc")).rejects.toThrow(/unknown tool/);
    expect(state().lastError).toMatch(/unknown tool/);
    // Nothing was spawned and no row invented itself.
    expect(d.fm.toolSpawn.calls).toHaveLength(0);
    expect(state().tools.map((t) => t.name)).toEqual(["docker", "vite"]);

    await d.close();
  });

  it("refreshPorts parses the daemon's netstat into rows the picker renders", async () => {
    const d = await startDaemon(idle());
    await online(d.url, d.token);
    d.fm.execOut["netstat"] =
      "  TCP    0.0.0.0:5173           0.0.0.0:0              LISTENING       21044\n" +
      "  TCP    127.0.0.1:8790         0.0.0.0:0              LISTENING       8891\n";
    d.fm.execOut["tasklist"] = '"node.exe","21044","Console","1","1 K"\n';

    await state().refreshPorts();
    expect(state().ports).toEqual([
      { port: 5173, pid: 21044, process: "node.exe", dev: true },
      { port: 8790, pid: 8891, process: "?", dev: true },
    ]);

    await d.close();
  });

  it("forgets tools and ports on disconnect", async () => {
    const d = await startDaemon(idle());
    await online(d.url, d.token);
    await state().refreshTools();
    expect(state().tools).not.toEqual([]);

    state().disconnect();
    expect(state().tools).toEqual([]);
    expect(state().ports).toEqual([]);

    await d.close();
  });
});

// The preview WebView loads arbitrary local dev servers, so it is the one frame
// in the app that must never receive the pairing token. That is an absence, and
// an absence is exactly what a future "just pass the config through like the
// terminal does" edit would quietly undo — so pin it here.
describe("preview frame carries no secret", () => {
  const src = (f: string) => readFileSync(join(__dirname, "..", "src", "components", f), "utf8");

  it.each(["PreviewView.tsx", "PreviewView.web.tsx", "previewBridge.ts"])(
    "%s never mentions a token or opens a message channel",
    (file) => {
      // Comments in these files explain the rule, so strip them before looking.
      const code = src(file)
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      expect(code).not.toMatch(/token/i);
      expect(code).not.toMatch(/postMessage|injectedJavaScript|onMessage/);
    },
  );

  it("the preview screen hands the view a url and nothing else", () => {
    const screen = readFileSync(join(__dirname, "..", "app", "preview.tsx"), "utf8");
    const tag = /<PreviewView[\s\S]*?\/>/.exec(screen);
    expect(tag).not.toBeNull();
    expect(tag![0]).not.toMatch(/token|config/i);
  });
});
