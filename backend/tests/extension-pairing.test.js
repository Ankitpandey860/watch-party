// Extension pairing + companion sockets, end to end against the real server (REST + Socket.IO + DB).
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, createRoomWithHost, joinAsParticipant, joinAsUser, sleep } from "./_helpers/harness.js";

const EXT_ORIGIN = "chrome-extension://abcdefghijklmnopabcdefghijklmnop";
let server;
before(async () => (server = await startServer()));
after(async () => server.close());

/** Raw call the way the extension makes it: no cookies, no CSRF header, an extension Origin, optional Bearer. */
async function ext(method, path, body, { token, origin = EXT_ORIGIN } = {}) {
  const res = await fetch(`${server.url}/api/extension${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...(origin ? { origin } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, body: json };
}

async function setup() {
  const r = await createRoomWithHost(server, "Host");
  const pairing = await r.hostActor.rest("POST", "/extension/pairing", { roomId: r.roomId });
  return { ...r, pairing };
}
async function paired() {
  const s = await setup();
  const out = await ext("POST", "/pair", { code: s.pairing.body.code, label: "Chrome test" });
  return { ...s, token: out.body.token, out };
}
async function companion(token, { origin = EXT_ORIGIN } = {}) {
  const t = await ext("POST", "/socket-ticket", {}, { token });
  assert.equal(t.status, 200, JSON.stringify(t.body));
  const c = server.rawClient({ ticket: t.body.ticket }, { origin });
  await c.connected();
  return c;
}

describe("pairing codes", () => {
  test("a member gets a short formatted single-use code; it is never echoed in state or logs", async () => {
    const { pairing } = await setup();
    assert.equal(pairing.status, 201);
    assert.match(pairing.body.code, /^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/);
    assert.equal(pairing.body.expiresInSeconds, 120);
  });
  test("must be signed in, a room member, and send the CSRF header", async () => {
    const r = await createRoomWithHost(server, "Host");
    assert.equal((await server.rest("POST", "/extension/pairing", { roomId: r.roomId })).status, 401);
    assert.equal((await r.hostActor.rest("POST", "/extension/pairing", { roomId: r.roomId }, { csrf: false })).status, 403);
    const outsider = await server.actor().signIn("outsider", "Out");
    const o = await outsider.rest("POST", "/extension/pairing", { roomId: r.roomId });
    assert.equal(o.status, 403);
    assert.equal(o.body.error?.code ?? o.body.code, "NOT_IN_ROOM");
    assert.equal((await r.hostActor.rest("POST", "/extension/pairing", { roomId: "NOPE12" })).status, 404);
  });
  test("guests (who may watch) can pair too, bound to their own seat", async () => {
    const r = await createRoomWithHost(server, "Host");
    const g = await joinAsParticipant(server, r.roomId, "Guesty");
    const p = await g.actor.rest("POST", "/extension/pairing", { roomId: r.roomId });
    assert.equal(p.status, 201);
  });
  test("redeeming returns a token + roomId and the code is consumed (reuse is refused)", async () => {
    const { pairing, roomId } = await setup();
    const a = await ext("POST", "/pair", { code: pairing.body.code });
    assert.equal(a.status, 201);
    assert.match(a.body.token, /^wpx_[\w-]{40,}$/);
    assert.equal(a.body.roomId, roomId);
    const b = await ext("POST", "/pair", { code: pairing.body.code });
    assert.equal(b.status, 400);
    assert.equal((b.body.error?.code ?? b.body.code), "PAIRING_INVALID");
  });
  test("lower-case / un-hyphenated input works; junk, wrong types and wrong codes all give the same answer", async () => {
    const { pairing } = await setup();
    const sloppy = pairing.body.code.toLowerCase().replace("-", " ");
    assert.equal((await ext("POST", "/pair", { code: sloppy })).status, 201);
    for (const code of ["", "AAAA-AAAA", "short", 12345678, null, undefined, {}, [], "A".repeat(500), "0000-0000"]) {
      const r = await ext("POST", "/pair", { code });
      assert.equal(r.status, 400, JSON.stringify(code));
      assert.equal((r.body.error?.code ?? r.body.code), "PAIRING_INVALID");
    }
  });
  test("an expired code is refused (and consumed)", async () => {
    const s = await startServer({ env: { EXTENSION_PAIRING_TTL_SECONDS: "0.2" } });
    try {
      const r = await createRoomWithHost(s, "Host");
      const p = await r.hostActor.rest("POST", "/extension/pairing", { roomId: r.roomId });
      await sleep(350);
      const res = await fetch(`${s.url}/api/extension/pair`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: p.body.code }) });
      assert.equal(res.status, 400);
    } finally { await s.close(); delete process.env.EXTENSION_PAIRING_TTL_SECONDS; }
  });
  test("generating a new code voids the previous pending one", async () => {
    const r = await createRoomWithHost(server, "Host");
    const first = await r.hostActor.rest("POST", "/extension/pairing", { roomId: r.roomId });
    const second = await r.hostActor.rest("POST", "/extension/pairing", { roomId: r.roomId });
    assert.equal((await ext("POST", "/pair", { code: first.body.code })).status, 400);
    assert.equal((await ext("POST", "/pair", { code: second.body.code })).status, 201);
  });
  test("a code from a session that has since logged out cannot be redeemed", async () => {
    const r = await createRoomWithHost(server, "Host");
    const p = await r.hostActor.rest("POST", "/extension/pairing", { roomId: r.roomId });
    await server.ctx.sessions.revoke(r.hostActor.principal.sessionId, "logout");
    assert.equal((await ext("POST", "/pair", { code: p.body.code })).status, 400);
  });
});


describe("credentials and secrecy", () => {
  test("only a hash of the token is stored; the pairing code is never stored", async () => {
    const { token } = await paired();
    const rows = (await server.db.query("SELECT * FROM extension_credentials")).rows;
    assert.ok(rows.length > 0);
    for (const row of rows) assert.ok(!JSON.stringify(row).includes(token));
    const tables = (await server.db.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public'")).rows.map((r) => r.table_name);
    assert.ok(!tables.some((t) => /pairing/i.test(t)), "codes are memory-only");
  });
  test("/me works with the token and reveals nothing sensitive", async () => {
    const { token, roomId } = await paired();
    const me = await ext("GET", "/me", undefined, { token });
    assert.equal(me.status, 200);
    assert.deepEqual(Object.keys(me.body).sort(), ["expiresAt", "inRoom", "roomActive", "roomId"]);
    assert.equal(me.body.roomId, roomId);
    assert.equal(me.body.inRoom, true);
  });
  test("missing, malformed, foreign and wrong-prefix tokens are refused", async () => {
    for (const token of [undefined, "", "wpx_", "wpx_" + "a".repeat(43), "nope", "Bearer", "x".repeat(300)]) {
      assert.equal((await ext("GET", "/me", undefined, { token })).status, 401, String(token));
    }
    // a normal session cookie token is not an extension credential
    const { jar } = await server.actor().signIn("c", "C");
    assert.equal((await ext("GET", "/me", undefined, { token: [...jar.cookies.values()][0] })).status, 401);
  });
  test("the credential cannot be used for anything but its own endpoints (no cookie-style access)", async () => {
    const { token } = await paired();
    const res = await fetch(`${server.url}/api/rooms`, { method: "POST", headers: { authorization: `Bearer ${token}`, "x-requested-with": "watchparty" } });
    assert.equal(res.status, 401);
  });
  test("credential expiry is bounded by the TTL setting", async () => {
    const s = await startServer({ env: { EXTENSION_CREDENTIAL_TTL_HOURS: "0.00005" } }); // ~180 ms
    try {
      const r = await createRoomWithHost(s, "Host");
      const p = await r.hostActor.rest("POST", "/extension/pairing", { roomId: r.roomId });
      const redeem = await fetch(`${s.url}/api/extension/pair`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: p.body.code }) });
      const { token } = await redeem.json();
      await sleep(400);
      const me = await fetch(`${s.url}/api/extension/me`, { headers: { authorization: `Bearer ${token}` } });
      assert.equal(me.status, 401);
    } finally { await s.close(); delete process.env.EXTENSION_CREDENTIAL_TTL_HOURS; }
  });
});

describe("origin validation", () => {
  test("a normal website origin cannot call the extension endpoints", async () => {
    const { pairing } = await setup();
    const r = await ext("POST", "/pair", { code: pairing.body.code }, { origin: "https://evil.example" });
    assert.equal(r.status, 403);
    // ...and the code was not burned by the rejected attempt
    assert.equal((await ext("POST", "/pair", { code: pairing.body.code })).status, 201);
  });
  test("with EXTENSION_ORIGINS set only those extension ids are accepted", async () => {
    const s = await startServer({ env: { EXTENSION_ORIGINS: EXT_ORIGIN } });
    try {
      const r = await createRoomWithHost(s, "Host");
      const p = await r.hostActor.rest("POST", "/extension/pairing", { roomId: r.roomId });
      const post = (origin) => fetch(`${s.url}/api/extension/pair`, { method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify({ code: p.body.code }) });
      assert.equal((await post("chrome-extension://zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz")).status, 403);
      assert.equal((await post(EXT_ORIGIN)).status, 201);
    } finally { await s.close(); delete process.env.EXTENSION_ORIGINS; }
  });
  test("an extension origin may not open a socket with a regular user ticket", async () => {
    const r = await createRoomWithHost(server, "Host");
    const ticket = await r.hostActor.ticket(r.roomId);
    const c = server.rawClient({ ticket }, { origin: EXT_ORIGIN });
    await assert.rejects(c.connected(), (e) => e.data?.code === "TICKET_INVALID");
  });
  test("a website origin that is not allowlisted cannot open any socket", async () => {
    const { token } = await paired();
    const t = await ext("POST", "/socket-ticket", {}, { token });
    const c = server.rawClient({ ticket: t.body.ticket }, { origin: "https://evil.example" });
    await assert.rejects(c.connected());
  });
});

describe("companion socket", () => {
  test("attaches to the participant's existing seat: companion_ready carries role + canonical state; no join_room needed", async () => {
    const { token, roomId, host } = await paired();
    await host.request("change_video", { url: "https://www.netflix.com/watch/80100172" }, "sync_state");
    const c = await companion(token);
    const ready = await c.waitFor("companion_ready");
    assert.equal(ready.roomId, roomId);
    assert.equal(ready.you.role, "host");
    assert.equal(ready.state.provider, "netflix");
    assert.equal(ready.state.videoId, "80100172");
    assert.ok(ready.settings.maxModerators >= 0);
  });
  test("the ticket is single-use (replay refused) and cannot be used after the credential is revoked", async () => {
    const { token, hostActor, roomId } = await paired();
    const t = await ext("POST", "/socket-ticket", {}, { token });
    const c1 = server.rawClient({ ticket: t.body.ticket }, { origin: EXT_ORIGIN });
    await c1.connected();
    const c2 = server.rawClient({ ticket: t.body.ticket }, { origin: EXT_ORIGIN });
    await assert.rejects(c2.connected(), (e) => e.data?.code === "TICKET_INVALID");
    await hostActor.rest("POST", "/extension/revoke", { roomId });
    const again = await ext("POST", "/socket-ticket", {}, { token });
    assert.equal(again.status, 401);
  });
  test("a ticket minted before revocation is also dead (credential re-checked at handshake)", async () => {
    const { token, hostActor, roomId } = await paired();
    const t = await ext("POST", "/socket-ticket", {}, { token });
    await hostActor.rest("POST", "/extension/revoke", { roomId });
    const c = server.rawClient({ ticket: t.body.ticket }, { origin: EXT_ORIGIN });
    await assert.rejects(c.connected(), (e) => e.data?.code === "PAIRING_INVALID");
  });
  test("revoking cuts a live companion off immediately and tells it why", async () => {
    const { token, hostActor, roomId } = await paired();
    const c = await companion(token);
    const ended = c.waitFor("companion_ended");
    const r = await hostActor.rest("POST", "/extension/revoke", { roomId });
    assert.equal(r.body.revoked, 1);
    assert.equal((await ended).reason, "revoked");
    await c.waitDisconnect();
  });
  test("re-pairing replaces the old credential and kicks the old companion", async () => {
    const first = await paired();
    const c = await companion(first.token);
    const ended = c.waitFor("companion_ended");
    const p = await first.hostActor.rest("POST", "/extension/pairing", { roomId: first.roomId });
    const second = await ext("POST", "/pair", { code: p.body.code });
    assert.equal(second.status, 201);
    assert.equal((await ended).reason, "replaced");
    assert.equal((await ext("GET", "/me", undefined, { token: first.token })).status, 401);
    assert.equal((await ext("GET", "/me", undefined, { token: second.body.token })).status, 200);
  });
  test("a second connection for the same credential replaces the first (no competing heartbeats)", async () => {
    const { token } = await paired();
    const a = await companion(token);
    const ended = a.waitFor("companion_ended");
    const b = await companion(token);
    assert.equal((await ended).reason, "replaced");
    await b.waitFor("companion_ready");
  });
  test("the web app's own sockets are told when the extension connects and disconnects; status endpoint agrees", async () => {
    const { token, host, hostActor, roomId } = await paired();
    assert.deepEqual((await hostActor.rest("GET", `/extension/status?roomId=${roomId}`)).body.connected, false);
    const since = host.mark();
    const c = await companion(token);
    assert.equal((await host.waitFor("extension_status", { since })).connected, true);
    const st = await hostActor.rest("GET", `/extension/status?roomId=${roomId}`);
    assert.deepEqual([st.body.paired, st.body.connected, st.body.label], [true, true, "Chrome test"]);
    const since2 = host.mark();
    c.close();
    assert.equal((await host.waitFor("extension_status", { since: since2 })).connected, false);
  });
  test("companion disconnect does NOT mark the participant offline or trigger host failover", async () => {
    const { token, roomId } = await paired();
    const c = await companion(token);
    c.close();
    await sleep(900); // longer than the test grace timers
    const room = server.roomManager.getRoom(roomId);
    assert.equal(room.listParticipants().find((p) => p.role === "host").online, true);
  });
  test("the web seat is untouched when the web tab reconnects and the companion survives it", async () => {
    const { token, hostActor, roomId } = await paired();
    const c = await companion(token);
    const web2 = await hostActor.enter(roomId);
    assert.equal(web2.state.you.role, "host");
    assert.equal(c.socket.connected, true);
  });
});

describe("companion authorisation", () => {
  async function viewerWithCompanion(roomId) {
    const v = await joinAsParticipant(server, roomId, "Viewer");
    const p = await v.actor.rest("POST", "/extension/pairing", { roomId });
    const out = await ext("POST", "/pair", { code: p.body.code });
    return { ...v, token: out.body.token, c: await companion(out.body.token) };
  }
  test("a viewer's companion cannot control playback; the host's can, and everyone sees it", async () => {
    const h = await paired();
    await h.host.request("change_video", { url: "https://www.netflix.com/watch/80100172" }, "sync_state");
    const v = await viewerWithCompanion(h.roomId);
    const hc = await companion(h.token);
    const e = await v.c.request("seek", { time: 10 }, "error_event");
    assert.equal(e.code, "NOT_AUTHORIZED");
    const seen = v.c.waitFor("sync_state", { where: (s) => s.reason === "seek" });
    const own = await hc.request("seek", { time: 42, ref: { provider: "netflix", mediaId: "80100172" } }, "sync_state");
    assert.equal(own.currentTime, 42);
    assert.equal((await seen).currentTime, 42);
  });
  test("a companion follows the participant's CURRENT role: demotion/promotion take effect without re-pairing", async () => {
    const h = await paired();
    const m = await joinAsUser(server, h.roomId, "Mod");
    const p = await m.actor.rest("POST", "/extension/pairing", { roomId: h.roomId });
    const mc = await companion((await ext("POST", "/pair", { code: p.body.code })).body.token);
    assert.equal((await mc.request("pause", {}, "error_event")).code, "NOT_AUTHORIZED");
    await h.host.request("assign_role", { userId: m.userId, role: "moderator" }, "role_assigned");
    await h.host.request("change_video", { url: "dQw4w9WgXcQ" }, "sync_state");
    assert.equal((await mc.request("seek", { time: 7 }, "sync_state")).currentTime, 7);
    await h.host.request("update_room_settings", { moderatorsCanControl: false }, "room_settings");
    assert.equal((await mc.request("seek", { time: 9 }, "error_event")).code, "NOT_AUTHORIZED");
  });
  test("a companion cannot change the video, chat, assign roles, join or leave rooms", async () => {
    const { token, roomId, host } = await paired();
    const c = await companion(token);
    const before = server.roomManager.getRoom(roomId).currentVideo.seq;
    for (const [ev, payload] of [["change_video", { url: "dQw4w9WgXcQ" }], ["send_message", { text: "hi" }], ["assign_role", { userId: "x", role: "moderator" }],
      ["join_room", { roomId }], ["leave_room", {}], ["remove_participant", { userId: "x" }], ["transfer_host", { userId: "x" }], ["update_room_settings", { maxModerators: 9 }]]) {
      const m = c.mark();
      c.emit(ev, payload);
      await sleep(80);
      assert.equal(c.events("sync_state", m).length, 0, ev);
    }
    const room = server.roomManager.getRoom(roomId);
    assert.equal(room.currentVideo.seq, before);
    assert.equal(room.settings.maxModerators, 3);
    assert.equal(room.listParticipants().length, 1);
    assert.equal(host.socket.connected, true);
  });
  test("a stale companion command for the previous title is refused (ref check) and a wrong-title report is flagged", async () => {
    const { token, host } = await paired();
    await host.request("change_video", { url: "https://www.netflix.com/watch/80100172" }, "sync_state");
    const c = await companion(token);
    await host.request("change_video", { url: "https://www.netflix.com/watch/80100173" }, "sync_state");
    assert.equal((await c.request("seek", { time: 5, ref: { provider: "netflix", mediaId: "80100172" } }, "error_event")).code, "MEDIA_MISMATCH");
    const u = await host.request("player_status", { status: "ready", ref: { provider: "netflix", mediaId: "80100172" } }, "participants_updated");
    assert.equal(u.participants.find((p) => p.role === "host").playerStatus, "wrong_title");
  });
  test("a forged userId/roomId in a payload changes nothing: identity is the credential's", async () => {
    const h = await paired();
    const v = await viewerWithCompanion(h.roomId);
    const m = v.c.mark();
    v.c.emit("seek", { time: 5, userId: h.hostUserId, role: "host", roomId: h.roomId });
    assert.equal((await v.c.waitFor("error_event", { since: m })).code, "NOT_AUTHORIZED");
  });
  test("leaving or being removed cuts the companion; a banned user can't reconnect it", async () => {
    const h = await paired();
    const v = await viewerWithCompanion(h.roomId);
    const ended = v.c.waitFor("companion_ended");
    await h.host.request("remove_participant", { userId: v.userId }, "participant_removed");
    assert.equal((await ended).reason, "removed");
    const t = await ext("POST", "/socket-ticket", {}, { token: v.token });
    assert.ok([403, 409].includes(t.status), String(t.status));
  });
  test("the extension cannot attach until the web seat exists (and after the seat is gone)", async () => {
    const h = await paired();
    const v = await viewerWithCompanion(h.roomId);
    await v.client.request("leave_room", {}, "user_left").catch(() => {});
    const t = await ext("POST", "/socket-ticket", {}, { token: v.token });
    assert.equal(t.status, 409);
  });
  test("session logout (anywhere) cuts the companion and invalidates the credential", async () => {
    const { token, hostActor } = await paired();
    const c = await companion(token);
    const ended = c.waitDisconnect();
    await server.ctx.sessions.revoke(hostActor.principal.sessionId, "logout");
    await ended;
    assert.equal((await ext("GET", "/me", undefined, { token })).status, 401);
  });
  test("companion events are rate limited like any other socket", async () => {
    const { token } = await paired();
    const c = await companion(token);
    const m = c.mark();
    for (let i = 0; i < 80; i++) c.emit("time_sync", { time: 1 });
    await sleep(200);
    assert.ok(c.events("error_event", m).some((e) => e.code === "RATE_LIMITED"));
  });
});

describe("rate limits", () => {
  test("pair attempts per IP are limited; pairing-code creation per session is limited", async () => {
    const s = await startServer({ env: { RL_EXT_PAIR_REDEEM_PER_IP: "5", RL_EXT_PAIR_CREATE_PER_SESSION: "3" } });
    try {
      const post = (code) => fetch(`${s.url}/api/extension/pair`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code }) });
      const statuses = [];
      for (let i = 0; i < 8; i++) statuses.push((await post("AAAA-AAAA")).status);
      assert.deepEqual(statuses.slice(0, 5), [400, 400, 400, 400, 400]);
      assert.ok(statuses.slice(5).every((x) => x === 429), statuses.join());
      const r = await createRoomWithHost(s, "Host");
      const out = [];
      for (let i = 0; i < 5; i++) out.push((await r.hostActor.rest("POST", "/extension/pairing", { roomId: r.roomId })).status);
      assert.deepEqual(out, [201, 201, 201, 429, 429]);
    } finally { await s.close(); delete process.env.RL_EXT_PAIR_REDEEM_PER_IP; delete process.env.RL_EXT_PAIR_CREATE_PER_SESSION; }
  });
});
