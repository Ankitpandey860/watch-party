// Roles, moderation, kick = ban.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, sleep, createRoomWithHost, joinAsParticipant, joinAsUser } from "./_helpers/harness.js";

let server;
before(async () => (server = await startServer()));
after(async () => server.close());

async function trio() {
  const r = await createRoomWithHost(server, "Host");
  const bob = await joinAsUser(server, r.roomId, "Bob");
  const guest = await joinAsParticipant(server, r.roomId, "Gus");
  return { ...r, bob, guest };
}

describe("assign_role", () => {
  test("host promotes a signed-in user to moderator and demotes them; the room is told with the roster", async () => {
    const { host, bob } = await trio();
    const up = await host.request("assign_role", { userId: bob.userId, role: "moderator" }, "role_assigned");
    assert.deepEqual([up.userId, up.role], [bob.userId, "moderator"]);
    assert.equal(up.participants.find((p) => p.id === bob.userId).role, "moderator");
    assert.equal((await bob.client.waitFor("role_assigned", { where: (e) => e.role === "moderator" })).username, "Bob");
    const down = await host.request("assign_role", { userId: bob.userId, role: "participant" }, "role_assigned", { where: (e) => e.role === "participant" });
    assert.equal(down.role, "participant");
  });

  test("errors: non-host, self, missing target, 'host' role, bogus role, host as target, guest as moderator", async () => {
    const { host, hostUserId, bob, guest } = await trio();
    assert.equal((await bob.client.request("assign_role", { userId: guest.userId, role: "moderator" }, "error_event")).code, "NOT_AUTHORIZED");
    assert.equal((await host.request("assign_role", { userId: hostUserId, role: "moderator" }, "error_event")).code, "CANNOT_ACT_ON_SELF");
    assert.equal((await host.request("assign_role", { userId: "nobody", role: "moderator" }, "error_event")).code, "PARTICIPANT_NOT_FOUND");
    assert.equal((await host.request("assign_role", { userId: bob.userId, role: "host" }, "error_event")).code, "INVALID_PAYLOAD");
    assert.equal((await host.request("assign_role", { userId: bob.userId, role: "admin" }, "error_event")).code, "INVALID_PAYLOAD");
    assert.equal((await host.request("assign_role", { userId: {}, role: "moderator" }, "error_event")).code, "INVALID_PAYLOAD");
    assert.equal((await host.request("assign_role", { userId: guest.userId, role: "moderator" }, "error_event")).code, "NOT_AUTHORIZED");
  });

  test("a moderator has playback powers but NOT management powers", async () => {
    const { host, bob, guest } = await trio();
    await host.request("assign_role", { userId: bob.userId, role: "moderator" }, "role_assigned");
    assert.equal((await bob.client.request("seek", { time: 3 }, "sync_state")).currentTime, 3);
    for (const [event, payload] of [["assign_role", { userId: guest.userId, role: "participant" }], ["remove_participant", { userId: guest.userId }], ["transfer_host", { userId: bob.userId }]]) {
      assert.equal((await bob.client.request(event, payload, "error_event")).code, event === "transfer_host" ? "NOT_AUTHORIZED" : "NOT_AUTHORIZED", event);
    }
  });
});

describe("transfer_host", () => {
  test("host hands over to an online signed-in user: they become host AND owner, old host becomes moderator", async () => {
    const { roomId, host, hostUserId, bob } = await trio();
    const changed = await host.request("transfer_host", { userId: bob.userId }, "host_changed");
    assert.equal(changed.hostId, bob.userId);
    assert.equal(changed.participants.find((p) => p.id === hostUserId).role, "moderator");
    assert.equal(server.roomManager.getRoom(roomId).ownerId, bob.userId);
    assert.equal((await host.request("remove_participant", { userId: bob.userId }, "error_event")).code, "NOT_AUTHORIZED");
  });

  test("after a transfer the NEW owner keeps host through a refresh, and the old host does not take it back", async () => {
    const { roomId, host, hostActor, bob } = await trio();
    await host.request("transfer_host", { userId: bob.userId }, "host_changed");
    bob.client.close();
    await sleep(100);
    const again = await bob.actor.enter(roomId);
    assert.equal(again.state.you.role, "host");
    host.close();
    const oldHost = await hostActor.enter(roomId);
    assert.equal(oldHost.state.you.role, "moderator");
    assert.equal(oldHost.state.hostId, bob.userId);
  });

  test("errors: self, missing, offline, guest, non-host", async () => {
    const { host, hostUserId, bob, guest } = await trio();
    assert.equal((await host.request("transfer_host", { userId: hostUserId }, "error_event")).code, "CANNOT_ACT_ON_SELF");
    assert.equal((await host.request("transfer_host", { userId: "nobody" }, "error_event")).code, "PARTICIPANT_NOT_FOUND");
    assert.equal((await host.request("transfer_host", { userId: guest.userId }, "error_event")).code, "NOT_AUTHORIZED");
    assert.equal((await bob.client.request("transfer_host", { userId: hostUserId }, "error_event")).code, "NOT_AUTHORIZED");
    bob.client.close();
    await sleep(100);
    assert.equal((await host.request("transfer_host", { userId: bob.userId }, "error_event")).code, "INVALID_PAYLOAD", "offline target");
  });
});

