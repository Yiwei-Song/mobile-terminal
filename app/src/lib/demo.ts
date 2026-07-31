import type { SessionRow } from "@shared/protocol";

import { useWorkbench, type Approval, type TranscriptItem } from "./store";

// Demo mode is the rendered-state gate's data source: the screens run in Expo
// web with no daemon, no pairing and no sockets, so a screenshot is of the real
// components rather than of a mock page. Never on in a normal build.
//
// `process.env.EXPO_PUBLIC_DEMO` stays a literal member expression on purpose —
// Expo inlines only that exact form at build time; a destructured `env.X` would
// silently be undefined in the bundle.
export const demoMode = process.env.EXPO_PUBLIC_DEMO === "1";

// Which story to seed. Absent = the populated list; the rest exist so the
// offline/empty/unauthorized screens can be rendered without staging a real
// network failure.
const variant = process.env.EXPO_PUBLIC_DEMO_STATE;

const ago = (minutes: number): string => new Date(Date.now() - minutes * 60_000).toISOString();

const row = (
  sessionId: string,
  title: string,
  cwd: string,
  status: SessionRow["status"],
  minutes: number,
): SessionRow => ({ sessionId, agent: "claude", cwd, title, status, updatedAt: ago(minutes) });

// Attention-first, the order the daemon's manifest would return.
const sessions: SessionRow[] = [
  row("s-auth", "Add refresh-token rotation to the auth service", "D:\\projects\\api-server", "waiting_on_user", 0.4),
  row("s-web", "Fix the flaky checkout E2E spec", "D:\\projects\\web-dashboard", "running", 3),
  row("s-infra", "Move staging onto the new node pool", "D:\\projects\\infra\\terraform", "running", 11),
  row("s-notes", "Summarise last week's incident reports", "C:\\Users\\yiwei\\notes", "idle", 95),
  row("s-scraper", "Port the scraper to the new fetch client", "D:\\projects\\scraper", "idle", 380),
  row("s-billing", "Investigate the duplicate invoice bug", "D:\\projects\\legacy-billing", "dead", 2600),
];

// Multiline and long on purpose: the approval card has to survive the worst
// command a real session will hand it.
const approval: Approval = {
  kind: "session.permission",
  sessionId: "s-auth",
  requestId: "req-4812",
  toolName: "Bash",
  summary:
    "Bash: npx prisma migrate deploy \\\n" +
    "  --schema ./prisma/schema.prisma \\\n" +
    "  --url postgresql://api:****@127.0.0.1:5432/api_staging \\\n" +
    "  && node scripts/backfill-refresh-tokens.mjs --batch 500 --since 2026-07-01",
  cwd: "D:\\projects\\api-server",
};

const transcripts: Record<string, TranscriptItem[]> = {
  "s-auth": [
    { id: "a1", kind: "text", role: "user", text: "Rotate refresh tokens on every use and revoke the old one. Keep the existing cookie names." },
    { id: "a2", kind: "text", role: "assistant", text: "Looking at how sessions are issued now — auth/tokens.ts owns both the access and the refresh path." },
    { id: "a3", kind: "tool", name: "Read", summary: "src/auth/tokens.ts (218 lines)" },
    { id: "a4", kind: "tool", name: "Edit", summary: "src/auth/tokens.ts +47 −12" },
    { id: "a5", kind: "text", role: "assistant", text: "Rotation is in: the old token is revoked in the same transaction, so a replay after a refresh fails closed. The migration has to run before the tests will pass." },
  ],
  "s-web": [
    { id: "w1", kind: "text", role: "user", text: "The checkout spec fails about one run in four on CI. Find out why." },
    { id: "w2", kind: "tool", name: "Bash", summary: "npx playwright test checkout --repeat-each 8" },
    { id: "w3", kind: "text", role: "assistant", text: "Two of eight failed on the same assertion — the total updates after the cart badge, so the spec reads it a frame early." },
  ],
  "s-billing": [
    { id: "b1", kind: "text", role: "user", text: "Why does invoice INV-2291 exist twice?" },
    { id: "b2", kind: "tool", name: "Grep", summary: "createInvoice( — 6 matches in src/billing" },
    { id: "b3", kind: "done", ok: false, costUsd: 0.42 },
  ],
};

/**
 * Replace the store's contents with the demo story. Called only from the home
 * screen, only when {@link demoMode} is on — the screen also skips pairing and
 * connecting in that case, because demo mode *is* the connection.
 */
export function seedDemo(): void {
  const machine = { hostname: "OMEN16", version: "0.1.0", ntfyTopic: "wb-976bdfffc3b5" };
  if (variant === "unauthorized") {
    useWorkbench.setState({ connState: "unauthorized", machine: null, sessions: [], lastSeen: Date.now() - 9 * 60_000 });
    return;
  }
  if (variant === "offline") {
    useWorkbench.setState({ connState: "offline", machine, sessions: [], lastSeen: Date.now() - 14 * 60_000 });
    return;
  }
  if (variant === "empty") {
    useWorkbench.setState({ connState: "online", machine, sessions: [], lastSeen: Date.now() });
    return;
  }
  useWorkbench.setState({
    connState: "online",
    machine,
    sessions,
    transcripts,
    pendingApprovals: { "s-auth": [approval] },
    lastSeen: Date.now(),
    lastError: null,
  });
}
