// What's listening on this machine — the phone's "is my dev server up?" screen.
// netstat + tasklist rather than `systeminformation`: si.networkConnections()
// shells out to the same netstat and drops the process name on Windows anyway.
import type { Exec } from "./files.js";
import type { Port } from "./protocol.js";
export type { Port };

// Local listeners only: a binding on a specific LAN address is someone else's
// interface, not a service on this box the phone can reach through the daemon.
const LOCAL = new Set(["0.0.0.0", "127.0.0.1", "[::]", "[::1]", "*"]);

export async function listeningPorts(exec: Exec): Promise<Port[]> {
  const names = await processNames(exec);
  const byPort = new Map<number, Port>();
  for (const line of (await exec("netstat", ["-ano"])).split(/\r?\n/)) {
    // Proto / Local / Foreign / State / PID — LISTENING is TCP-only, so UDP rows
    // (which have no state column) never match.
    // Known limitation: netstat localizes the state column (ABHÖREN on German
    // Windows, ÉCOUTE on French, ...), so on a non-English box this matches
    // nothing and the ports screen comes back empty rather than wrong. Fixing it
    // properly means dropping netstat for Get-NetTCPConnection; not worth it yet.
    const m = /^\s*TCP\s+(\S+)\s+\S+\s+LISTENING\s+(\d+)\s*$/i.exec(line);
    if (!m) continue;
    const at = m[1]!.lastIndexOf(":");
    const port = Number(m[1]!.slice(at + 1));
    if (!LOCAL.has(m[1]!.slice(0, at)) || !Number.isInteger(port)) continue;
    const pid = Number(m[2]);
    // Dedup by port: 0.0.0.0:135 and [::]:135 are one service listening twice.
    if (!byPort.has(port)) byPort.set(port, { port, pid, process: names.get(pid) ?? "?" });
  }
  return [...byPort.values()].sort((a, b) => a.port - b.port);
}

// One tasklist call for the whole table, not one per pid. CSV without headers:
// "name.exe","1234","Console","1","98,765 K"
async function processNames(exec: Exec): Promise<Map<number, string>> {
  const names = new Map<number, string>();
  // A tasklist that fails (locked-down box, missing PATH) must not cost us the
  // port list — the ports are the answer, the names are the garnish.
  const out = await exec("tasklist", ["/FO", "CSV", "/NH"]).catch(() => "");
  for (const line of out.split(/\r?\n/)) {
    const m = /^"([^"]*)","(\d+)"/.exec(line);
    if (m) names.set(Number(m[2]), m[1]!);
  }
  return names;
}
