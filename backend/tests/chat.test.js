// Chat.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, createRoomWithHost, joinAsParticipant } from "./_helpers/harness.js";
import { Room } from "../src/models/Room.js";

let server;
before(async () => (server = await startServer()));
after(async () => server.close());

async function room() {
  const r = await createRoomWithHost(server, "Host");
  const bob = await joinAsParticipant(server, r.roomId, "Bob");
  return { ...r, bob };
}

describe("send_message", () => {
  test("broadcasts a trimmed message with server-derived sender, role, kind, id and timestamp", async () => {
    const { host, bob } = await room();
    const since = host.mark();
    bob.client.emit("send_message", { message: "  hello there  ", senderName: "Host", senderId: "forged", role: "host" });
    const m = await host.waitFor("new_message", { since });
    assert.equal(m.message, "hello there");
    assert.deepEqual([m.senderName, m.senderId, m.role, m.kind], ["Bob", bob.userId, "participant", "guest"]);
    assert.equal(typeof m.id, "string");
    assert.ok(Math.abs(m.timestamp - Date.now()) < 5000);
    assert.ok((await bob.client.waitFor("new_message")).id === m.id, "sender gets it too");
  });

  test("a host's message carries the host role", async () => {
    const { host } = await room();
    assert.equal((await host.request("send_message", { message: "I am the host" }, "new_message")).role, "host");
  });

  test("validation: empty / whitespace / non-string / control-only / over 500 chars -> INVALID_PAYLOAD; exactly 500 is accepted", async () => {
    const { host } = await room();
    for (const message of ["", "   ", 42, { a: 1 }, ["x"], "\u0000\u0007\u202e", "x".repeat(501)]) {
      assert.equal((await host.request("send_message", { message }, "error_event")).code, "INVALID_PAYLOAD", JSON.stringify(message)?.slice(0, 30));
    }
    assert.equal((await host.request("send_message", { message: "é".repeat(500) }, "new_message")).message.length, 500);
  });

  test("control characters and bidi overrides are stripped from messages", async () => {
    const { host } = await room();
    const m = await host.request("send_message", { message: "a\u0000b\u202ec\u200bd\u0007e" }, "new_message");
    assert.equal(m.message, "abcde");
  });

  test("HTML is stored as plain text (escaping is the renderer's job; React escapes it)", async () => {
    const { host } = await room();
    assert.equal((await host.request("send_message", { message: "<img src=x onerror=alert(1)>" }, "new_message")).message, "<img src=x onerror=alert(1)>");
  });

  test("sending before join_room -> NOT_IN_ROOM; a missing payload -> INVALID_PAYLOAD", async () => {
    const owner = await server.actor().signIn("c");
    const { body } = await owner.rest("POST", "/rooms");
    const c = await owner.connect(body.roomId);
    assert.equal((await c.request("send_message", { message: "hi" }, "error_event")).code, "NOT_IN_ROOM");
    const { host } = await room();
    const since = host.mark();
    host.socket.emit("send_message");
    assert.equal((await host.waitFor("error_event", { since })).code, "INVALID_PAYLOAD");
  });
});

describe("history", () => {
  test("room history is capped at the last 100 messages with order preserved (model level)", () => {
    const r = new Room("ABC234", "owner");
    for (let i = 1; i <= 105; i++) r.addMessage({ id: String(i), message: `m${i}` });
    assert.equal(r.getMessages().length, 100);
    assert.equal(r.getMessages()[0].message, "m6");
    assert.equal(r.getMessages()[99].message, "m105");
  });

  test("a late joiner receives the stored history in room_state", async () => {
    const { roomId, host } = await room();
    await host.request("send_message", { message: "first" }, "new_message");
    await host.request("send_message", { message: "second" }, "new_message", { where: (m) => m.message === "second" });
    const late = await joinAsParticipant(server, roomId, "Late");
    assert.deepEqual(late.state.messages.map((m) => m.message), ["first", "second"]);
  });
});
