import { describe, it, expect } from "vitest";

import { WorkbenchClient, type ConnState } from "../src/lib/client";
import { startDaemon, until, idle, type FakeQuery, type Daemon } from "./harness";
import type { SessionEvent, SessionRow } from "@shared/protocol";

// Every test here talks to a real in-process daemon over a real WebSocket.

const connectTo = (d: Daemon, opts?: { baseDelayMs?: number }) => {
  const states: ConnState[] = [];
  const events: SessionEvent[] = [];
  const client = new WorkbenchClient(
    d.url,
    d.token,
    { onEvent: (e) => events.push(e), onState: (s) => states.push(s) },
    opts,
  );
  client.connect();
  return { client, states, events };
};

describe("WorkbenchClient", () => {
  it("authenticates and answers a request", async () => {
    const d = await startDaemon(idle());
    const { client, states } = connectTo(d);

    await until("online", () => states.includes("online"));
    expect(states).toEqual(["connecting", "online"]);
    expect(await client.request<SessionRow[]>("sessions.list")).toEqual([]);

    client.close();
    await d.close();
  });

  it("rejects a request made while offline instead of queueing it", async () => {
    const d = await startDaemon(idle());
    const client = new WorkbenchClient(d.url, d.token, { onEvent: () => {}, onState: () => {} });
    // Not connected yet: honest failure now beats a write that lands minutes later.
    await expect(client.request("sessions.list")).rejects.toThrow("offline");
    await d.close();
  });

  it("rejects on timeout and leaves the socket usable", async () => {
    // A CLI that never reports an id: sessions.new waits on it forever, which is
    // the only way to get a request the daemon genuinely never answers.
    const stuck: FakeQuery = () =>
      (async function* () {
        await new Promise<void>(() => {});
      })();
    const d = await startDaemon(stuck);
    const { client, states } = connectTo(d);
    await until("online", () => states.includes("online"));

    await expect(
      client.request("sessions.new", { cwd: "C:\\proj", prompt: "hang" }, 30),
    ).rejects.toThrow("timed out");
    // The timeout is per request, not a connection failure.
    expect(states).toEqual(["connecting", "online"]);
    expect(await client.request<SessionRow[]>("sessions.list")).toEqual([]);

    client.close();
    await d.close();
  });

  it("rejects everything in flight when the connection drops", async () => {
    const stuck: FakeQuery = () =>
      (async function* () {
        await new Promise<void>(() => {});
      })();
    const d = await startDaemon(stuck);
    const { client, states } = connectTo(d, { baseDelayMs: 10 });
    await until("online", () => states.includes("online"));

    const inFlight = client.request("sessions.new", { cwd: "C:\\proj", prompt: "hang" });
    await d.close();
    await expect(inFlight).rejects.toThrow("connection closed");
    expect(states).toContain("offline");

    client.close();
  });

  it("backs off, reconnects to a daemon restarted on the same port, and re-auths", async () => {
    const d = await startDaemon(idle());
    const { client, states } = connectTo(d, { baseDelayMs: 10 });
    await until("online", () => states.includes("online"));

    await d.close();
    await until("offline", () => states.includes("offline"));
    // Backoff, not a hot loop: nothing to connect to for a few attempts.
    await until("retrying", () => states.filter((s) => s === "connecting").length >= 2);

    // Same port and same data dir: to the phone this is the laptop waking up.
    const again = await startDaemon(idle(), { dir: d.dir, port: d.port });
    await until("back online", () => states.filter((s) => s === "online").length === 2);
    expect(await client.request<SessionRow[]>("sessions.list")).toEqual([]);

    client.close();
    await again.close();
  });

  it("stops reconnecting after close()", async () => {
    const d = await startDaemon(idle());
    const { client, states } = connectTo(d, { baseDelayMs: 5 });
    await until("online", () => states.includes("online"));

    client.close();
    await d.close();
    const seen = states.length;
    await new Promise((r) => setTimeout(r, 60));
    expect(states.length).toBe(seen);
  });

  it("delivers pushed session events", async () => {
    const d = await startDaemon(idle());
    const { client, states, events } = connectTo(d);
    await until("online", () => states.includes("online"));

    await client.request("sessions.new", { cwd: "C:\\proj", prompt: "hello there" });
    await until("echo arrived", () => events.some((e) => e.kind === "session.text"));
    expect(events).toContainEqual({ kind: "session.text", sessionId: "s1", role: "user", text: "hello there" });
    expect(events).toContainEqual({ kind: "session.status", sessionId: "s1", status: "running", title: "hello there" });

    client.close();
    await d.close();
  });
});
