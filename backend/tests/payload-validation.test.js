// Malformed Socket.IO packets must never crash the server, corrupt room state, or leak internals.
// (Regression coverage for the original `socket.emit("seek", null)` process-killing bug.)
import { test, describe, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { io as ioClient } from "socket.io-client";
import { startServer, sleep, createRoomWithHost, joinAsParticipant } from "./_helpers/harness.js";

const PAYLOAD_EVENTS = ["join_room", "seek", "change_video", "time_sync", "assign_role", "remove_participant", "transfer_host", "send_message"];

// Anything that is not a plain object (`undefined` is serialised as null on the wire).
const NON_OBJECTS = { null: null, string: "abc", number: 42, boolean: true, "empty array": [], "array of objects": [{ time: 1 }, { userId: "x" }] };

// Objects with hostile FIELD values: they pass the structural guard, so handler validation must cope.
const HOSTILE_OBJECTS = {
  "empty object": {},
  "fields as objects": { roomId: {}, userId: {}, username: {}, time: {}, url: {}, videoId: {}, role: {}, message: {}, seq: {} },
  "fields as arrays": { roomId: [], userId: [], username: [], time: [1], url: [], videoId: [], role: [], message: [], seq: [] },
  "prototype pollution shape": JSON.parse('{"__proto__":{"polluted":1},"constructor":{"prototype":{"polluted":1}},"time":1}'),
  "null fields": { roomId: null, userId: null, time: null, url: null, message: null, seq: null },
  "NaN-like strings": { time: "NaN", userId: "undefined", role: "null", seq: "NaN" },
  "negative / huge numbers": { time: -1e308, userId: 1e308, seq: 1e308 },
  "deeply nested": JSON.parse(`${'{"a":'.repeat(40)}1${"}".repeat(40)}`),
  "12 KB string fields": { roomId: "x".repeat(4000), userId: "y".repeat(4000), url: "z".repeat(4000), message: "m".repeat(4000) },
};

let server;
let uncaught = [];
const onUncaught = (err) => uncaught.push(err);

before(async () => {
  process.on("uncaughtException", onUncaught);
  server = await startServer();
});
beforeEach(() => { uncaught.length = 0; });
after(async () => {
  process.off("uncaughtException", onUncaught);
  await server.close();
});

const healthOk = async () => (await server.rest("GET", "/health")).status === 200;

async function scene() {
  const { roomId, host } = await createRoomWithHost(server, "Host");
  const viewer = (await joinAsParticipant(server, roomId, "Viewer")).client;
  const strangerActor = server.actor();
  await strangerActor.joinAsGuest(roomId, "Stranger");
  const stranger = await strangerActor.connect(roomId); // authenticated, ticketed, but never joined
  return { roomId, host, viewer, stranger };
}

describe("non-object payloads are rejected before any handler runs", () => {
  for (const [shape, payload] of Object.entries(NON_OBJECTS)) {
    test(`${shape}: every payload event answers INVALID_PAYLOAD, mutates nothing, the socket survives`, async () => {
      const { roomId, host, viewer, stranger } = await scene();
      const room = server.roomManager.getRoom(roomId);
      const before = JSON.stringify({ seq: room.currentVideo.seq, roster: room.publicRoster(), host: room.hostId, bans: [...room.bans] });
      const sinceViewer = viewer.mark();

      for (const sender of [host, stranger]) {
        for (const event of PAYLOAD_EVENTS) {
          const err = await sender.request(event, payload, "error_event");
          assert.equal(err.code, "INVALID_PAYLOAD", `${event} <- ${shape}`);
          assert.deepEqual(Object.keys(err).sort(), ["code", "message"]);
          assert.doesNotMatch(JSON.stringify(err), /TypeError|destructure|\.js:|stack|undefined/i);
        }
      }
      assert.ok(host.socket.connected && stranger.socket.connected);
      for (const ev of ["sync_state", "new_message", "role_assigned", "host_changed", "participant_removed"]) {
        await viewer.expectNone(ev, { since: sinceViewer, ms: 20 });
      }
      assert.equal(JSON.stringify({ seq: room.currentVideo.seq, roster: room.publicRoster(), host: room.hostId, bans: [...room.bans] }), before);
      assert.deepEqual(uncaught, []);
      assert.equal(await healthOk(), true);
    });
  }
});

describe("objects with hostile field values never crash the server", () => {
  for (const [shape, payload] of Object.entries(HOSTILE_OBJECTS)) {
    test(`${shape}: all payload events, joined and not joined`, async () => {
      const { host, stranger } = await scene();
      for (const sender of [host, stranger]) for (const event of PAYLOAD_EVENTS) sender.emit(event, payload);
      await sleep(250);
      assert.ok(host.socket.connected || host.events("error_event").some((e) => e.code === "RATE_LIMITED"), "host survived (or was rate-limited, never crashed)");
      assert.deepEqual(uncaught, []);
      assert.equal(await healthOk(), true);
      assert.equal(({}).polluted, undefined, "Object.prototype was not polluted");
    });
  }
});

describe("oversized packets", () => {
  test("a 200 KB packet closes that connection; the server and other clients are unaffected", async () => {
    const { roomId, host, hostActor } = await createRoomWithHost(server, "Host");
    const attackerActor = server.actor();
    await attackerActor.joinAsGuest(roomId, "Big");
    const ticket = await attackerActor.ticket(roomId);
    const attacker = ioClient(server.url, { transports: ["websocket"], forceNew: true, reconnection: false, auth: { ticket } });
    await new Promise((resolve, reject) => { attacker.once("connect", resolve); attacker.once("connect_error", reject); });
    const closed = new Promise((resolve) => attacker.once("disconnect", resolve));
    attacker.emit("send_message", { message: "x".repeat(200_000) });
    await Promise.race([closed, sleep(2000).then(() => { throw new Error("oversized packet did not close the connection"); })]);
    assert.equal(attacker.connected, false);
    assert.equal(host.socket.connected, true);
    assert.equal((await joinAsParticipant(server, roomId, "StillWorks")).state.roomId, roomId);
    assert.deepEqual(uncaught, []);
    assert.equal(await healthOk(), true);
    attacker.close();
    assert.ok(hostActor);
  });

  test("a legitimate maximum-size chat message (500 chars of multi-byte text) is still accepted", async () => {
    const { host } = await createRoomWithHost(server, "Host");
    assert.equal((await host.request("send_message", { message: "é".repeat(500) }, "new_message")).message.length, 500);
  });
});
