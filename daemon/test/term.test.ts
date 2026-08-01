import { describe, it, expect, vi } from "vitest";
import * as realPty from "@lydell/node-pty";
import { PtyManager } from "../src/term.js";
import { fakePty } from "./fixtures.js";

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

  it("resolves a relative cwd to an absolute one (the phone renders it as the subtitle)", () => {
    const h = harness();
    const info = h.mgr.create({ ...CREATE, cwd: "." });
    expect(info.cwd).toBe(process.cwd());
    // The pty is spawned in the resolved folder too, so the row and the shell
    // can never disagree about where it is.
    expect(h.spawns[0].opts).toMatchObject({ cwd: process.cwd() });
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

  it("returns a copy, so a stashed TermInfo doesn't mutate under a later resize", () => {
    const h = harness();
    const info = h.mgr.create(CREATE);
    h.mgr.resize(info.termId, 120, 40);
    expect(info.cols).toBe(80); // caller's copy is stale, as it should be
    expect(h.mgr.list()[0].cols).toBe(120); // the manager's view moved on
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

  it("bounds scrollback at 2x the cap and keeps the TAIL", () => {
    const h = harness();
    const { termId } = h.mgr.create(CREATE);
    const CAP = 64 * 1024;
    // Trimming is hysteretic (only past 2x cap), so drive it well past that
    // with many chunks and assert the BOUND plus tail preservation.
    for (let i = 0; i < 10; i++) h.children[0].emit("A".repeat(CAP / 2));
    h.children[0].emit("TAIL");
    const sb = h.mgr.scrollback(termId);
    expect(sb.length).toBeLessThanOrEqual(CAP * 2); // really trimmed, not unbounded
    expect(sb.length).toBeGreaterThanOrEqual(CAP); // and it kept a full cap of tail
    expect(sb.endsWith("TAIL")).toBe(true);
    expect(sb.startsWith("A")).toBe(true);
    // A single oversized chunk is also trimmed to the tail.
    h.children[0].emit("B".repeat(CAP * 3) + "END");
    const sb2 = h.mgr.scrollback(termId);
    expect(sb2.length).toBeLessThanOrEqual(CAP * 2);
    expect(sb2.endsWith("END")).toBe(true);
    expect(sb2.startsWith("B")).toBe(true); // the old "A" run is gone
  });

  it("trims on a line boundary so replay can't start mid-escape / mid-glyph", () => {
    const h = harness();
    const { termId } = h.mgr.create(CREATE);
    const CAP = 64 * 1024;
    const line = "x".repeat(99) + "\n"; // 100 chars incl. the newline
    for (let i = 0; i < Math.ceil((CAP * 3) / 100); i++) h.children[0].emit(line);
    const sb = h.mgr.scrollback(termId);
    expect(sb.length).toBeLessThanOrEqual(CAP * 2);
    expect(sb.slice(0, 100)).toBe(line); // starts at a whole line, not a fragment
    expect(sb.length % 100).toBe(0); // ...and stays line-aligned all the way through
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
