// Rate limiting, capacity and room safety. Own process: it needs tight limits.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, sleep, uniqueEmail, createRoomWithHost, joinAsParticipant } from "./_helpers/harness.js";

let server;
before(async () => (server = await startServer({
  env: {
    MAX_PARTICIPANTS_PER_ROOM: "3", MAX_ROOMS_PER_USER: "2", MAX_ROOMS: "8",
    RL_GUEST_PER_IP: "4", RL_OTP_REQUEST_PER_IP: "5", RL_OTP_REQUEST_PER_EMAIL: "2",
    RL_OTP_VERIFY_PER_IP: "6", RL_OTP_VERIFY_PER_EMAIL: "4", RL_ROOM_CREATE_PER_USER: "3",
    RL_ROOM_CREATE_PER_IP: "100000", RL_ROOM_LOOKUP_PER_IP: "15", RL_TICKET_PER_SESSION: "4",
    RL_OAUTH_START_PER_IP: "3", RL_API_PER_IP: "100000", OTP_RESEND_COOLDOWN_SECONDS: "0",
  },
})));
after(async () => server.close());

const reset = () => server.roomManager.rooms.clear();

describe("REST rate limits", () => {
  test("guest identities: limited per IP, with Retry-After and a stable error shape", async () => {
    const results = [];
    for (let i = 0; i < 6; i++) results.push(await server.actor().rest("POST", "/auth/guest", { displayName: `g${i}` }));
    assert.deepEqual(results.map((r) => r.status), [201, 201, 201, 201, 429, 429]);
    const limited = results[4];
    assert.equal(limited.body.error.code, "RATE_LIMITED");
    assert.ok(limited.body.error.retryAfterSeconds >= 1);
    assert.ok(Number(limited.headers.get("retry-after")) >= 1);
  });

  test("invite-link joins share the guest limit (guest identities can't be minted through the other door)", async () => {
    // guest budget (4) is already spent by the previous test -> joining as a new guest is refused
    const { roomId } = await createRoomWithHost(server);
    const r = await server.actor().rest("POST", `/rooms/${roomId}/join`, { displayName: "Late" });
    assert.equal(r.status, 429);
    assert.equal(r.body.error.code, "RATE_LIMITED");
  });

  test("OTP requests: per-email limit (2) bites before the per-IP limit", async () => {
    const email = uniqueEmail("flood");
    const codes = [];
    for (let i = 0; i < 4; i++) codes.push((await server.actor().rest("POST", "/auth/otp/request", { email })).status);
    assert.deepEqual(codes, [200, 200, 429, 429]);
  });

  test("OTP requests: per-IP limit (5) applies across different emails", async () => {
    const statuses = [];
    for (let i = 0; i < 4; i++) statuses.push((await server.actor().rest("POST", "/auth/otp/request", { email: uniqueEmail(`ip${i}`) })).status);
    // 2 spent above by the first test + these 4 -> the 5th request overall is the last allowed
    assert.ok(statuses.includes(429), `statuses: ${statuses}`);
  });

  test("OTP verification attempts are limited per email AND per IP (brute-force guard in front of the attempt cap)", async () => {
    const email = uniqueEmail("guess");
    const statuses = [];
    for (let i = 0; i < 6; i++) statuses.push((await server.actor().rest("POST", "/auth/otp/verify", { email, code: "000000" })).status);
    assert.deepEqual(statuses.slice(0, 4), [400, 400, 400, 400]);
    assert.deepEqual(statuses.slice(4), [429, 429]);
  });

  test("Google sign-in start is limited per IP", async () => {
    const statuses = [];
    for (let i = 0; i < 5; i++) statuses.push((await server.actor().rest("GET", "/auth/google/start", undefined, { raw: true })).status);
    assert.deepEqual(statuses, [302, 302, 302, 429, 429]);
  });

  test("room lookups are limited per IP (room-code enumeration guard)", async () => {
    const statuses = [];
    for (let i = 0; i < 18; i++) statuses.push((await server.rest("GET", "/rooms/ZZZZZZ")).status);
    assert.equal(statuses.filter((s) => s === 404).length, 15);
    assert.equal(statuses.filter((s) => s === 429).length, 3);
  });

  test("socket tickets are limited per session", async () => {
    reset();
    const owner = await server.actor().signIn("tix");
    const { body } = await owner.rest("POST", "/rooms");
    const statuses = [];
    for (let i = 0; i < 6; i++) statuses.push((await owner.rest("POST", "/auth/socket-ticket", { roomId: body.roomId })).status);
    assert.deepEqual(statuses, [200, 200, 200, 200, 429, 429]);
  });

  test("room creation: per-user open-room cap (2), and a per-user rate limit (3 requests/window, capped attempts count too)", async () => {
    reset();
    const owner = await server.actor().signIn("maker");
    assert.equal((await owner.rest("POST", "/rooms")).status, 201); // hit 1
    assert.equal((await owner.rest("POST", "/rooms")).status, 201); // hit 2
    const capped = await owner.rest("POST", "/rooms"); // hit 3: over the open-room cap
    assert.equal(capped.status, 409);
    assert.equal(capped.body.error.code, "ROOM_LIMIT");
    reset(); // pretend the rooms ended: the cap is no longer the problem...
    const limited = await owner.rest("POST", "/rooms"); // hit 4: ...but the request budget is spent
    assert.equal(limited.status, 429);
    assert.equal(limited.body.error.code, "RATE_LIMITED");
  });
});

