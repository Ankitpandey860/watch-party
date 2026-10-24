// Service-worker coordinator tests with a fake socket, fake server responses, fake tabs and a fake clock.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createController } from "../src/background/controller.js";
import { makeClock } from "./helpers.js";

class FakeSocket {
  constructor() { this.handlers = new Map(); this.emitted = []; this.disconnected = false; }
  on(e, fn) { this.handlers.set(e, fn); return this; }
  emit(e, p) { this.emitted.push([e, p]); }
  removeAllListeners() { this.handlers.clear(); }
  disconnect() { this.disconnected = true; }
  fire(e, p) { this.handlers.get(e)?.(p); }
  sent(e) { return this.emitted.filter(([n]) => n === e).map(([, p]) => p); }
}
const json = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body });
const flush = () => new Promise((r) => setImmediate(r));

function rig({ fetchHandler } = {}) {
  const clock = makeClock();
  const store = {};
  const tabMsgs = [];
  const sockets = [];
  const fetches = [];
  const timers = [];
  const ctl = createController({
    storage: { get: async (k) => ({ [k]: store[k] }), set: async (o) => Object.assign(store, o) },
    fetchImpl: async (url, init) => { fetches.push({ url, init }); return (fetchHandler || (() => json(200, { ticket: "T".repeat(30) })))(url, init); },
    connectSocket: (server, ticket) => { const s = new FakeSocket(); s.server = server; s.ticket = ticket; sockets.push(s); return s; },
    sendToTab: (tabId, msg) => tabMsgs.push({ tabId, msg }),
    now: clock.now, setTimer: (fn, ms) => { const t = { fn, ms }; timers.push(t); return t; }, clearTimer: (t) => { if (t) t.cancelled = true; },
  });
  const fire = () => { const t = timers.filter((x) => !x.cancelled).pop(); if (t) { t.cancelled = true; t.fn(); } };
  return { ctl, clock, store, tabMsgs, sockets, fetches, timers, fire, sock: () => sockets.at(-1) };
}
const NETFLIX = { provider: "netflix", videoId: "80100172", playing: false, currentTime: 0, rate: 1, seq: 1 };
const ready = (role = "host", state = NETFLIX, settings = { moderatorsCanControl: true, maxModerators: 3 }) => ({ roomId: "ROOM12", you: { id: "u1", role }, settings, state });
const report = (o = {}) => ({ kind: "report", titleId: "80100172", adapter: "netflix-cadmium", status: "ok", page: "watch", state: { playing: false, position: 0, duration: 100, rate: 1 }, caps: { play: true, pause: true, seek: true, rate: false }, ...o });

async function pairedRig(role = "host", opts) {
  const r = rig({ fetchHandler: (url) => (url.endsWith("/pair") ? json(201, { token: "wpx_" + "a".repeat(43), roomId: "ROOM12", expiresAt: "2099-01-01T00:00:00Z" }) : json(200, { ticket: "T".repeat(30) })), ...opts });
  const out = await r.ctl.pair({ serverUrl: "https://wp.example.com/x", code: "ABCD-EFGH" });
  assert.equal(out.ok, true);
  await flush();
  r.sock().fire("companion_ready", ready(role));
  return r;
}

