import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, createRoomWithHost, joinAsParticipant } from "./_helpers/harness.js";

let server;
before(async () => (server = await startServer()));
after(async () => server.close());

test("smoke: user creates room, guest joins by invite, both connected with server-derived identities", async () => {
  const { roomId, host, hostState } = await createRoomWithHost(server, "Host");
  assert.equal(hostState.you.role, "host");
  const { state, userId } = await joinAsParticipant(server, roomId, "Friend");
  assert.equal(state.you.role, "participant");
  assert.equal(state.you.kind, "guest");
  assert.equal(state.you.id, userId);
  assert.equal(state.participants.length, 2);
  assert.ok(host);
});
