// MOCK-level tests of the Netflix adapter pair (MAIN-world bridge + isolated-world adapter) against a FAKE
// `netflix` object. They prove capability detection, the allow-list, unit conversion and failure handling.
// They say NOTHING about whether the real Netflix site still exposes this interface.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { findPlayer, handleOp, installBridge } from "../src/content/netflixMain.js";
import { createCadmiumAdapter } from "../src/content/adapters/netflixCadmium.js";

function fakeNetflix({ methods = {}, sessions = ["s1"], throwAt = null } = {}) {
  const player = {
    pos: 12_000, paused: true, calls: [],
    play() { this.calls.push("play"); this.paused = false; },
    pause() { this.calls.push("pause"); this.paused = true; },
    seek(ms) { this.calls.push(["seek", ms]); this.pos = ms; },
    getCurrentTime() { return this.pos; },
    isPaused() { return this.paused; },
    ...methods,
  };
  const vp = { getAllPlayerSessionIds: () => sessions, getVideoPlayerBySessionId: (id) => (id === sessions.at(-1) ? player : null) };
  const g = { netflix: { appContext: { state: { playerApp: { getAPI: () => { if (throwAt === "api") throw new Error("gone"); return { videoPlayer: vp }; } } } } } };
  return { g, player };
}

function fakeWindow() {
  const listeners = new Set();
  const win = {
    location: { origin: "https://www.netflix.com" },
    crypto: globalThis.crypto, MessageChannel,
    addEventListener(t, fn) { if (t === "message") listeners.add(fn); },
    removeEventListener(t, fn) { listeners.delete(fn); },
    postMessage(data, origin, ports = []) { queueMicrotask(() => { for (const fn of [...listeners]) fn({ source: win, origin: win.location.origin, data, ports }); }); },
  };
  return win;
}

describe("findPlayer / handleOp", () => {
  test("probe reports required + optional methods", () => {
    const { g } = fakeNetflix({ methods: { getDuration: () => 3_600_000, getPlaybackRate: () => 1, setPlaybackRate() {} } });
    const r = handleOp(g, "probe");
    assert.equal(r.available, true);
    for (const m of ["play", "pause", "seek", "getCurrentTime", "isPaused", "getDuration", "getPlaybackRate", "setPlaybackRate"]) assert.ok(r.methods.includes(m), m);
  });
  test("missing netflix global / renamed internals / throwing getters => 'unavailable', never an exception", () => {
    assert.deepEqual(handleOp({}, "probe"), { available: false, methods: [] });
    assert.equal(findPlayer({ netflix: {} }), null);
    assert.equal(findPlayer(fakeNetflix({ throwAt: "api" }).g), null);
    assert.equal(handleOp({}, "read"), null);
    assert.equal(findPlayer(fakeNetflix({ sessions: [] }).g), null);
  });
  test("a player missing a REQUIRED method is not 'available' (so the fallback adapter is used)", () => {
    const { g, player } = fakeNetflix(); delete player.seek;
    assert.equal(handleOp(g, "probe").available, false);
  });
  test("read converts milliseconds to seconds and tolerates absent optional getters", () => {
    const { g } = fakeNetflix();
    assert.deepEqual(handleOp(g, "read"), { playing: false, position: 12, duration: null, rate: 1, busy: null });
    const full = fakeNetflix({ methods: { getDuration: () => 7_200_000, getBusy: () => true } });
    const r = handleOp(full.g, "read");
    assert.equal(r.duration, 7200); assert.equal(r.busy, true);
  });
  test("seek uses the player API in milliseconds and validates its input (never video.currentTime)", () => {
    const { g, player } = fakeNetflix();
    handleOp(g, "seek", 90.5);
    assert.deepEqual(player.calls, [["seek", 90_500]]);
    for (const bad of [-1, NaN, Infinity, "5", null, 1e9]) assert.throws(() => handleOp(g, "seek", bad), /bad-seek/, String(bad));
  });
  test("rate needs the optional API and a sane value", () => {
    const { g } = fakeNetflix();
    assert.throws(() => handleOp(g, "rate", 1.5), /bad-rate/);
    const set = []; const full = fakeNetflix({ methods: { setPlaybackRate: (r) => set.push(r) } });
    handleOp(full.g, "rate", 1.5);
    assert.deepEqual(set, [1.5]);
    assert.throws(() => handleOp(full.g, "rate", 9), /bad-rate/);
  });
  test("only the allow-listed operations exist", () => {
    const { g } = fakeNetflix();
    for (const op of ["eval", "getCookie", "constructor", "__proto__", "toString"]) assert.throws(() => handleOp(g, op), /unknown-op/, op);
  });
  test("with several sessions the newest is used (player replaced on episode change)", () => {
    const a = fakeNetflix({ sessions: ["old", "new"] });
    assert.equal(findPlayer(a.g), a.player);
  });
});

