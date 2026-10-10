// Socket.IO authentication: handshake tickets, forged identities, revocation, reconnect.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, sleep, createRoomWithHost, joinAsParticipant, joinAsUser } from "./_helpers/harness.js";

let server;
before(async () => (server = await startServer()));
after(async () => server.close());

describe("handshake tickets", () => {
  test("connecting without a ticket is refused", async () => {
    for (const auth of [undefined, {}, { ticket: "" }, { ticket: 42 }, { ticket: "x".repeat(500) }, { userId: "abc", role: "host" }]) {
      const c = server.rawClient(auth);
      await assert.rejects(() => c.connected(), (e) => e.message === "TICKET_INVALID" && e.data.code === "TICKET_INVALID");
    }
  });

  test("a made-up ticket is refused", async () => {
    const c = server.rawClient({ ticket: "A".repeat(43) });
    await assert.rejects(() => c.connected(), (e) => e.message === "TICKET_INVALID");
  });

  test("a ticket works exactly once (replay is refused)", async () => {
    const { roomId } = await createRoomWithHost(server);
    const a = await server.actor().signIn("replay");
    const ticket = await a.ticket(roomId);
    const first = await a.connect(roomId, { ticket });
    assert.ok(first.socket.connected);
    await assert.rejects(() => a.connect(roomId, { ticket }), (e) => e.message === "TICKET_INVALID");
  });

  test("tickets need an authenticated session, an existing room and no ban", async () => {
    const { roomId } = await createRoomWithHost(server);
    const anon = server.actor();
    const r1 = await anon.rest("POST", "/auth/socket-ticket", { roomId });
    assert.equal(r1.status, 401);
    const user = await server.actor().signIn("t");
    assert.equal((await user.rest("POST", "/auth/socket-ticket", { roomId: "ZZZZZZ" })).status, 404);
    assert.equal((await user.rest("POST", "/auth/socket-ticket", { roomId: "" })).status, 404);
    assert.equal((await user.rest("POST", "/auth/socket-ticket", {})).status, 404);
    const ok = await user.rest("POST", "/auth/socket-ticket", { roomId });
    assert.equal(ok.status, 200);
    assert.ok(ok.body.ticket.length >= 40 && ok.body.expiresInSeconds > 0);
  });

  test("a ticket is bound to ONE room: it cannot join another", async () => {
    const A = await createRoomWithHost(server, "OwnerA");
    const B = await createRoomWithHost(server, "OwnerB");
    const user = await server.actor().signIn("roomhopper");
    const c = await user.connect(A.roomId);
    const err = await c.request("join_room", { roomId: B.roomId }, "error_event");
    assert.equal(err.code, "NOT_AUTHORIZED");
    assert.equal(server.roomManager.getRoom(B.roomId).participants.size, 1, "never entered room B");
  });

  test("a session revoked after the ticket was minted fails the handshake", async () => {
    const { roomId } = await createRoomWithHost(server);
    const user = await server.actor().signIn("revoked");
    const ticket = await user.ticket(roomId);
    await server.ctx.sessions.revoke(user.principal.sessionId);
    await assert.rejects(() => user.connect(roomId, { ticket }), (e) => e.message === "SESSION_EXPIRED");
  });

  test("a ticket is consumed (removed from the store) the moment it is used", async () => {
    const { roomId } = await createRoomWithHost(server);
    const user = await server.actor().signIn("hash");
    const before = server.ctx.tickets.size;
    const ticket = await user.ticket(roomId);
    assert.equal(server.ctx.tickets.size, before + 1);
    await user.connect(roomId, { ticket });
    assert.equal(server.ctx.tickets.size, before, "consumed on first use");
  });
});