describe("capacity", () => {
  test("a full room (3) refuses new guests over REST AND at the socket, without reserving anything", async () => {
    reset();
    const { roomId } = await createRoomWithHost(server, "Host");
    // the guest limiter is exhausted for this IP; sign-in users are not limited by it:
    const u1 = await server.actor().signIn("u1"); await u1.enter(roomId);
    const u2 = await server.actor().signIn("u2"); await u2.enter(roomId);
    const room = server.roomManager.getRoom(roomId); // (the REST lookup limiter was exhausted on purpose above)
    assert.deepEqual([room.participants.size, room.isFull()], [3, true]);

    const u3 = await server.actor().signIn("u3");
    const r = await u3.rest("POST", `/rooms/${roomId}/join`, {});
    assert.equal(r.status, 409);
    assert.equal(r.body.error.code, "ROOM_FULL");
    const c = await u3.connect(roomId); // a ticket can still be minted; the socket join enforces capacity
    assert.equal((await c.request("join_room", { roomId }, "error_event")).code, "ROOM_FULL");
    assert.equal(server.roomManager.getRoom(roomId).participants.size, 3);
  });

  test("an existing member can always reconnect to a full room", async () => {
    reset();
    const { roomId } = await createRoomWithHost(server, "Host");
    const u1 = await server.actor().signIn("m1"); const c1 = await u1.enter(roomId);
    const u2 = await server.actor().signIn("m2"); await u2.enter(roomId);
    c1.close();
    await sleep(80);
    const again = await u1.enter(roomId);
    assert.equal(again.state.participants.length, 3);
  });

  test("global room cap (8): further creations get 503 SERVER_BUSY", async () => {
    reset();
    const owners = [];
    for (let i = 0; i < 4; i++) owners.push(await server.actor().signIn(`cap${i}`));
    for (const o of owners) { await o.rest("POST", "/rooms"); await o.rest("POST", "/rooms"); }
    assert.equal(server.roomManager.rooms.size, 8);
    const extra = await server.actor().signIn("cap-extra");
    const r = await extra.rest("POST", "/rooms");
    assert.equal(r.status, 503);
    assert.equal(r.body.error.code, "SERVER_BUSY");
    reset();
  });
});