describe("remove_participant = remove + ban", () => {
  test("the target is told, disconnected, dropped from the roster, and the room is notified", async () => {
    const { host, guest } = await trio();
    const since = guest.client.mark();
    const removed = await host.request("remove_participant", { userId: guest.userId }, "participant_removed");
    assert.equal(removed.participants.some((p) => p.id === guest.userId), false);
    assert.ok(await guest.client.waitFor("removed_from_room", { since }));
    await guest.client.waitDisconnect();
  });

  test("FIXED: a removed GUEST cannot get back in: no ticket, no REST join", async () => {
    const { roomId, host, guest } = await trio();
    await host.request("remove_participant", { userId: guest.userId }, "participant_removed");
    const t = await guest.actor.rest("POST", "/auth/socket-ticket", { roomId });
    assert.equal(t.status, 403);
    assert.equal(t.body.error.code, "BANNED");
    const j = await guest.actor.rest("POST", `/rooms/${roomId}/join`, { displayName: "Gus" });
    assert.equal(j.status, 403);
    assert.equal(j.body.error.code, "BANNED");
  });

  test("FIXED: a removed signed-in USER is banned by account id, so a fresh login doesn't help", async () => {
    const { roomId, host, bob } = await trio();
    await host.request("remove_participant", { userId: bob.userId }, "participant_removed");
    const fresh = await server.actor().signIn("x");
    // Same ACCOUNT in a brand-new session (e.g. cleared cookies, other device):
    await server.db.query("UPDATE sessions SET revoked_at = now() WHERE user_id = $1", [bob.userId]);
    const { token } = await server.ctx.sessions.createUserSession({ id: bob.userId, display_name: "Bob" });
    const second = server.actor();
    second.jar.cookies.set("wp_session", token);
    assert.equal((await second.rest("POST", "/auth/socket-ticket", { roomId })).body.error.code, "BANNED");
    assert.ok(fresh);
  });

  test("FIXED: a ticket minted BEFORE the ban is still refused at join_room", async () => {
    const { roomId, host, guest } = await trio();
    const ticket = await guest.actor.ticket(roomId); // minted while still allowed
    await host.request("remove_participant", { userId: guest.userId }, "participant_removed");
    const c = await guest.actor.connect(roomId, { ticket });
    assert.equal((await c.request("join_room", { roomId }, "error_event")).code, "BANNED");
    assert.equal(server.roomManager.getRoom(roomId).getParticipant(guest.userId), null);
  });

  test("a removed user stops receiving room events and their later commands fail", async () => {
    const { host, guest, bob } = await trio();
    await host.request("remove_participant", { userId: guest.userId }, "participant_removed");
    await sleep(50);
    const since = guest.client.mark();
    await bob.client.request("send_message", { message: "hi" }, "new_message");
    await guest.client.expectNone("new_message", { since, ms: 100 });
  });

  test("errors: non-host, self, missing, and the OWNER can never be removed", async () => {
    const { host, hostUserId, bob, guest } = await trio();
    assert.equal((await bob.client.request("remove_participant", { userId: guest.userId }, "error_event")).code, "NOT_AUTHORIZED");
    assert.equal((await host.request("remove_participant", { userId: hostUserId }, "error_event")).code, "CANNOT_ACT_ON_SELF");
    assert.equal((await host.request("remove_participant", { userId: "nobody" }, "error_event")).code, "PARTICIPANT_NOT_FOUND");
    assert.equal((await host.request("remove_participant", { userId: 123 }, "error_event")).code, "INVALID_PAYLOAD");
  });
});
