// Mock-player tests of the per-tab sync brain: echo suppression, drift, races, buffering, wrong title,
// unsupported APIs, autoplay blocks. These use a FAKE player: they prove the logic, not Netflix.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createPlayerController } from "../src/content/playerController.js";
import { makeClock, makePlayer, target } from "./helpers.js";

function rig(playerOpts = {}, { titleId = "80100172" } = {}) {
  const clock = makeClock();
  const player = makePlayer(clock, playerOpts);
  const reports = [];
  const ctl = createPlayerController({ getAdapter: () => player, getTitleId: () => titleId, report: (r) => reports.push(r), now: clock.now });
  const userActions = () => reports.filter((r) => r.userAction).map((r) => r.userAction);
  const tick = async (ms = 1000) => { clock.advance(ms); await ctl.tick(); };
  return { clock, player, ctl, reports, userActions, tick };
}

describe("applying the room's state", () => {
  test("play at 100 s on a paused player: seek first, then play, and our own echo is NOT reported as a user action", async () => {
    const { ctl, player, tick, userActions } = rig();
    await ctl.tick(); // establish prev
    await ctl.setTarget(target({ playing: true, time: 100 }));
    assert.deepEqual(player.calls, [["seek", 100], ["play"]]);
    await tick(); await tick();
    assert.deepEqual(userActions(), [], "echo suppressed");
  });
  test("applying the same seq twice is idempotent (no repeated seek/play)", async () => {
    const { ctl, player } = rig();
    await ctl.setTarget(target());
    const n = player.calls.length;
    await ctl.setTarget(target());
    await ctl.setTarget(target());
    assert.equal(player.calls.length, n);
  });
  test("a later seq is applied; a force re-applies even the same seq (used after a refused command)", async () => {
    const { ctl, player } = rig();
    await ctl.setTarget(target({ seq: 1, playing: false, time: 10 }));
    player.calls.length = 0;
    await ctl.setTarget(target({ seq: 2, playing: false, time: 500 }));
    assert.deepEqual(player.calls, [["seek", 500]]);
    player.user.seek(7); // the user messes with it
    player.calls.length = 0;
    await ctl.setTarget({ ...target({ seq: 2, playing: false, time: 500 }), force: true });
    assert.deepEqual(player.calls, [["seek", 500]]);
  });
  test("rapid consecutive commands collapse to the newest without losing it (controller tabs have no drift loop)", async () => {
    const { ctl, player } = rig();
    await ctl.tick();
    const slowSeek = player.seek.bind(player);
    player.seek = async (s) => { await new Promise((r) => setTimeout(r, 15)); return slowSeek(s); };
    const a = ctl.setTarget({ ...target({ seq: 1, playing: false, time: 10 }), canControl: true });
    const b = ctl.setTarget({ ...target({ seq: 2, playing: false, time: 20 }), canControl: true });
    const c = ctl.setTarget({ ...target({ seq: 3, playing: false, time: 30 }), canControl: true });
    await Promise.all([a, b, c]);
    assert.equal(player.state.position, 30);
  });
  test("late joiner / reconnect: the first target after (re)connect lands the player on the projected position", async () => {
    const { ctl, clock, player } = rig();
    await ctl.setTarget(target({ playing: true, time: 600 })); // received at t0
    assert.equal(player.state.position, 600);
    clock.advance(30_000); // network gap; the player kept playing locally
    await ctl.setTarget({ ...target({ playing: true, time: 630, seq: 2 }) });
    assert.ok(Math.abs(player.state.position - 630) < 1);
  });
  test("a target for a DIFFERENT title is never applied", async () => {
    const { ctl, player } = rig({}, { titleId: "80100999" });
    await ctl.setTarget(target());
    assert.deepEqual(player.calls, []);
  });
  test("no player yet => nothing happens, nothing throws", async () => {
    const clock = makeClock();
    const ctl = createPlayerController({ getAdapter: () => null, getTitleId: () => "80100172", report: () => {}, now: clock.now });
    await ctl.setTarget(target());
    await ctl.tick();
    assert.equal(ctl.status, "no-player");
  });
});

describe("user actions vs echoes", () => {
  test("a real user pause is reported", async () => {
    const { ctl, player, tick, userActions } = rig({ playing: true, position: 50 });
    await ctl.tick();
    player.user.pause();
    await tick(1000);
    assert.deepEqual(userActions(), ["pause"]);
  });
  test("a real user seek is reported with the new position", async () => {
    const { ctl, player, tick, reports } = rig({ playing: true, position: 50 });
    await ctl.tick();
    player.user.seek(900);
    await tick(1000);
    const r = reports.find((x) => x.userAction === "seek");
    assert.ok(r && Math.abs(r.state.position - 901) < 2);
  });
  test("a genuine user pause right after a remote PLAY is not swallowed (expectation is typed)", async () => {
    const { ctl, player, tick, userActions } = rig({ position: 10 });
    await ctl.tick();
    await ctl.setTarget(target({ playing: true, time: 10 }));
    player.user.pause();
    await tick(1000);
    assert.deepEqual(userActions(), ["pause"]);
  });
  test("a user action long after a remote command (expectation expired) is reported", async () => {
    const { ctl, player, tick, userActions } = rig({ position: 10 });
    await ctl.tick();
    await ctl.setTarget(target({ playing: true, time: 10 }));
    await tick(5000); await tick(1000);
    player.user.pause();
    await tick(1000);
    assert.deepEqual(userActions(), ["pause"]);
  });
  test("native-event adapters report instantly and also swallow echoes", async () => {
    const { ctl, player, userActions } = rig({ id: "netflix-dom", native: true, caps: { play: true, pause: true, seek: false, rate: false } });
    await ctl.tick();
    await ctl.setTarget(target({ playing: true, time: 0 }));
    await ctl.onNative("play"); // echo of our play()
    assert.deepEqual(userActions(), []);
    player.user.pause();
    await ctl.onNative("pause");
    assert.deepEqual(userActions(), ["pause"]);
  });
});