describe("socket event rate limits", () => {
  test("chat: a burst beyond the bucket is rejected with RATE_LIMITED; normal pacing is never limited", async () => {
    reset();
    const { host } = await createRoomWithHost(server, "Chatty");
    const since = host.mark();
    for (let i = 0; i < 30; i++) host.emit("send_message", { message: `spam ${i}` });
    await sleep(400);
    const delivered = host.events("new_message", since).length;
    const limited = host.events("error_event", since).filter((e) => e.code === "RATE_LIMITED");
    assert.ok(delivered >= 8 && delivered <= 10, `delivered ${delivered}`);
    assert.ok(limited.length >= 18, `limited ${limited.length}`);
    assert.ok(limited[0].retryAfterMs > 0);
    // humans: one message every ~0.3s is fine
    const { host: calm } = await createRoomWithHost(server, "Calm");
    for (let i = 0; i < 6; i++) { await calm.request("send_message", { message: `hi ${i}` }, "new_message", { where: (m) => m.message === `hi ${i}` }); await sleep(300); }
  });

  test("playback: 150 rapid seeks are cut off (the old unlimited behaviour is gone) and the abuser is disconnected", async () => {
    reset();
    const { host, roomId } = await createRoomWithHost(server, "Seeker");
    const since = host.mark();
    for (let i = 0; i < 150; i++) host.emit("seek", { time: i });
    await host.waitDisconnect(3000);
    const applied = host.events("sync_state", since).length;
    assert.ok(applied >= 20 && applied <= 30, `applied ${applied}`);
    assert.ok(host.events("error_event", since).some((e) => e.code === "RATE_LIMITED"));
    // The server is fine and a fresh connection (new bucket) works:
    assert.equal((await server.rest("GET", "/health")).status, 200);
    assert.ok(server.roomManager.getRoom(roomId));
  });

  test("admin actions (role/remove/transfer) are throttled too", async () => {
    reset();
    const { host } = await createRoomWithHost(server, "Admin");
    const since = host.mark();
    for (let i = 0; i < 25; i++) host.emit("assign_role", { userId: "nobody", role: "moderator" });
    await sleep(300);
    assert.ok(host.events("error_event", since).filter((e) => e.code === "RATE_LIMITED").length >= 10);
  });

  test("join_room attempts are throttled (re-join flooding)", async () => {
    reset();
    const owner = await server.actor().signIn("joiner");
    const { body } = await owner.rest("POST", "/rooms");
    const c = await owner.connect(body.roomId);
    const since = c.mark();
    for (let i = 0; i < 12; i++) c.emit("join_room", { roomId: body.roomId });
    await sleep(300);
    assert.ok(c.events("error_event", since).filter((e) => e.code === "RATE_LIMITED").length >= 5);
  });
});

describe("limiter internals", () => {
  test("WindowLimiter counts per key, resets after the window, and stays memory-bounded", async () => {
    const { WindowLimiter } = await import("../src/infra/rateLimiter.js");
    let t = 0;
    const l = new WindowLimiter({ windowMs: 1000, max: 2, now: () => t, maxKeys: 100 });
    assert.deepEqual([l.hit("a").allowed, l.hit("a").allowed, l.hit("a").allowed, l.hit("b").allowed], [true, true, false, true]);
    t = 1001;
    assert.equal(l.hit("a").allowed, true, "window reset");
    for (let i = 0; i < 5000; i++) l.hit(`flood-${i}`);
    assert.ok(l.hits.size <= 100, `size ${l.hits.size}`);
  });

  test("TokenBucket refills over time", async () => {
    const { TokenBucket } = await import("../src/infra/rateLimiter.js");
    let t = 0;
    const b = new TokenBucket({ capacity: 2, refillPerSec: 1, now: () => t });
    assert.deepEqual([b.take(), b.take(), b.take()], [true, true, false]);
    t = 1000;
    assert.deepEqual([b.take(), b.take()], [true, false]);
  });
});
