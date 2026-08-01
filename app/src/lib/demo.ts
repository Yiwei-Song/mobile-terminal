import type { Metrics, Proc, SessionRow } from "@shared/protocol";

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

// The System screen's live snapshot: realistic mid-load box (cpu ~34%, 22/32 GB
// RAM, 780/1000 GB disk, up 3d 4h). Constant so the offline story can grey the
// same last-known numbers the online one shows.
const metrics: Metrics = {
  cpuPct: 34,
  mem: { usedGb: 22, totalGb: 32, pct: 69 },
  disks: [{ mount: "C:", usedGb: 780, totalGb: 1000, pct: 78 }],
  uptimeSec: 3 * 86_400 + 4 * 3_600, // 3d 4h
};

// Sorted by cpu desc, the order the daemon returns. node #8891 is the daemon.
const processes: Proc[] = [
  { pid: 12184, name: "Code.exe", cpuPct: 18.4, memMb: 1240 },
  { pid: 9032, name: "chrome.exe", cpuPct: 12.1, memMb: 2360 },
  { pid: 21044, name: "node.exe", cpuPct: 7.8, memMb: 540 },
  { pid: 8891, name: "node.exe", cpuPct: 4.2, memMb: 410 },
  { pid: 15522, name: "Discord.exe", cpuPct: 2.1, memMb: 320 },
  { pid: 4820, name: "explorer.exe", cpuPct: 0.9, memMb: 180 },
  { pid: 18344, name: "Spotify.exe", cpuPct: 0.6, memMb: 240 },
  { pid: 20120, name: "powershell.exe", cpuPct: 0.3, memMb: 90 },
];

// A rolling CPU series so the sparkline shows a curve rather than a flat line the
// (socket-less) demo can never grow. Ends near metrics.cpuPct for continuity.
export const DEMO_CPU_HISTORY = [28, 31, 45, 52, 38, 30, 27, 33, 41, 58, 49, 36, 29, 34, 44, 39, 32, 30, 34];

const powerState = { keepAwake: true, ecoMode: false };

// Home seeds on every focus, and a second seed would throw away whatever the
// demo was showing (an answered approval, a scrolled transcript).
let seeded = false;

/**
 * Replace the store's contents with the demo story, once. Called only from the
 * home screen, only when {@link demoMode} is on — the screen also skips pairing
 * and connecting in that case, because demo mode *is* the connection.
 */
export function seedDemo(): void {
  if (seeded) return;
  seeded = true;
  const machine = { hostname: "OMEN16", version: "0.1.0", ntfyTopic: "wb-976bdfffc3b5" };
  if (variant === "unauthorized") {
    useWorkbench.setState({ connState: "unauthorized", machine: null, sessions: [], lastSeen: Date.now() - 9 * 60_000 });
    return;
  }
  if (variant === "offline") {
    // Last-known metrics/power survive the drop so the System screen can grey
    // them out under an offline note — you manage a PC you can still see.
    useWorkbench.setState({
      connState: "offline",
      machine,
      sessions: [],
      metrics,
      processes,
      powerState,
      lastSeen: Date.now() - 14 * 60_000,
    });
    return;
  }
  if (variant === "empty") {
    useWorkbench.setState({ connState: "online", machine, sessions: [], lastSeen: Date.now() });
    return;
  }
  // A typo in the flag would otherwise look exactly like the default story.
  // "reboot" is a known variant of the populated story (arms the countdown below).
  if (variant !== undefined && variant !== "reboot")
    console.warn(`demo: unknown EXPO_PUBLIC_DEMO_STATE "${variant}" — showing the populated list`);

  // Story literals live in here: nothing to allocate in a build with the flag off.
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
      // Multi-line on purpose: the transcript has to collapse a long tool line to
      // its first row and offer the rest on a tap.
      {
        id: "a5",
        kind: "tool",
        name: "Bash",
        summary:
          "npx vitest run auth/rotation\n" +
          " ✓ issues a new refresh token on use\n" +
          " ✓ revokes the previous token in the same tx\n" +
          " ✗ replay after refresh fails closed (needs migration)\n" +
          " 3 passed · 1 failed",
      },
      { id: "a6", kind: "text", role: "assistant", text: "Rotation is in: the old token is revoked in the same transaction, so a replay after a refresh fails closed. The migration has to run before the tests will pass." },
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

  useWorkbench.setState({
    connState: "online",
    machine,
    sessions,
    transcripts,
    pendingApprovals: { "s-auth": [approval] },
    metrics,
    processes,
    powerState,
    // EXPO_PUBLIC_DEMO_STATE=reboot arms the countdown shot: the machine.reboot
    // push already landed, so the System screen shows the Abort countdown.
    rebootPending: variant === "reboot" ? { delaySec: 15 } : null,
    lastSeen: Date.now(),
    lastError: null,
  });
}
