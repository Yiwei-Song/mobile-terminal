// The app's import point for the wire protocol. Types live in the daemon (its
// tsconfig rootDir is src, and a flat dist is load-bearing for how server.ts
// finds debug/) — so this re-exports rather than owns.
//
// Extensionless on purpose: tsc resolves it (app's moduleResolution is
// bundler) and so does Metro. A `.js` specifier would typecheck but break the
// bundle the moment anything runtime-valued is re-exported here — Metro does
// not substitute .js -> .ts. shared/ is outside daemon's tsconfig include, so
// NodeNext's extension rule never applies to this file.
export type {
  ClientMsg,
  ConfigInfo,
  Entry,
  Port,
  ServerMsg,
  SessionStatus,
  SessionEvent,
  SessionRow,
  MachineEvent,
  Metrics,
  Proc,
  PushEvent,
  TermEvent,
  TermInfo,
} from "../daemon/src/protocol";
