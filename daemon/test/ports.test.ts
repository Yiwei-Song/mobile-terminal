import { describe, it, expect } from "vitest";
import { listeningPorts } from "../src/ports.js";
import type { Exec } from "../src/files.js";

// Real `netstat -ano` output, trimmed: local + wildcard + IPv6 listeners, one
// remote-bound listener, and ESTABLISHED/UDP noise that must be ignored.
const NETSTAT = `
Active Connections

  Proto  Local Address          Foreign Address        State           PID
  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       1234
  TCP    0.0.0.0:445            0.0.0.0:0              LISTENING       4
  TCP    127.0.0.1:8790         0.0.0.0:0              LISTENING       5678
  TCP    192.168.1.20:139       0.0.0.0:0              LISTENING       4
  TCP    127.0.0.1:8790         127.0.0.1:51000        ESTABLISHED     5678
  TCP    [::]:135               [::]:0                 LISTENING       1234
  TCP    [::1]:8790             [::]:0                 LISTENING       5678
  UDP    0.0.0.0:5353           *:*                                    999
`;

const TASKLIST = `
"svchost.exe","1234","Services","0","12,345 K"
"System","4","Services","0","1,000 K"
"node.exe","5678","Console","1","98,765 K"
`;

function fakeExec(netstat = NETSTAT, tasklist = TASKLIST) {
  const calls: { file: string; args: string[] }[] = [];
  const exec: Exec = async (file, args) => {
    calls.push({ file, args });
    return file === "netstat" ? netstat : tasklist;
  };
  return { exec, calls };
}

describe("listeningPorts", () => {
  it("parses LISTENING lines, maps pid to process name, dedups, and floats dev servers", async () => {
    const f = fakeExec();
    const ports = await listeningPorts(f.exec);
    expect(ports).toEqual([
      { port: 8790, pid: 5678, process: "node.exe", dev: true },
      { port: 135, pid: 1234, process: "svchost.exe", dev: false },
      { port: 445, pid: 4, process: "System", dev: false },
    ]);
    // One tasklist call for the whole table, not one per pid.
    expect(f.calls.map((c) => c.file).sort()).toEqual(["netstat", "tasklist"]);
    expect(f.calls.find((c) => c.file === "netstat")!.args).toEqual(["-ano"]);
  });

  it("skips ESTABLISHED, UDP and non-local bindings", async () => {
    const ports = await listeningPorts(fakeExec().exec);
    expect(ports.find((p) => p.port === 139)).toBeUndefined(); // 192.168.1.20 binding
    expect(ports.find((p) => p.port === 5353)).toBeUndefined(); // UDP
    expect(ports).toHaveLength(3);
  });

  it("falls back to a placeholder name when tasklist has no row", async () => {
    const ports = await listeningPorts(fakeExec(NETSTAT, "").exec);
    expect(ports.every((p) => p.process === "?")).toBe(true);
    // An unnamed owner is not evidence of plumbing — only the well-known ports
    // still demote, so a dev server on a locked-down box stays visible.
    expect(ports.find((p) => p.port === 8790)!.dev).toBe(true);
    expect(ports.find((p) => p.port === 135)!.dev).toBe(false);
  });

  it("still lists ports when tasklist fails outright", async () => {
    const exec: Exec = async (file) => {
      if (file === "tasklist") throw new Error("access denied");
      return NETSTAT;
    };
    const ports = await listeningPorts(exec);
    expect(ports.map((p) => p.port)).toEqual([8790, 135, 445]);
  });

  it("demotes system owners and the ephemeral RPC range, keeps unfamiliar dev owners", async () => {
    const netstat = `
  TCP    0.0.0.0:5432           0.0.0.0:0              LISTENING       10
  TCP    0.0.0.0:49670          0.0.0.0:0              LISTENING       11
  TCP    0.0.0.0:9229           0.0.0.0:0              LISTENING       12
  TCP    0.0.0.0:5985           0.0.0.0:0              LISTENING       13
`;
    const tasklist = `
"com.docker.backend.exe","10","Console","1","1 K"
"node.exe","11","Console","1","1 K"
"lsass.exe","12","Services","0","1 K"
"ruby.exe","13","Console","1","1 K"
`;
    const ports = await listeningPorts(fakeExec(netstat, tasklist).exec);
    expect(ports.map((p) => [p.port, p.dev])).toEqual([
      [5432, true], // unfamiliar owner, ordinary port — a dev server until proven otherwise
      [5985, false], // WinRM, whoever claims to own it
      [9229, false], // lsass
      [49670, false], // ephemeral RPC range, even for node
    ]);
  });

  it("returns nothing for empty output", async () => {
    expect(await listeningPorts(fakeExec("", "").exec)).toEqual([]);
  });
});
