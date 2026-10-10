// Unit tests for socket/safeHandler.js using a fake socket (no network).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { onPayload, onSignal, isPlainObject } from "../src/socket/safeHandler.js";

function fakeSocket() {
  const listeners = new Map();
  const emitted = [];
  return {
    id: "fake-socket",
    data: {},
    disconnected: false,
    disconnect() { this.disconnected = true; },
    on: (event, fn) => listeners.set(event, fn),
    emit: (event, payload) => emitted.push({ event, payload }),
    fire: (event, ...args) => listeners.get(event)(...args),
    emitted,
  };
}

describe("isPlainObject", () => {
  test("accepts plain objects only", () => {
    assert.equal(isPlainObject({}), true);
    assert.equal(isPlainObject({ a: 1 }), true);
    assert.equal(isPlainObject(Object.create(null)), true);
    assert.equal(isPlainObject(JSON.parse('{"__proto__":{"x":1}}')), true);
    for (const bad of [null, undefined, "x", 1, true, [], [1], new Map(), new Date(), () => {}]) {
      assert.equal(isPlainObject(bad), false, String(bad));
    }
  });
});

describe("onPayload", () => {
  test("passes a plain object through unchanged", () => {
    const s = fakeSocket();
    const seen = [];
    onPayload(s, "seek", (p) => seen.push(p));
    const payload = { time: 5 };
    s.fire("seek", payload);
    assert.deepEqual(seen, [payload]);
    assert.equal(seen[0], payload);
    assert.equal(s.emitted.length, 0);
  });

  test("a bare emit (undefined) reaches the handler as {} — legacy behaviour preserved", () => {
    const s = fakeSocket();
    const seen = [];
    onPayload(s, "seek", (p) => seen.push(p));
    s.fire("seek");
    assert.deepEqual(seen, [{}]);
  });

  test("null / string / number / boolean / array are rejected with INVALID_PAYLOAD and the handler never runs", () => {
    for (const bad of [null, "abc", 42, true, [], [{ time: 1 }]]) {
      const s = fakeSocket();
      let called = false;
      onPayload(s, "seek", () => { called = true; });
      s.fire("seek", bad);
      assert.equal(called, false, JSON.stringify(bad));
      assert.deepEqual(s.emitted, [
        { event: "error_event", payload: { code: "INVALID_PAYLOAD", message: "Malformed request payload." } },
      ]);
    }
  });

  test("a handler that throws is contained: generic INTERNAL_ERROR to the client, no internals leaked", () => {
    const s = fakeSocket();
    onPayload(s, "seek", () => { throw new TypeError("secret internal detail at /srv/app/x.js:1"); });
    assert.doesNotThrow(() => s.fire("seek", { time: 1 }));
    assert.equal(s.emitted.length, 1);
    const { event, payload } = s.emitted[0];
    assert.equal(event, "error_event");
    assert.deepEqual(Object.keys(payload).sort(), ["code", "message"]);
    assert.equal(payload.code, "INTERNAL_ERROR");
    assert.doesNotMatch(JSON.stringify(payload), /secret|\.js|TypeError|stack/i);
  });

  test("an AppError thrown by the handler keeps its own safe code/message", async () => {
    const { AppError } = await import("../src/constants/errors.js");
    const s = fakeSocket();
    onPayload(s, "seek", () => { throw new AppError("NOT_AUTHORIZED", "Nope.", 403); });
    s.fire("seek", {});
    assert.deepEqual(s.emitted[0].payload, { code: "NOT_AUTHORIZED", message: "Nope." });
    // (Expected client errors are relayed without an error-level server log.)
  });

  test("the rejected payload's content is never echoed back", () => {
    const s = fakeSocket();
    onPayload(s, "send_message", () => {});
    s.fire("send_message", "<script>alert('LEAK-ME')</script>");
    assert.doesNotMatch(JSON.stringify(s.emitted), /LEAK-ME/);
  });
});

describe("rate limiting inside onPayload / onSignal", () => {
  test("a bucket lets the burst through, then rejects with RATE_LIMITED + retry hint", async () => {
    const { BUCKETS } = await import("../src/socket/limits.js");
    const s = fakeSocket();
    let calls = 0;
    onPayload(s, "send_message", () => { calls++; }, { bucket: "chat" });
    for (let i = 0; i < BUCKETS.chat.capacity + 5; i++) s.fire("send_message", { message: "x" });
    assert.equal(calls, BUCKETS.chat.capacity);
    const limited = s.emitted.filter((e) => e.payload.code === "RATE_LIMITED");
    assert.equal(limited.length, 5);
    assert.equal(limited[0].payload.retryAfterMs, 1000);
  });

  test("a socket that keeps tripping the limiter is disconnected", async () => {
    const { STRIKE_LIMIT } = await import("../src/socket/limits.js");
    const s = fakeSocket();
    onSignal(s, "play", () => {}, { bucket: "playback" });
    for (let i = 0; i < 20 + STRIKE_LIMIT + 5; i++) s.fire("play");
    assert.equal(s.disconnected, true);
  });

  test("malformed payloads are rejected BEFORE they consume rate-limit budget", () => {
    const s = fakeSocket();
    let calls = 0;
    onPayload(s, "send_message", () => { calls++; }, { bucket: "chat" });
    for (let i = 0; i < 50; i++) s.fire("send_message", null);
    s.fire("send_message", { message: "ok" });
    assert.equal(calls, 1);
  });

  test("onSignal contains handler exceptions", () => {
    const s = fakeSocket();
    onSignal(s, "leave_room", () => { throw new TypeError("secret detail"); });
    assert.doesNotThrow(() => s.fire("leave_room"));
    assert.equal(s.emitted[0].payload.code, "INTERNAL_ERROR");
    assert.doesNotMatch(JSON.stringify(s.emitted), /secret/);
  });
});
