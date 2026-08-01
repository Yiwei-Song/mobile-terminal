import { describe, it, expect, vi } from "vitest";
import * as realPty from "@lydell/node-pty";
import { PtyManager } from "../src/term.js";
import type { IPty, PtyDeps } from "../src/term.js";

// Fake pty: never spawns anything. Records the spawn argv and exposes hooks so
// a test can push output / fire an exit as if the child had done it.
function fakePty() {
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

// Manager + fake, with the two callbacks captured as spies.
function harness() {
  const f = fakePty();
  const onData = vi.fn();
  const onExit = vi.fn();
  return { ...f, onData, onExit, mgr: new PtyManager(f.deps, onData, onExit) };
}

const CREATE = { cwd: "C:\\work", cols: 80, rows: 24 };

describe("create", () => {
  it("spawns the default shell (powershell.exe on win32) with the given cwd/size", () => {
    const h = harness();
    const info = h.mgr.create(CREATE);
    expect(h.spawns).toHaveLength(1);
    expect(h.spawns[0].file).toBe(process.platform === "win32" ? "powershell.exe" : process.env.SHELL ?? "/bin/sh");
    expect(h.spawns[0].opts).toMatchObject({ cwd: "C:\\work", cols: 80, rows: 24 });
    expect(info).toMatchObject({ cwd: "C:\\work", cols: 80, rows: 24 });
    expect(info.termId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("honours an explicit shell", () => {
    const h = harness();
    const info = h.mgr.create({ ...CREATE, shell: "cmd.exe" });
    expect(h.spawns[0].file).toBe("cmd.exe");
    expect(info.title).toBe("cmd.exe");
  });

  it("gives each terminal a distinct id and lists them all", () => {
    const h = harness();
    const a = h.mgr.create(CREATE);
    const b = h.mgr.create(CREATE);
    expect(a.termId).not.toBe(b.termId);
    expect(h.mgr.list().map((t) => t.termId)).toEqual([a.termId, b.termId]);
  });
});

describe("write / resize / kill forward to the pty", () => {
  it("write forwards the data verbatim", () => {
    const h = harness();
    const { termId } = h.mgr.create(CREATE);
    h.mgr.write(termId, "dir\r");
    expect(h.children[0].write).toHaveBeenCalledWith("dir\r");
  });

  it("resize forwards and updates the listed size", () => {
    const h = harness();
    const { termId } = h.mgr.create(CREATE);
    h.mgr.resize(termId, 120, 40);
    expect(h.children[0].resize).toHaveBeenCalledWith(120, 40);
    expect(h.mgr.list()[0]).toMatchObject({ cols: 120, rows: 40 });
  });

  it("kill forwards but leaves removal to the exit event", () => {
    const h = harness();
    const { termId } = h.mgr.create(CREATE);
    h.mgr.kill(termId);
    expect(h.children[0].kill).toHaveBeenCalledOnce();
    expect(h.mgr.list()).toHaveLength(1); // still there until the pty exits
  });

  it("unknown termIds are silent no-ops (ids come off the wire)", () => {
    const h = harness();
    expect(() => {
      h.mgr.write("nope", "x");
      h.mgr.resize("nope", 1, 1);
      h.mgr.kill("nope");
    }).not.toThrow();
    expect(h.mgr.scrollback("nope")).toBe("");
  });

  it("kill swallows a throw from an already-dead pty", () => {
    const h = harness();
    const { termId } = h.mgr.create(CREATE);
    h.children[0].kill.mockImplementation(() => {
      throw new Error("process has already exited");
    });
    expect(() => h.mgr.kill(termId)).not.toThrow();
  });
});

describe("data / scrollback", () => {
  it("fires onData for every chunk and accumulates scrollback", () => {
    const h = harness();
    const { termId } = h.mgr.create(CREATE);
    h.children[0].emit("hel");
    h.children[0].emit("lo");
    expect(h.onData.mock.calls).toEqual([
      [termId, "hel"],
      [termId, "lo"],
    ]);
    expect(h.mgr.scrollback(termId)).toBe("hello");
  });

  it("trims scrollback at the cap and keeps the TAIL", () => {
    const h = harness();
    const { termId } = h.mgr.create(CREATE);
    const CAP = 64 * 1024;
    h.children[0].emit("A".repeat(CAP));
    h.children[0].emit("TAIL");
    const sb = h.mgr.scrollback(termId);
    expect(sb).toHaveLength(CAP);
    expect(sb.endsWith("TAIL")).toBe(true);
    expect(sb.startsWith("A")).toBe(true);
    // A single oversized chunk is also trimmed to the tail.
    h.children[0].emit("B".repeat(CAP * 2) + "END");
    expect(h.mgr.scrollback(termId)).toHaveLength(CAP);
    expect(h.mgr.scrollback(termId).endsWith("END")).toBe(true);
  });

  it("scrollback is per-terminal", () => {
    const h = harness();
    const a = h.mgr.create(CREATE);
    const b = h.mgr.create(CREATE);
    h.children[0].emit("aaa");
    h.children[1].emit("bbb");
    expect(h.mgr.scrollback(a.termId)).toBe("aaa");
    expect(h.mgr.scrollback(b.termId)).toBe("bbb");
  });
});

describe("exit", () => {
  it("fires onExit with the code and removes the terminal from list()", () => {
    const h = harness();
    const { termId } = h.mgr.create(CREATE);
    h.children[0].fireExit(3);
    expect(h.onExit).toHaveBeenCalledWith(termId, 3);
    expect(h.mgr.list()).toEqual([]);
    expect(h.mgr.scrollback(termId)).toBe(""); // gone with the terminal
  });

  it("killAll kills every live terminal", () => {
    const h = harness();
    h.mgr.create(CREATE);
    h.mgr.create(CREATE);
    h.mgr.killAll();
    expect(h.children[0].kill).toHaveBeenCalledOnce();
    expect(h.children[1].kill).toHaveBeenCalledOnce();
    // Ptys report their exits; then the map is empty.
    h.children[0].fireExit(0);
    h.children[1].fireExit(0);
    expect(h.mgr.list()).toEqual([]);
  });
});

// The only test that touches the real native binding. It proves @lydell/node-pty
// actually loads and spawns a ConPTY on this Node/Windows combo — the fakes above
// would happily pass with a broken binary.
// SAFETY: harmless echo only, and it is killed/exited before the test returns.
describe("real pty (native binding)", () => {
  it("spawns cmd.exe /c echo and the output reaches scrollback", { timeout: 20_000 }, async () => {
    const seen: string[] = [];
    let exitCode: number | null = null;
    const mgr = new PtyManager(
      { pty: realPty },
      (_id, d) => seen.push(d),
      (_id, c) => (exitCode = c),
    );
    const info = mgr.create({ cwd: process.cwd(), cols: 80, rows: 24, shell: "cmd.exe" });
    // `set /a 6*7` rides along because ConPTY echoes the typed line back: "42"
    // appears ONLY if the shell actually executed the command, so it's the real
    // proof of a working binding (finding "hello-pty" alone could just be echo).
    mgr.write(info.termId, "echo hello-pty & set /a 6*7\r\n");
    try {
      // Poll rather than sleep a fixed amount: ConPTY's paint timing varies.
      const deadline = Date.now() + 15_000;
      while (Date.now() < deadline && !seen.join("").includes("42")) {
        await new Promise((r) => setTimeout(r, 50));
      }
      expect(seen.join("")).toContain("hello-pty");
      expect(seen.join("")).toContain("42");
      expect(mgr.scrollback(info.termId)).toContain("hello-pty");
    } finally {
      mgr.killAll();
    }
    // The pty really dies, and the manager notices via onExit.
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline && mgr.list().length > 0) {
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(mgr.list()).toEqual([]);
    expect(exitCode).not.toBeNull();
  });
});
