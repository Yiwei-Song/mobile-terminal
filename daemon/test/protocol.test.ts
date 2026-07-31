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