describe("pairing", () => {
  test("pair() stores the credential, normalises the server to an origin, and connects with a ticket", async () => {
    const r = await pairedRig();
    assert.equal(r.store.wp.server, "https://wp.example.com");
    assert.match(r.store.wp.token, /^wpx_/);
    assert.equal(r.sock().server, "https://wp.example.com");
    assert.equal(r.ctl.state.connection, "connected");
    const ticketCall = r.fetches.find((f) => f.url.endsWith("/socket-ticket"));
    assert.equal(ticketCall.init.headers.authorization, `Bearer ${r.store.wp.token}`);
  });
  test("the pairing request carries only the code and a label — nothing from Netflix", async () => {
    const r = await pairedRig();
    const body = JSON.parse(r.fetches.find((f) => f.url.endsWith("/pair")).init.body);
    assert.deepEqual(Object.keys(body).sort(), ["code", "label"]);
    assert.equal(r.fetches.find((f) => f.url.endsWith("/pair")).init.headers.authorization, undefined);
  });
  test("bad server addresses and failed codes surface a message and store nothing", async () => {
    const r = rig({ fetchHandler: () => json(400, { error: { code: "PAIRING_INVALID", message: "That pairing code is invalid or has expired." } }) });
    assert.equal((await r.ctl.pair({ serverUrl: "http://evil.example.com", code: "X" })).ok, false);
    const bad = await r.ctl.pair({ serverUrl: "https://wp.example.com", code: "AAAA-AAAA" });
    assert.equal(bad.ok, false);
    assert.match(bad.error, /invalid or has expired/);
    assert.equal(r.store.wp, undefined);
    assert.equal((await rig({ fetchHandler: () => { throw new Error("net"); } }).ctl.pair({ serverUrl: "https://x.io", code: "A" })).ok, false);
  });
  test("init() after a service-worker restart reconnects from storage", async () => {
    const r = rig();
    r.store.wp = { server: "https://wp.example.com", token: "wpx_" + "b".repeat(43), roomId: "ROOM12", expiresAt: "x" };
    await r.ctl.init(); await flush();
    assert.equal(r.sockets.length, 1);
    assert.equal(r.ctl.state.paired, true);
  });
  test("init() ignores a tampered stored server (non-https, non-loopback)", async () => {
    const r = rig();
    r.store.wp = { server: "http://evil.example.com", token: "wpx_x", roomId: "R" };
    await r.ctl.init();
    assert.equal(r.ctl.state.paired, false);
    assert.equal(r.sockets.length, 0);
  });
  test("revoked credential (401 on ticket) => unpaired, storage cleared, tabs told", async () => {
    const r = rig({ fetchHandler: () => json(401, { error: { code: "PAIRING_INVALID" } }) });
    r.store.wp = { server: "https://wp.example.com", token: "wpx_" + "c".repeat(43), roomId: "R" };
    await r.ctl.init(); await flush();
    assert.equal(r.ctl.state.connection, "unpaired");
    assert.equal(r.store.wp, null);
    assert.match(r.ctl.state.lastError, /revoked|expired/i);
  });
  test("unpair() calls /disconnect with the bearer token, clears storage and closes the socket", async () => {
    const r = await pairedRig();
    const token = r.store.wp.token;
    await r.ctl.unpair();
    const d = r.fetches.find((f) => f.url.endsWith("/disconnect"));
    assert.equal(d.init.headers.authorization, `Bearer ${token}`);
    assert.equal(r.store.wp, null);
    assert.equal(r.sock().disconnected, true);
  });
  test("companion_ended (revoked / replaced / removed) unpairs; (left_room) waits for the room instead", async () => {
    for (const reason of ["revoked", "replaced", "removed"]) {
      const r = await pairedRig();
      r.sock().fire("companion_ended", { reason });
      await flush();
      assert.equal(r.ctl.state.connection, "unpaired", reason);
    }
    const r = await pairedRig();
    r.sock().fire("companion_ended", { reason: "left_room" });
    await flush();
    assert.equal(r.ctl.state.connection, "waiting-for-room");
    assert.equal(r.ctl.state.paired, true);
  });
});

