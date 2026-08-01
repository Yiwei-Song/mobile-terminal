// Terminal manager: owns the live ptys, their scrollback, and the id->pty map.
// The pty module is injected (deps.pty) so unit tests drive a fake and never
// spawn a real shell; one test injects the real @lydell/node-pty to prove the
// native ConPTY binding actually works.
import { randomUUID } from "crypto";
import type { TermInfo } from "./protocol.js";

// The wire shape lives in protocol.ts (the app re-exports it); re-exported here
// so this module's public surface still reads as a whole.
export type { TermInfo };

// Minimal structural slice of node-pty's IPty — only what this module touches.
// Structural, not an import of IPty, so a test fake is five methods instead of
// the whole interface. The real IPty satisfies it.
export interface IPty {
  onData(cb: (data: string) => void): unknown;
  onExit(cb: (e: { exitCode: number }) => void): unknown;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
}

export interface PtyDeps {
  pty: { spawn(file: string, args: string[], opts: object): IPty };
}

// A terminal that runs for hours must not grow unbounded. 64KB of tail is a few
// hundred lines — enough to replay a useful screen on (re)attach.
const SCROLLBACK_CAP = 64 * 1024;

// powershell.exe is the user's shell on this box, so a remote terminal should
// look like the one they'd open locally (profile, aliases, PSReadLine).
const defaultShell = (): string =>
  process.platform === "win32" ? "powershell.exe" : process.env.SHELL ?? "/bin/sh";

interface Term {
  info: TermInfo;
  pty: IPty;
  buf: string;
}

export class PtyManager {
  private readonly terms = new Map<string, Term>();

  constructor(
    private readonly deps: PtyDeps,
    private readonly onData: (termId: string, data: string) => void,
    private readonly onExit: (termId: string, code: number) => void,
  ) {}

  create(opts: { cwd: string; cols: number; rows: number; shell?: string }): TermInfo {
    const shell = opts.shell ?? defaultShell();
    const termId = randomUUID();
    const pty = this.deps.pty.spawn(shell, [], {
      name: "xterm-color",
      cwd: opts.cwd,
      cols: opts.cols,
      rows: opts.rows,
      env: process.env,
    });
    const info: TermInfo = {
      termId,
      title: shell,
      cwd: opts.cwd,
      cols: opts.cols,
      rows: opts.rows,
    };
    const term: Term = { info, pty, buf: "" };
    this.terms.set(termId, term);

    pty.onData((data) => {
      term.buf += data;
      // Hysteresis: slicing on every chunk copies the whole buffer once it's
      // full (64KB memcpy per chunk). Let it grow to 2x, then trim — amortized
      // O(1) per byte, and memory is still bounded (2 * cap worst case).
      if (term.buf.length > SCROLLBACK_CAP * 2) {
        const tail = term.buf.slice(-SCROLLBACK_CAP);
        // Then drop the partial first line: an arbitrary cut can land inside an
        // ANSI escape (garbage frame on replay) or between a surrogate pair
        // (broken glyph). A line boundary is safe for both. Bounded lookahead,
        // so a newline-less blob can't drop the whole buffer.
        const nl = tail.indexOf("\n");
        term.buf = nl !== -1 && nl < 4096 ? tail.slice(nl + 1) : tail;
      }
      this.onData(termId, data);
    });
    pty.onExit(({ exitCode }) => {
      this.terms.delete(termId);
      this.onExit(termId, exitCode);
    });
    return { ...info }; // copy: resize() mutates the live info, a stashed one must not change
  }

  // write/resize/kill on an unknown id are silent no-ops: ids come off the wire
  // and a client can race a terminal that just exited.
  write(termId: string, data: string): void {
    this.terms.get(termId)?.pty.write(data);
  }

  resize(termId: string, cols: number, rows: number): void {
    const term = this.terms.get(termId);
    if (!term) return;
    term.pty.resize(cols, rows);
    term.info.cols = cols;
    term.info.rows = rows;
  }

  kill(termId: string): void {
    // Removal happens in the onExit handler, not here — the pty is still alive
    // for the moment it takes ConPTY to tear down.
    try {
      this.terms.get(termId)?.pty.kill();
    } catch {
      // already dead; the exit handler has it (or already ran)
    }
  }

  list(): TermInfo[] {
    return [...this.terms.values()].map((t) => ({ ...t.info })); // copies, not the live info
  }

  scrollback(termId: string): string {
    return this.terms.get(termId)?.buf ?? "";
  }

  killAll(): void {
    for (const termId of [...this.terms.keys()]) this.kill(termId);
  }
}