describe("drift correction", () => {
  test("followers correct drift beyond tolerance once, respecting the cooldown", async () => {
    const { ctl, player, tick, clock } = rig();
    await ctl.setTarget(target({ playing: true, time: 100 }));
    player.calls.length = 0;
    player.user.seek(40); // drifted 60 s behind
    await tick(1000);
    const seeks = () => player.calls.filter((c) => c[0] === "seek");
    // inside the 6 s cooldown after the initial apply-seek: no correction yet
    assert.equal(seeks().length, 0);
    clock.advance(6000); await ctl.tick();
    assert.equal(seeks().length, 1);
    assert.ok(Math.abs(seeks()[0][1] - (100 + 8)) < 1.5, "seeks to the PROJECTED position, not the stale one");
    await tick(1000); await tick(1000);
    assert.equal(seeks().length, 1, "no repeated seeks once in sync");
  });
  test("small drift inside tolerance is left alone", async () => {
    const { ctl, player, tick } = rig();
    await ctl.setTarget(target({ playing: true, time: 100 }));
    player.calls.length = 0;
    player.state.position += 1.2;
    await tick(1000);
    assert.deepEqual(player.calls, []);
  });
  test("controllers (host/moderators) never get dragged by the periodic check", async () => {
    const { ctl, player, tick, clock } = rig();
    await ctl.setTarget({ ...target({ playing: true, time: 100 }), canControl: true });
    player.calls.length = 0;
    player.user.seek(400);
    clock.advance(10_000);
    await tick(1000);
    assert.equal(player.calls.length, 0);
  });
  test("a follower whose player is paused while the room plays is told to play (state mismatch, not just position)", async () => {
    const { ctl, player, tick } = rig();
    await ctl.setTarget(target({ playing: true, time: 100 }));
    player.user.pause();
    player.calls.length = 0;
    await tick(1000);
    assert.deepEqual(player.calls.map((c) => c[0]), ["play"]);
  });
});

describe("buffering, ads, blocked autoplay, unsupported APIs", () => {
  test("a seek-less adapter is reported as limited even when no seek is needed right now", async () => {
    const full = rig({ position: 10 });
    await full.ctl.setTarget(target({ playing: false, time: 10 }));
    await full.ctl.tick();
    assert.equal(full.reports.at(-1).limited, null, "full adapter: not limited");
    const lim = rig({ caps: { play: true, pause: true, seek: false, rate: false }, position: 10 });
    await lim.ctl.setTarget(target({ playing: false, time: 10 })); // already in position: reconcile needs no seek
    await lim.ctl.tick();
    assert.equal(lim.reports.at(-1).limited, "seek", "the user is told sync is limited, not 'Synced'");
  });
  test("a stalled (buffering) player is not treated as a user pause/seek and is not 'corrected'", async () => {
    const { ctl, player, tick, userActions } = rig({ playing: true, position: 50 });
    await ctl.setTarget(target({ playing: true, time: 50 }));
    await ctl.tick();
    player.stalled = true;
    player.calls.length = 0;
    await tick(1000); await tick(1000);
    assert.equal(ctl.status, "buffering");
    assert.deepEqual(userActions(), []);
    assert.deepEqual(player.calls, []);
    player.stalled = false;
    await tick(1000); await tick(1000);
    assert.equal(ctl.status, "ok");
  });
  test("ad playback pauses synchronisation", async () => {
    const { ctl, player, tick, userActions } = rig({ playing: true, position: 50 });
    await ctl.setTarget(target({ playing: true, time: 50 }));
    player.ad = true;
    player.state.position = 3; // ad timeline
    player.calls.length = 0;
    await tick(1000);
    assert.equal(ctl.status, "ad");
    assert.deepEqual(player.calls, []);
    assert.deepEqual(userActions(), []);
  });
  test("autoplay blocked: status 'blocked', expectation cleared, a later user play is reported normally", async () => {
    const { ctl, player, userActions, tick } = rig({ position: 5 });
    await ctl.tick();
    player.failPlayWith = "NotAllowedError";
    await ctl.setTarget(target({ playing: true, time: 5 }));
    assert.equal(ctl.status, "blocked");
    player.failPlayWith = null;
    player.user.play();
    await tick(1000);
    assert.deepEqual(userActions(), ["play"]);
  });
  test("an adapter without seek (limited DOM fallback) plays/pauses but never seeks, and says so", async () => {
    const { ctl, player, reports } = rig({ id: "netflix-dom", native: true, caps: { play: true, pause: true, seek: false, rate: false } });
    await ctl.setTarget(target({ playing: true, time: 900 }));
    assert.deepEqual(player.calls, [["play"]]);
    await ctl.tick();
    assert.equal(ctl.limited, "seek");
    assert.equal(reports.at(-1).limited, "seek");
  });
  test("reports carry capability flags so the extension/UI can show what is supported", async () => {
    const { ctl, reports } = rig({ caps: { play: true, pause: true, seek: true, rate: false } });
    await ctl.tick();
    assert.deepEqual(reports.at(-1).caps, { play: true, pause: true, seek: true, rate: false });
  });
  test("reset() on navigation forgets targets' bookkeeping and pending echoes", async () => {
    const { ctl, player, tick, userActions } = rig({ position: 10 });
    await ctl.tick();
    await ctl.setTarget(target({ playing: true, time: 10 }));
    ctl.reset();
    player.user.pause();
    await tick(1000);
    await ctl.tick();
    assert.ok(!userActions().includes("play"));
  });
});