describe("connection resilience", () => {
  test("server unreachable => retries with backoff and a fresh ticket each time", async () => {
    let fail = true;
    const r = rig({ fetchHandler: () => { if (fail) throw new Error("offline"); return json(200, { ticket: "T".repeat(30) }); } });
    r.store.wp = { server: "https://wp.example.com", token: "wpx_" + "d".repeat(43), roomId: "R" };
    await r.ctl.init(); await flush();
    assert.equal(r.ctl.state.connection, "disconnected");
    fail = false;
    r.fire(); await flush();
    assert.equal(r.sockets.length, 1);
  });
  test("socket dropped => reconnect scheduled; the room state is re-sent on companion_ready (late-join path)", async () => {
    const r = await pairedRig();
    r.sock().fire("disconnect");
    assert.equal(r.ctl.state.connection, "disconnected");
    r.fire(); await flush();
    assert.equal(r.sockets.length, 2);
    r.sock().fire("companion_ready", ready("host", { ...NETFLIX, seq: 9, playing: true, currentTime: 321 }));
    assert.equal(r.ctl.state.connection, "connected");
    assert.equal(r.ctl.state.room.seq, 9);
  });
  test("409 (web seat missing) => 'waiting-for-room' and keeps retrying", async () => {
    const r = rig({ fetchHandler: () => json(409, { error: { code: "NOT_IN_ROOM" } }) });
    r.store.wp = { server: "https://wp.example.com", token: "wpx_" + "e".repeat(43), roomId: "R" };
    await r.ctl.init(); await flush();
    assert.equal(r.ctl.state.connection, "waiting-for-room");
    assert.ok(r.timers.some((t) => !t.cancelled));
  });
  test("404 (room ended) stops retrying", async () => {
    const r = rig({ fetchHandler: () => json(404, { error: { code: "ROOM_NOT_FOUND" } }) });
    r.store.wp = { server: "https://wp.example.com", token: "wpx_" + "f".repeat(43), roomId: "R" };
    await r.ctl.init(); await flush();
    assert.equal(r.ctl.state.connection, "room-ended");
    assert.equal(r.timers.filter((t) => !t.cancelled).length, 0);
  });
  test("a stale async connect (superseded by unpair) cannot resurrect the session", async () => {
    let release = null;
    const r = rig({ fetchHandler: (url) => (url.endsWith("/socket-ticket") ? new Promise((res) => { release = () => res(json(200, { ticket: "T".repeat(30) })); }) : json(200, {})) });
    r.store.wp = { server: "https://wp.example.com", token: "wpx_" + "g".repeat(43), roomId: "R" };
    const init = r.ctl.init();
    await flush();
    await r.ctl.unpair();
    release(); await init; await flush();
    assert.equal(r.sockets.length, 0);
  });
});

describe("room state -> tabs", () => {
  test("a matching tab receives the canonical target; a stale (older seq) broadcast is ignored", async () => {
    const r = await pairedRig("participant");
    const reply = r.ctl.onReport(7, report());
    assert.equal(reply.target.mediaId, "80100172");
    r.tabMsgs.length = 0;
    r.sock().fire("sync_state", { ...NETFLIX, seq: 5, playing: true, currentTime: 50 });
    assert.equal(r.tabMsgs.at(-1).msg.target.seq, 5);
    r.sock().fire("sync_state", { ...NETFLIX, seq: 3, playing: false, currentTime: 1 });
    assert.equal(r.ctl.state.room.seq, 5);
  });
  test("wrong-title tab gets NO target and a clear note; status says wrong-title", async () => {
    const r = await pairedRig("participant");
    const reply = r.ctl.onReport(7, report({ titleId: "80100999" }));
    assert.equal(reply.target, null);
    assert.match(reply.note, /different title/);
    assert.equal(r.ctl.getStatus().tab.state, "wrong-title");
  });
  test("multiple tabs: only the best matching tab is the target; others are told another tab is synced", async () => {
    const r = await pairedRig("participant");
    r.ctl.onReport(1, report({ state: { playing: false, position: 0, duration: 1, rate: 1 } }), { active: false });
    const a = r.ctl.onReport(2, report(), { active: true });
    const b = r.ctl.onReport(1, report(), { active: false });
    assert.ok(a.target, "active tab is the player");
    assert.equal(b.target, null);
    assert.match(b.note, /Another Netflix tab/);
  });
  test("a room on another provider (e.g. YouTube) gives tabs no Netflix target", async () => {
    const r = await pairedRig("participant");
    r.sock().fire("sync_state", { provider: "youtube", videoId: "dQw4w9WgXcQ", playing: true, currentTime: 3, rate: 1, seq: 2 });
    assert.equal(r.ctl.onReport(7, report()).target, null);
  });
  test("closing the target tab promotes another one and updates status", async () => {
    const r = await pairedRig("participant");
    r.ctl.onReport(1, report(), { active: true });
    r.ctl.onReport(2, report(), { active: false });
    r.ctl.onTabClosed(1);
    assert.ok(r.ctl.onReport(2, report()).target);
  });
});