describe("identity comes from the session, never from the client", () => {
  test("forged userId / role / isHost / hostId in join_room are ignored", async () => {
    const { roomId, hostUserId } = await createRoomWithHost(server, "RealHost");
    const guest = server.actor();
    await guest.joinAsGuest(roomId, "Mallory");
    const c = await guest.connect(roomId);
    const state = await c.request(
      "join_room",
      { roomId, userId: hostUserId, role: "host", isHost: true, hostId: guest.principal.id, username: "RealHost", owner: true },
      "room_state",
    );
    assert.equal(state.you.id, guest.principal.id, "identity is the session's, not the claimed userId");
    assert.equal(state.you.role, "participant");
    assert.equal(state.you.kind, "guest");
    assert.equal(state.hostId, hostUserId);
    assert.equal(state.participants.find((p) => p.id === hostUserId).username, "RealHost");
    assert.equal(server.roomManager.getRoom(roomId).ownerId, hostUserId);
  });

  test("knowing the host's (public) id grants nothing: every privileged action is refused", async () => {
    const { roomId, hostUserId, host } = await createRoomWithHost(server, "Boss");
    const { client: victim, userId: victimId } = await joinAsParticipant(server, roomId, "Victim");
    const { client: attacker } = await joinAsParticipant(server, roomId, "Attacker");
    const before = server.roomManager.getRoom(roomId).currentVideo.seq;
    const attempts = [
      ["play", undefined], ["pause", undefined],
      ["seek", { time: 5, userId: hostUserId }],
      ["change_video", { url: "dQw4w9WgXcQ", userId: hostUserId }],
      ["assign_role", { userId: victimId, role: "moderator", actingAs: hostUserId }],
      ["remove_participant", { userId: victimId, actingAs: hostUserId }],
      ["transfer_host", { userId: attacker.state?.you?.id ?? "x", actingAs: hostUserId }],
    ];
    for (const [event, payload] of attempts) {
      const since = attacker.mark();
      payload === undefined ? attacker.socket.emit(event) : attacker.emit(event, payload);
      const err = await attacker.waitFor("error_event", { since });
      assert.equal(err.code, "NOT_AUTHORIZED", event);
    }
    const room = server.roomManager.getRoom(roomId);
    assert.equal(room.hostId, hostUserId);
    assert.equal(room.currentVideo.seq, before, "no playback change happened");
    assert.ok(room.getParticipant(victimId), "victim was not removed");
    assert.ok(host && victim);
  });

  test("a guest cannot become moderator or host, even if the host tries", async () => {
    const { roomId, host } = await createRoomWithHost(server);
    const { userId: gid } = await joinAsParticipant(server, roomId, "Guesty");
    assert.equal((await host.request("assign_role", { userId: gid, role: "moderator" }, "error_event")).code, "NOT_AUTHORIZED");
    assert.equal((await host.request("transfer_host", { userId: gid }, "error_event")).code, "NOT_AUTHORIZED");
    assert.equal(server.roomManager.getRoom(roomId).getParticipant(gid).role, "participant");
  });

  test("one user's valid session cannot act as another user", async () => {
    const { roomId, hostUserId } = await createRoomWithHost(server, "H");
    const other = await joinAsUser(server, roomId, "Other");
    assert.notEqual(other.userId, hostUserId);
    assert.equal(other.state.you.role, "participant");
    assert.equal((await other.client.request("remove_participant", { userId: hostUserId }, "error_event")).code, "NOT_AUTHORIZED");
  });
});

describe("session end while connected", () => {
  test("logout disconnects that session's sockets immediately with auth_expired", async () => {
    const { roomId } = await createRoomWithHost(server);
    const user = await server.actor().signIn("bye");
    const c = await user.enter(roomId);
    const gone = c.waitDisconnect();
    const out = await user.rest("POST", "/auth/logout");
    assert.equal(out.status, 200);
    await gone;
    assert.equal(c.events("auth_expired").at(-1).reason, "logout");
    assert.equal((await user.rest("POST", "/auth/socket-ticket", { roomId })).status, 401, "and no new ticket can be minted");
  });

  test("revoking a session (e.g. 'sign out everywhere') cuts every live socket", async () => {
    const { roomId } = await createRoomWithHost(server);
    const user = await server.actor().signIn("everywhere");
    const c1 = await user.connect(roomId);
    const c2 = await user.connect(roomId);
    const gone = Promise.all([c1.waitDisconnect(), c2.waitDisconnect()]);
    await server.ctx.sessions.revokeAllForUser(user.principal.id, "revoked");
    await gone;
    assert.equal(c1.events("auth_expired")[0].reason, "revoked");
  });

  test("re-authenticating mid-room ends the old socket with reason 'rotated' (client reconnects with the new session)", async () => {
    const { roomId } = await createRoomWithHost(server);
    const guest = server.actor();
    await guest.joinAsGuest(roomId, "Rotator");
    const c = await guest.enter(roomId);
    const gone = c.waitDisconnect();
    const email = "rotator@example.test";
    await guest.rest("POST", "/auth/otp/request", { email });
    const code = server.outbox.at(-1).text.match(/\b(\d{6})\b/)[1];
    await guest.rest("POST", "/auth/otp/verify", { email, code });
    await gone;
    assert.equal(c.events("auth_expired")[0].reason, "rotated");
  });
});

describe("reconnect", () => {
  test("a moderator who reconnects (fresh ticket) keeps their role and is not duplicated", async () => {
    const { roomId, host } = await createRoomWithHost(server);
    const mod = await joinAsUser(server, roomId, "Mod");
    await host.request("assign_role", { userId: mod.userId, role: "moderator" }, "role_assigned");
    mod.client.close();
    await sleep(100);
    const again = await mod.actor.enter(roomId);
    assert.equal(again.state.you.role, "moderator");
    assert.equal(again.state.participants.filter((p) => p.id === mod.userId).length, 1);
    assert.equal(again.state.you.id, mod.userId, "same identity");
  });

  test("a guest who reconnects keeps the same identity (cookie session), not a new participant", async () => {
    const { roomId } = await createRoomWithHost(server);
    const g = await joinAsParticipant(server, roomId, "Stayer");
    g.client.close();
    await sleep(100);
    const again = await g.actor.enter(roomId);
    assert.equal(again.state.you.id, g.userId);
    assert.equal(again.state.participants.filter((p) => p.kind === "guest").length, 1);
  });
});
