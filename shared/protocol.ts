// The app's import point for the wire protocol. Types live in the daemon (its
// tsconfig rootDir is src, and a flat dist is load-bearing for how server.ts
// finds debug/) — so this re-exports rather than owns. Type-only: it erases at
// build time, so Metro never resolves across the repo root at runtime.
export type {
  ClientMsg,
  ServerMsg,
  SessionStatus,
  SessionEvent,
  SessionRow,
} from "../daemon/src/protocol.js";