describe("player_status reporting (informational, server derives wrong_title)", () => {
  test("reports ready/no_player/wrong_title transitions once each, not on every heartbeat", async () => {
    const r = await pairedRig("participant");
    const ps = () => r.sock().sent("player_status").map((p) => p.status);
    r.ctl.onReport(1, report());
    r.ctl.onReport(1, report()); r.ctl.onReport(1, report());
    assert.deepEqual(ps().filter((s) => s === "ready").length, 1);
    r.ctl.onReport(1, report({ titleId: "80100999" }));
    assert.equal(r.sock().sent("player_status").at(-1).ref.mediaId, "80100999");
    r.ctl.onTabClosed(1);
    assert.equal(r.sock().sent("player_status").at(-1).status, "no_player");
  });
  test("a player with no usable controls is reported as unsupported; blocked autoplay as blocked", async () => {
    const r = await pairedRig("participant");
    r.ctl.onReport(1, report({ caps: { play: false, pause: false, seek: false, rate: false } }));
    assert.equal(r.sock().sent("player_status").at(-1).status, "unsupported");
    r.ctl.onReport(1, report({ status: "blocked" }));
    assert.equal(r.sock().sent("player_status").at(-1).status, "blocked");
  });
});

describe("user actions -> server (permissions are enforced server-side; the extension never invents them)", () => {
  test("host: pause/play/seek are forwarded with the title ref", async () => {
    const r = await pairedRig("host");
    r.ctl.onReport(1, report());
    r.ctl.onReport(1, report({ userAction: "seek", state: { playing: false, position: 900, duration: 1, rate: 1 } }));
    assert.deepEqual(r.sock().sent("seek").at(-1), { time: 900, ref: { provider: "netflix", mediaId: "80100172" } });
    r.ctl.onReport(1, report({ userAction: "play", state: { playing: true, position: 900, duration: 1, rate: 1 } }));
    assert.deepEqual(r.sock().sent("play").at(-1), { ref: { provider: "netflix", mediaId: "80100172" } });
  });
  test("play/pause first align the room clock when the user's position differs from the room's", async () => {
    const r = await pairedRig("host");
    r.ctl.onReport(1, report());
    r.ctl.onReport(1, report({ userAction: "pause", state: { playing: false, position: 500, duration: 1, rate: 1 } }));
    const order = r.sock().emitted.map(([e]) => e).filter((e) => ["seek", "pause"].includes(e));
    assert.deepEqual(order, ["seek", "pause"]);
  });
  test("viewer: the action is NOT sent; the tab is put back on the room's state with an explanation", async () => {
    const r = await pairedRig("participant");
    r.ctl.onReport(1, report());
    r.tabMsgs.length = 0;
    r.ctl.onReport(1, report({ userAction: "pause", state: { playing: false, position: 5, duration: 1, rate: 1 } }));
    assert.equal(r.sock().sent("pause").length, 0);
    const back = r.tabMsgs.at(-1).msg;
    assert.equal(back.force, true);
    assert.match(back.note, /host/i);
  });
  test("moderator follows the host's moderatorsCanControl switch live", async () => {
    const r = await pairedRig("moderator");
    r.ctl.onReport(1, report());
    r.ctl.onReport(1, report({ userAction: "pause", state: { playing: false, position: 0, duration: 1, rate: 1 } }));
    assert.equal(r.sock().sent("pause").length, 1);
    r.sock().fire("room_settings", { settings: { moderatorsCanControl: false, maxModerators: 3 } });
    r.ctl.onReport(1, report({ userAction: "pause", state: { playing: false, position: 0, duration: 1, rate: 1 } }));
    assert.equal(r.sock().sent("pause").length, 1, "second pause blocked locally");
    assert.equal(r.ctl.getStatus().canControl, false);
  });
  test("role changes arrive via the roster and take effect without re-pairing", async () => {
    const r = await pairedRig("participant");
    assert.equal(r.ctl.getStatus().canControl, false);
    r.sock().fire("participants_updated", { participants: [{ id: "u1", role: "moderator" }] });
    assert.equal(r.ctl.getStatus().canControl, true);
  });
  test("actions from a non-target or wrong-title tab are ignored", async () => {
    const r = await pairedRig("host");
    r.ctl.onReport(1, report({ titleId: "80100999", userAction: "pause" }));
    assert.equal(r.sock().sent("pause").length, 0);
    r.ctl.onReport(2, report(), { active: true });
    r.ctl.onReport(3, report({ userAction: "pause" }), { active: false });
    assert.equal(r.sock().sent("pause").length, 0, "tab 3 is not the chosen player");
  });
  test("no action is sent while disconnected", async () => {
    const r = await pairedRig("host");
    r.ctl.onReport(1, report());
    r.sock().fire("disconnect");
    r.ctl.onReport(1, report({ userAction: "pause" }));
    assert.equal(r.sock().sent("pause").length, 0);
  });
  test("a server refusal re-asserts the canonical state on the tab (no divergence)", async () => {
    const r = await pairedRig("host");
    r.ctl.onReport(1, report());
    r.tabMsgs.length = 0;
    r.sock().fire("error_event", { code: "MEDIA_MISMATCH", message: "That command was for a different video than the room is on." });
    const msg = r.tabMsgs.at(-1).msg;
    assert.equal(msg.force, true);
    assert.equal(msg.target.mediaId, "80100172");
    assert.match(r.ctl.state.lastError, /different video/);
  });
});

