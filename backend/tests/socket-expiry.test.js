// Time-based expiry. Separate file (own process) because it needs very short TTLs.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, sleep } from "./_helpers/harness.js";

let server;
before(async () => (server = await startServer({ env: { SOCKET_TICKET_TTL_SECONDS: "0.3", GUEST_SESSION_TTL_HOURS: "0.0004" } })));
after(async () => server.close());

async function roomFor(label) {
  const owner = await server.actor().signIn(label);
  const { body } = await owner.rest("POST", "/rooms");
  return { owner, roomId: body.roomId };
}

test("an unused ticket expires after its TTL", async () => {
  const { roomId } = await roomFor("ttl");
  const user = await server.actor().signIn("ttl-user");
  const ticket = await user.ticket(roomId);
  await sleep(450);
  await assert.rejects(() => user.connect(roomId, { ticket }), (e) => e.message === "TICKET_INVALID");
});

test("a session that expires WHILE connected ends the socket with auth_expired (reason: expired)", async () => {
  const { roomId } = await roomFor("expiry");
  const guest = server.actor();
  await guest.joinAsGuest(roomId, "ShortLived"); // guest TTL = ~1.4s in this file
  const c = await guest.enter(roomId);
  assert.ok(c.socket.connected);
  await c.waitDisconnect(4000);
  assert.equal(c.events("auth_expired").at(-1).reason, "expired");
  // ...and the expired session can no longer mint tickets or be used at all:
  await sleep(100);
  assert.equal((await guest.rest("POST", "/auth/socket-ticket", { roomId })).status, 401);
  assert.equal((await guest.rest("GET", "/auth/me")).body.principal, null);
});
