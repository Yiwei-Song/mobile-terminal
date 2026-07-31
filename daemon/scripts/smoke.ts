// Real-SDK smoke: ClaudeSession start -> resume, straight against the SDK with
// no server, no WebSocket, no registry. It answers "is our SDK integration and
// resume still wired correctly?" independent of transport, where scripts/e2e.mjs
// answers the same question through the wire. Deliberately NOT part of
// `npm test`: needs a logged-in Claude CLI and costs real (tiny) money.
//
//   npm run smoke
//
// Exit 0 and "SMOKE PASS" = good.
import assert from "node:assert";
import { mkdirSync, rmSync } from "node:fs";
import { dirname, join, parse } from "node:path";
import { fileURLToPath } from "node:url";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { ClaudeSession } from "../src/sessions/claude.js";
import type { SessionEvent } from "../src/protocol.js";

// Same reasoning as e2e: a boring top-level dir, not os.tmpdir() (aliased on
// Windows) and not a dot-dir in the repo (gets confused with the repo root).
const scratch = join(parse(dirname(fileURLToPath(import.meta.url))).root, "wb-smoke");
rmSync(scratch, { recursive: true, force: true });
mkdirSync(scratch, { recursive: true });

const log = (e: SessionEvent): void => {
  if (e.kind === "session.text") console.log(`  text ${e.role}: ${e.text.slice(0, 120).replace(/\s+/g, " ")}`);
  else if (e.kind === "session.tool") console.log(`  tool ${e.summary.slice(0, 120)}`);
  else if (e.kind === "session.status") console.log(`  status ${e.status} "${e.title}"`);
  else if (e.kind === "session.permission") console.log(`  permission ${e.summary.slice(0, 120)} -> allow`);
  else console.log(`  done ok=${e.ok} cost=${e.costUsd}`);
};

// `session.done` is a per-TURN event; the session's `done` promise is the CLI's
// whole lifetime and only settles once the input stream is closed. So a turn is
// awaited on the event, and close() is what ends the session afterwards.
function turn(prompt: string, resume?: string) {
  let settle!: (ok: boolean) => void;
  const ended = new Promise<boolean>((r) => (settle = r));
  const said: string[] = [];
  const session = ClaudeSession.start(
    { query },
    {
      cwd: scratch,
      prompt,
      resume,
      onEvent: (e) => {
        log(e);
        if (e.kind === "session.text" && e.role === "assistant") said.push(e.text);
        if (e.kind === "session.done") settle(e.ok);
        // The CLI can die mid-turn: `dead` arrives and no `done` ever will, so
        // without this the turn would wait forever instead of failing. Harmless
        // after a real done — the promise is already settled.
        if (e.kind === "session.status" && e.status === "dead") settle(false);
      },
      // Every prompt here is tool-free by construction, so this should never
      // fire — but a stall waiting for an answer nobody gives is a worse
      // failure than an allow.
      askPermission: async () => true,
    },
  );
  // Ending the session is the last thing each turn does: without close() the
  // SDK sits waiting for more input and the process never exits.
  const finish = async (): Promise<string> => {
    try {
      assert.ok(await ended, `turn failed: ${prompt}`);
      return said.join(" ");
    } finally {
      // In a finally so a failed turn still reaps its CLI child instead of
      // orphaning it.
      session.close();
      // A clean close resolves `done` (the pump falls through; failId no-ops on
      // an already-settled id). It only rejects if the stream threw — which the
      // turn has already been judged on either way.
      await session.done.catch(() => {});
    }
  };
  return { session, finish };
}

try {
  const first = turn("Reply with exactly: PONG. Do not use any tools.");
  const id = await first.session.id;
  const pong = await first.finish();
  assert.match(pong, /PONG/i, "first turn never said PONG");
  console.log(`session ${id} ok — resuming…`);

  const second = turn("What single word did you reply last time? Answer with just that word. Do not use any tools.", id);
  assert.notEqual(await second.session.id, null);
  const recalled = await second.finish();
  // The whole point of resume: turn two can only know this from turn one.
  assert.match(recalled, /PONG/i, "resumed session did not remember the first turn");

  rmSync(scratch, { recursive: true, force: true });
  console.log("SMOKE PASS");
} catch (e) {
  // Scratch is left behind on failure, on purpose — same as e2e.
  console.log(`FAIL: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
}