describe("heartbeat (time_sync) — one writer, rate limited, only from the playing target controller", () => {
  const playing = (pos) => report({ state: { playing: true, position: pos, duration: 100, rate: 1 } });
  test("host sends time_sync at most every 5 s, with the current seq and ref", async () => {
    const r = await pairedRig("host");
    r.sock().fire("sync_state", { ...NETFLIX, playing: true, seq: 4, currentTime: 10 });
    r.ctl.onReport(1, playing(10));
    r.ctl.onReport(1, playing(11));
    assert.equal(r.sock().sent("time_sync").length, 1);
    assert.deepEqual(r.sock().sent("time_sync")[0].ref, { provider: "netflix", mediaId: "80100172" });
    assert.equal(r.sock().sent("time_sync")[0].seq, 4);
    r.clock.advance(5100);
    r.ctl.onReport(1, playing(16));
    assert.equal(r.sock().sent("time_sync").length, 2);
  });
  test("followers and paused/buffering controllers never send time_sync", async () => {
    const v = await pairedRig("participant");
    v.sock().fire("sync_state", { ...NETFLIX, playing: true, seq: 2 });
    v.ctl.onReport(1, playing(10));
    assert.equal(v.sock().sent("time_sync").length, 0);
    const h = await pairedRig("host");
    h.sock().fire("sync_state", { ...NETFLIX, playing: true, seq: 2 });
    h.ctl.onReport(1, report({ status: "buffering", state: { playing: true, position: 10, duration: 1, rate: 1 } }));
    assert.equal(h.sock().sent("time_sync").length, 0);
  });
  test("a new command (new seq) restarts the heartbeat window so a stale position is not sent over it", async () => {
    const r = await pairedRig("host");
    r.sock().fire("sync_state", { ...NETFLIX, playing: true, seq: 4, currentTime: 10 });
    r.ctl.onReport(1, playing(10));
    r.sock().fire("sync_state", { ...NETFLIX, playing: true, seq: 5, currentTime: 300 });
    r.ctl.onReport(1, playing(11)); // the tab hasn't applied the seek yet
    assert.equal(r.sock().sent("time_sync").at(-1).seq, 5, "tagged with the NEW seq, so the server will drop it if stale");
  });
});

describe("secrets", () => {
  test("nothing sent to the server contains anything beyond ids, states and positions", async () => {
    const r = await pairedRig("host");
    r.ctl.onReport(1, { ...report({ userAction: "seek", state: { playing: true, position: 5, duration: 9, rate: 1 } }), cookie: "NetflixId=SECRET", localStorage: { x: 1 }, url: "https://www.netflix.com/watch/1?token=SECRET" });
    const wire = JSON.stringify(r.sock().emitted);
    for (const needle of ["SECRET", "NetflixId", "cookie", "localStorage", "token="]) assert.ok(!wire.includes(needle), needle);
  });
});