describe("bridge handshake + adapter (private MessageChannel)", () => {
  async function wire(opts) {
    const win = fakeWindow();
    const n = fakeNetflix(opts);
    installBridge(win, n.g);
    return { win, ...n, adapter: createCadmiumAdapter(win) };
  }
  test("adapter probes, reads and controls through the bridge; caps come from detection", async () => {
    const { adapter, player } = await wire({ methods: { getDuration: () => 60_000 } });
    const probe = await adapter.probe();
    assert.equal(probe.available, true);
    assert.deepEqual(adapter.caps, { play: true, pause: true, seek: true, rate: false });
    assert.deepEqual(await adapter.read(), { playing: false, position: 12, duration: 60, rate: 1, busy: null });
    await adapter.seek(30); await adapter.play();
    assert.deepEqual(player.calls, [["seek", 30_000], "play"]);
    await adapter.pause();
    assert.equal(player.paused, true);
  });
  test("rate capability only when both getter and setter exist", async () => {
    const { adapter } = await wire({ methods: { getPlaybackRate: () => 1, setPlaybackRate() {} } });
    await adapter.probe();
    assert.equal(adapter.caps.rate, true);
  });
  test("no Netflix API => probe unavailable with all capabilities off (controller then falls back)", async () => {
    const win = fakeWindow();
    installBridge(win, {});
    const adapter = createCadmiumAdapter(win);
    const probe = await adapter.probe();
    assert.equal(probe.available, false);
    assert.deepEqual(adapter.caps, { play: false, pause: false, seek: false, rate: false });
    assert.equal(await adapter.read(), null);
  });
  test("bridge script not injected => probe fails closed after a timeout", async () => {
    const win = fakeWindow(); // nobody listening
    const adapter = createCadmiumAdapter(win);
    const t0 = Date.now();
    const probe = await adapter.probe();
    assert.equal(probe.available, false);
    assert.match(probe.error, /timeout/);
    assert.ok(Date.now() - t0 < 4500);
  });
  test("a page script that does not know the nonce cannot hijack the adapter's port", async () => {
    const win = fakeWindow();
    const n = fakeNetflix();
    installBridge(win, n.g);
    const adapter = createCadmiumAdapter(win);
    // an attacker answers the hello first with a wrong nonce and its own port
    const evil = new MessageChannel();
    evil.port1.onmessage = (m) => evil.port1.postMessage({ id: m.data.id, ok: true, data: { available: true, methods: ["play"], position: 999 } });
    const orig = win.postMessage.bind(win);
    win.postMessage = (data, origin, ports) => {
      if (data?.source === "wp-netflix-hello") queueMicrotask(() => { for (const fn of []) fn; });
      orig(data, origin, ports);
    };
    win.postMessage({ source: "wp-netflix-port", nonce: "wrong-nonce-value" }, win.location.origin, [evil.port2]);
    const probe = await adapter.probe();
    assert.equal(probe.available, true);
    assert.deepEqual(adapter.methods.includes("seek"), true, "genuine bridge answered, not the attacker");
    evil.port1.close();
  });
  test("the bridge ignores hellos without a proper nonce and foreign-origin messages", async () => {
    const win = fakeWindow();
    installBridge(win, fakeNetflix().g);
    let ports = 0;
    win.addEventListener("message", (ev) => { if (ev.data?.source === "wp-netflix-port") ports++; });
    win.postMessage({ source: "wp-netflix-hello" }, win.location.origin);
    win.postMessage({ source: "wp-netflix-hello", nonce: "x" }, win.location.origin);
    win.postMessage({ source: "other", nonce: "abcdefghijkl" }, win.location.origin);
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(ports, 0);
  });
  test("errors inside the page API come back as failed calls, not crashes", async () => {
    const { adapter, player } = await wire();
    await adapter.probe();
    player.seek = () => { throw new Error("Netflix says no"); };
    await assert.rejects(adapter.seek(5), /Netflix says no/);
    await assert.rejects(adapter.seek(-5), /bad-seek/);
  });
  test("destroy() stops further calls", async () => {
    const { adapter } = await wire();
    await adapter.probe();
    adapter.destroy();
    await assert.rejects(adapter.play(), /destroyed/);
  });
});

describe("bridge cleanup (resource hygiene)", () => {
  test("destroying the adapter releases the page-side channel; a dead channel is not answered", async () => {
    const win = fakeWindow(); const { g } = fakeNetflix();
    const stop = installBridge(win, g);
    const a = createCadmiumAdapter(win);
    assert.equal((await a.probe()).available, true);
    a.destroy();
    const b = createCadmiumAdapter(win); // a new adapter can handshake again after the first was destroyed
    assert.equal((await b.probe()).available, true);
    b.destroy(); stop();
  });
  test("handshakes are capped: opening many channels never accumulates unbounded ports", async () => {
    const win = fakeWindow(); const { g } = fakeNetflix();
    const closed = [];
    const RealMC = win.MessageChannel;
    win.MessageChannel = class extends RealMC { constructor() { super(); const p = this.port1; const c = p.close.bind(p); p.close = () => { closed.push(1); c(); }; } };
    const stop = installBridge(win, g);
    const adapters = [];
    for (let i = 0; i < 7; i++) { const a = createCadmiumAdapter(win); await a.probe(); adapters.push(a); }
    assert.ok(closed.length >= 3, `expected the oldest channels to be closed, closed=${closed.length}`);
    for (const a of adapters) a.destroy();
    stop();
  });
});
