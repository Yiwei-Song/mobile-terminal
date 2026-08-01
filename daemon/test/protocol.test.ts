import { describe, it, expect } from "vitest";
import { parseClientMsg } from "../src/protocol.js";

describe("protocol", () => {
  it("parses a valid request", () => {
    const m = parseClientMsg(JSON.stringify({ type: "req", id: "1", method: "sessions.list" }));
    expect(m).toEqual({ type: "req", id: "1", method: "sessions.list" });
  });

  it("parses auth", () => {
    const m = parseClientMsg(JSON.stringify({ type: "auth", token: "abc" }));
    expect(m).toEqual({ type: "auth", token: "abc" });
  });

  it("returns null on garbage, unknown method, and missing fields", () => {
    expect(parseClientMsg("not json")).toBeNull();
    expect(parseClientMsg(JSON.stringify({ type: "req", id: "1", method: "hack.everything" }))).toBeNull();
    expect(parseClientMsg(JSON.stringify({ type: "auth" }))).toBeNull();
    expect(parseClientMsg(JSON.stringify({ type: "req", method: "sessions.list" }))).toBeNull();
    expect(parseClientMsg(JSON.stringify({ type: "nope" }))).toBeNull();
    expect(parseClientMsg("null")).toBeNull();
    expect(parseClientMsg('"a string"')).toBeNull();
  });

  it("does not treat Object.prototype members as methods", () => {
    for (const method of ["constructor", "toString", "valueOf", "__proto__", "hasOwnProperty"]) {
      expect(parseClientMsg(JSON.stringify({ type: "req", id: "1", method, params: {} }))).toBeNull();
    }
  });

  it("accepts well-formed params", () => {
    const m = parseClientMsg(
      JSON.stringify({ type: "req", id: "2", method: "sessions.new", params: { cwd: "C:\\x", prompt: "hi" } }),
    );
    expect(m).toEqual({ type: "req", id: "2", method: "sessions.new", params: { cwd: "C:\\x", prompt: "hi" } });
    expect(
      parseClientMsg(
        JSON.stringify({ type: "req", id: "3", method: "sessions.approve", params: { sessionId: "s", requestId: "r", allow: false } }),
      ),
    ).not.toBeNull();
  });

  it("accepts config.get with no params and config.set with a topic or null", () => {
    const req = (method: string, params?: unknown) =>
      parseClientMsg(JSON.stringify({ type: "req", id: "1", method, params }));
    expect(req("config.get")).toEqual({ type: "req", id: "1", method: "config.get" });
    expect(req("config.set", { ntfyTopic: "wb-abc" })).not.toBeNull();
    expect(req("config.set", { ntfyTopic: null })).not.toBeNull();
    // Absent is not the same as null: only an explicit null clears the topic.
    expect(req("config.set")).toBeNull();
    expect(req("config.set", { ntfyTopic: 7 })).toBeNull();
    expect(req("config.set", {})).toBeNull();
  });

  it("validates term.* params, bounding cols/rows at the wire", () => {
    const req = (method: string, params?: unknown) =>
      parseClientMsg(JSON.stringify({ type: "req", id: "1", method, params }));
    expect(req("term.list")).toEqual({ type: "req", id: "1", method: "term.list" });
    expect(req("term.create", { cwd: "C:\\x", cols: 80, rows: 24 })).not.toBeNull();
    expect(req("term.write", { termId: "t", data: "ls\r" })).not.toBeNull();
    expect(req("term.resize", { termId: "t", cols: 1, rows: 1000 })).not.toBeNull();
    expect(req("term.kill", { termId: "t" })).not.toBeNull();
    expect(req("term.scrollback", { termId: "t" })).not.toBeNull();

    // A pty rejects fractions and would happily allocate a screen for 1e6 cols.
    for (const bad of [0, -1, 1001, 80.5, "80", null, undefined]) {
      expect(req("term.create", { cwd: "C:\\x", cols: bad, rows: 24 })).toBeNull();
      expect(req("term.create", { cwd: "C:\\x", cols: 80, rows: bad })).toBeNull();
      expect(req("term.resize", { termId: "t", cols: bad, rows: 24 })).toBeNull();
    }
    expect(req("term.create", { cols: 80, rows: 24 })).toBeNull(); // no cwd
    expect(req("term.write", { data: "x" })).toBeNull(); // no termId
    expect(req("term.write", { termId: "t" })).toBeNull(); // no data
    expect(req("term.kill", {})).toBeNull();
    expect(req("term.scrollback", { termId: 7 })).toBeNull();
  });

  it("rejects requests whose params do not match the method", () => {
    // Without this the returned value is typed as having params it does not have.
    expect(parseClientMsg(JSON.stringify({ type: "req", id: "1", method: "sessions.new" }))).toBeNull();
    expect(
      parseClientMsg(JSON.stringify({ type: "req", id: "1", method: "sessions.new", params: { cwd: "C:\\x" } })),
    ).toBeNull();
    expect(
      parseClientMsg(JSON.stringify({ type: "req", id: "1", method: "sessions.send", params: { sessionId: "s" } })),
    ).toBeNull();
    expect(
      parseClientMsg(JSON.stringify({ type: "req", id: "1", method: "sessions.approve", params: { sessionId: "s", requestId: "r", allow: "yes" } })),
    ).toBeNull();
    expect(
      parseClientMsg(JSON.stringify({ type: "req", id: "1", method: "sessions.new", params: { cwd: "C:\\x", prompt: "hi", title: 7 } })),
    ).toBeNull();
  });
});
