// Room lifecycle, presence, host failover/restoration, garbage collection.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  startServer, sleep, GRACE_MS, HOST_GRACE_MS, EMPTY_TTL_MS, IDLE_TTL_MS,
  createRoomWithHost, joinAsParticipant, joinAsUser,
} from "./_helpers/harness.js";

let server;
before(async () => (server = await startServer()));
after(async () => server.close());

const info = (roomId) => server.rest("GET", `/rooms/${roomId}`);

describe("REST: create / info / join", () => {
  test("only signed-in users create rooms; the creator is the owner and gets a 6-char code", async () => {
    const owner = await server.actor().signIn("maker");
    const r = await owner.rest("POST", "/rooms");
    assert.equal(r.status, 201);
    assert.match(r.body.roomId, /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
    assert.deepEqual(Object.keys(r.body), ["roomId"]);
    assert.equal(server.roomManager.getRoom(r.body.roomId).ownerId, owner.principal.id);
  });

  test("GET room info is public and minimal; unknown room is 404 ROOM_NOT_FOUND", async () => {
    const { roomId } = await createRoomWithHost(server);
    const r = await info(roomId.toLowerCase());
    assert.equal(r.status, 200);
    assert.deepEqual(Object.keys(r.body).sort(), ["full", "maxParticipants", "participantCount", "roomId"]);
    const miss = await info("ZZZZZZ");
    assert.equal(miss.status, 404);
    assert.equal(miss.body.error.code, "ROOM_NOT_FOUND");
  });

  test("invite-link join: ONE call with a display name returns a guest identity + cookie", async () => {
    const { roomId } = await createRoomWithHost(server);
    const a = server.actor();
    const r = await a.rest("POST", `/rooms/${roomId}/join`, { displayName: "Friend" });
    assert.equal(r.status, 200);
    assert.equal(r.body.principal.kind, "guest");
    assert.equal(r.body.roomId, roomId);
    assert.ok(a.jar.get("wp_session"));
  });

  test("joining needs a name when there is no session (400), and a valid room (404)", async () => {
    const { roomId } = await createRoomWithHost(server);
    assert.equal((await server.actor().rest("POST", `/rooms/${roomId}/join`, {})).body.error.code, "USERNAME_REQUIRED");
    assert.equal((await server.actor().rest("POST", `/rooms/${roomId}/join`, { displayName: "x".repeat(30) })).body.error.code, "INVALID_PAYLOAD");
    assert.equal((await server.actor().rest("POST", `/rooms/ZZZZZZ/join`, { displayName: "A" })).status, 404);
  });

  test("a signed-in user joins with no name at all (frictionless), keeping their account identity", async () => {
    const { roomId } = await createRoomWithHost(server);
    const user = await server.actor().signIn("member", "Member");
    const r = await user.rest("POST", `/rooms/${roomId}/join`, {});
    assert.equal(r.status, 200);
    assert.equal(r.body.principal.kind, "user");
    assert.equal(r.body.principal.id, user.principal.id);
  });

  test("REST joins reserve NO seats (previously ghost seats leaked); membership starts at the socket join", async () => {
    const { roomId } = await createRoomWithHost(server);
    for (let i = 0; i < 10; i++) await server.actor().rest("POST", `/rooms/${roomId}/join`, { displayName: `G${i}` });
    assert.equal((await info(roomId)).body.participantCount, 1, "only the host's socket seat exists");
  });
});

describe("socket join and presence", () => {
  test("host gets a full room_state snapshot; identity fields come from the session", async () => {
    const { roomId, hostUserId, hostState } = await createRoomWithHost(server, "Host");
    assert.equal(hostState.roomId, roomId);
    assert.equal(hostState.hostId, hostUserId);
    assert.deepEqual(hostState.you, { id: hostUserId, username: "Host", role: "host", kind: "user", online: true, playerStatus: null });
    assert.deepEqual(hostState.messages, []);
    assert.deepEqual({ ...hostState.currentVideo, updatedAt: undefined }, { provider: null, videoId: null, mediaParams: null, playing: false, currentTime: 0, rate: 1, updatedAt: undefined, seq: 0 });
  });

  test("everyone receives user_joined with the roster; guests are labelled kind=guest", async () => {
    const { roomId, host } = await createRoomWithHost(server);
    const since = host.mark();
    const { state } = await joinAsParticipant(server, roomId, "Bob");
    const joined = await host.waitFor("user_joined", { since, where: (e) => e.participant.username === "Bob" });
    assert.equal(joined.participants.length, 2);
    assert.equal(joined.participant.kind, "guest");
    assert.equal(state.you.role, "participant");
  });

  test("duplicate display names get a numeric suffix instead of an error", async () => {
    const { roomId } = await createRoomWithHost(server, "Sam");
    const a = await joinAsParticipant(server, roomId, "Sam");
    const b = await joinAsParticipant(server, roomId, "sam");
    assert.equal(a.state.you.username, "Sam (2)");
    assert.equal(b.state.you.username, "sam (3)");
  });

  test("unknown room at the socket: ROOM_NOT_FOUND once the room is gone", async () => {
    const { roomId, hostActor } = await createRoomWithHost(server);
    const c = await hostActor.connect(roomId);
    server.roomManager.deleteRoom(roomId);
    assert.equal((await c.request("join_room", { roomId }, "error_event")).code, "ROOM_NOT_FOUND");
  });

  test("disconnect: offline immediately, removed from the roster after the grace period", async () => {
    const { roomId, host } = await createRoomWithHost(server);
    const { client: bob, userId } = await joinAsParticipant(server, roomId, "Bob");
    const since = host.mark();
    bob.close();
    const offline = await host.waitFor("participants_updated", { since });
    assert.equal(offline.participants.find((p) => p.id === userId).online, false);
    const left = await host.waitFor("user_left", { since, timeout: GRACE_MS + 1500 });
    assert.equal(left.userId, userId);
  });

  test("reconnecting within the grace period cancels removal", async () => {
    const { roomId, host } = await createRoomWithHost(server);
    const bob = await joinAsParticipant(server, roomId, "Bob");
    bob.client.close();
    await sleep(GRACE_MS / 3);
    await bob.actor.enter(roomId);
    const since = host.mark();
    await sleep(GRACE_MS + 300);
    assert.equal(host.events("user_left", since).length, 0);
    assert.equal((await info(roomId)).body.participantCount, 2);
  });

  test("leave_room removes immediately", async () => {
    const { roomId, host } = await createRoomWithHost(server);
    const { client: bob, userId } = await joinAsParticipant(server, roomId, "Bob");
    const since = host.mark();
    bob.socket.emit("leave_room");
    assert.equal((await host.waitFor("user_left", { since })).userId, userId);
  });

  test("a stale (replaced) socket's disconnect does not mark the participant offline", async () => {
    const { roomId, host } = await createRoomWithHost(server);
    const bob = await joinAsParticipant(server, roomId, "Bob");
    await bob.actor.enter(roomId); // second tab / reconnect before the first dropped
    const since = host.mark();
    bob.client.close();
    await sleep(200);
    assert.equal(host.events("participants_updated", since).length, 0);
    assert.equal(server.roomManager.getRoom(roomId).getParticipant(bob.userId).online, true);
  });
});

describe("room garbage collection", () => {
  test("a room that empties out is deleted after EMPTY_ROOM_TTL; joining during the TTL cancels it", async () => {
    const a = await createRoomWithHost(server);
    a.host.socket.emit("leave_room");
    await sleep(EMPTY_TTL_MS + 300);
    assert.equal((await info(a.roomId)).status, 404);

    const b = await createRoomWithHost(server);
    b.host.socket.emit("leave_room");
    await sleep(EMPTY_TTL_MS / 3);
    await b.hostActor.enter(b.roomId);
    await sleep(EMPTY_TTL_MS + 300);
    assert.equal((await info(b.roomId)).status, 200);
  });

  test("FIXED: a room created but never joined is reclaimed by the idle sweeper (it used to live forever)", async () => {
    const owner = await server.actor().signIn("ghost");
    const { body } = await owner.rest("POST", "/rooms");
    assert.equal((await info(body.roomId)).status, 200);
    await sleep(IDLE_TTL_MS + 600);
    assert.equal((await info(body.roomId)).status, 404);
  });

  test("an occupied room is never swept, however long it sits idle", async () => {
    const { roomId } = await createRoomWithHost(server);
    await sleep(IDLE_TTL_MS + 600);
    assert.equal((await info(roomId)).status, 200);
  });
});

describe("host disconnect, refresh and restoration", () => {
  test("host refresh (back within the grace window) never loses host and nobody else is promoted", async () => {
    const { roomId, host, hostActor, hostUserId } = await createRoomWithHost(server);
    const mod = await joinAsUser(server, roomId, "Mod");
    host.close();
    await sleep(HOST_GRACE_MS / 3);
    const again = await hostActor.enter(roomId);
    assert.equal(again.state.you.role, "host");
    await sleep(HOST_GRACE_MS + 300);
    assert.equal(server.roomManager.getRoom(roomId).hostId, hostUserId);
    assert.equal(mod.client.events("host_changed").length, 0);
  });

  test("host gone past the grace window: a signed-in participant covers; the owner regains host on return", async () => {
    const { roomId, host, hostActor, hostUserId } = await createRoomWithHost(server);
    const mod = await joinAsUser(server, roomId, "Mod");
    const viewer = await joinAsUser(server, roomId, "Viewer");
    await host.request("assign_role", { userId: mod.userId, role: "moderator" }, "role_assigned");

    host.close();
    const covered = await viewer.client.waitFor("host_changed", { timeout: HOST_GRACE_MS + 1500 });
    assert.equal(covered.hostId, mod.userId, "moderators are preferred");
    assert.equal(covered.participants.find((p) => p.id === hostUserId).role, "moderator");

    const back = await hostActor.enter(roomId);
    assert.equal(back.state.you.role, "host", "FIXED: the owner gets host back");
    assert.equal(back.state.hostId, hostUserId);
    const room = server.roomManager.getRoom(roomId);
    assert.equal(room.getParticipant(mod.userId).role, "moderator", "acting host returns to their previous role");
    assert.equal(room.getParticipant(viewer.userId).role, "participant");
  });

  test("guests are never promoted: with only guests left, the room simply has no active host until the owner returns", async () => {
    const { roomId, host, hostActor, hostUserId } = await createRoomWithHost(server);
    const guest = await joinAsParticipant(server, roomId, "OnlyGuest");
    host.close();
    await sleep(HOST_GRACE_MS + 500);
    const room = server.roomManager.getRoom(roomId);
    assert.equal(room.hostId, hostUserId);
    assert.equal(room.getParticipant(guest.userId).role, "participant");
    const since = guest.client.mark();
    guest.client.socket.emit("play");
    assert.equal((await guest.client.waitFor("error_event", { since })).code, "NOT_AUTHORIZED");
    const back = await hostActor.enter(roomId);
    assert.equal(back.state.you.role, "host");
  });

  test("the owner returning after being dropped from the roster (past the grace period) is host again", async () => {
    const { roomId, host, hostActor } = await createRoomWithHost(server);
    const mod = await joinAsUser(server, roomId, "Mod");
    host.close();
    await sleep(GRACE_MS + 400); // owner removed from roster; mod became acting host
    assert.equal(server.roomManager.getRoom(roomId).hostId, mod.userId);
    const back = await hostActor.enter(roomId);
    assert.equal(back.state.you.role, "host");
    assert.equal(back.state.participants.filter((p) => p.role === "host").length, 1);
  });

  test("an acting host cannot lock the real owner out: the owner cannot be removed or banned", async () => {
    const { roomId, host, hostUserId } = await createRoomWithHost(server);
    const mod = await joinAsUser(server, roomId, "Mod");
    const room = server.roomManager.getRoom(roomId);
    host.close();
    await sleep(50);
    room.getParticipant(hostUserId).clearDisconnectTimer(); // keep the offline owner on the roster (deterministic)
    await mod.client.waitFor("host_changed", { timeout: HOST_GRACE_MS + 1500 });
    assert.equal(room.hostId, mod.userId, "mod is the acting host");
    const err = await mod.client.request("remove_participant", { userId: hostUserId }, "error_event");
    assert.equal(err.code, "NOT_AUTHORIZED");
    assert.equal(room.isBanned(hostUserId), false);
    assert.ok(room.getParticipant(hostUserId));
  });
});
