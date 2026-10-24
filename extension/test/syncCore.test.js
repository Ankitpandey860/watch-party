import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { projectPosition, decideReconcile, classifyChange, ExpectationFilter, toleranceFor } from "../src/lib/syncCore.js";

const CAPS = { play: true, pause: true, seek: true, rate: false };

describe("projectPosition", () => {
  test("advances while playing (rate aware), frozen while paused, never backwards", () => {
    assert.equal(projectPosition({ playing: true, time: 10, rate: 1 }, 0, 4000), 14);
    assert.equal(projectPosition({ playing: true, time: 10, rate: 2 }, 0, 4000), 18);
    assert.equal(projectPosition({ playing: false, time: 10, rate: 1 }, 0, 4000), 10);
    assert.equal(projectPosition({ playing: true, time: 10, rate: 1 }, 5000, 1000), 10);
    assert.equal(projectPosition({ playing: true, time: 10, rate: NaN }, 0, 1000), 11);
  });
});

describe("decideReconcile", () => {
  const base = { caps: CAPS, adapterId: "netflix-cadmium", now: 100_000 };
  test("in sync => nothing (no needless seeks)", () => {
    const r = decideReconcile({ ...base, target: { playing: true, position: 50, rate: 1 }, actual: { playing: true, position: 51, rate: 1 } });
    assert.deepEqual(r, { actions: [], limited: null });
  });
  test("drift beyond tolerance seeks, within tolerance does not (playing 2.5 s, paused 0.75 s)", () => {
    const t = (pos, playing) => decideReconcile({ ...base, target: { playing, position: 50, rate: 1 }, actual: { playing, position: pos, rate: 1 } }).actions;
    assert.deepEqual(t(52.4, true), []);
    assert.deepEqual(t(53, true), [{ type: "seek", time: 50 }]);
    assert.deepEqual(t(50.5, false), []);
    assert.deepEqual(t(51, false), [{ type: "seek", time: 50 }]);
  });
  test("a seek is ordered before play so playback starts at the right place", () => {
    const { actions } = decideReconcile({ ...base, target: { playing: true, position: 90, rate: 1 }, actual: { playing: false, position: 0, rate: 1 } });
    assert.deepEqual(actions.map((a) => a.type), ["seek", "play"]);
  });
  test("cooldown: a non-forced correction right after a seek is suppressed (no two correctors fighting)", () => {
    const args = { ...base, target: { playing: true, position: 90, rate: 1 }, actual: { playing: true, position: 10, rate: 1 } };
    assert.deepEqual(decideReconcile({ ...args, lastSeekAt: 98_000 }).actions, []);
    assert.equal(decideReconcile({ ...args, lastSeekAt: 98_000, force: true }).actions[0].type, "seek");
    assert.equal(decideReconcile({ ...args, lastSeekAt: 90_000 }).actions[0].type, "seek");
  });
  test("never corrects while buffering", () => {
    const r = decideReconcile({ ...base, buffering: true, target: { playing: true, position: 90, rate: 1 }, actual: { playing: true, position: 10, rate: 1 } });
    assert.deepEqual(r.actions, []);
  });
  test("unsupported capability is reported as 'limited', never faked", () => {
    const noSeek = decideReconcile({ ...base, adapterId: "netflix-dom", caps: { ...CAPS, seek: false }, target: { playing: true, position: 90, rate: 1 }, actual: { playing: false, position: 0, rate: 1 } });
    assert.deepEqual(noSeek.actions, [{ type: "play" }]);
    assert.equal(noSeek.limited, "seek");
    const rate = decideReconcile({ ...base, target: { playing: true, position: 0, rate: 1.5 }, actual: { playing: true, position: 0, rate: 1 } });
    assert.equal(rate.limited, "rate");
    const rate2 = decideReconcile({ ...base, caps: { ...CAPS, rate: true }, target: { playing: true, position: 0, rate: 1.5 }, actual: { playing: true, position: 0, rate: 1 } });
    assert.deepEqual(rate2.actions, [{ type: "rate", rate: 1.5 }]);
  });
  test("no actual player or no target => no-op", () => {
    assert.deepEqual(decideReconcile({ ...base, target: null, actual: { playing: true, position: 1 } }).actions, []);
    assert.deepEqual(decideReconcile({ ...base, target: { playing: true, position: 1 }, actual: null }).actions, []);
  });
  test("tolerances are per adapter", () => {
    assert.ok(toleranceFor("netflix-cadmium").seek > toleranceFor("something-else").seek);
  });
});

describe("classifyChange (polled players)", () => {
  const p = (position, playing = true) => ({ position, playing, rate: 1 });
  test("normal playback is not an action", () => assert.deepEqual(classifyChange(p(10), p(11), 1000).actions, []));
  test("pause / play are detected", () => {
    assert.deepEqual(classifyChange(p(10), p(10.1, false), 1000).actions, ["pause"]);
    assert.deepEqual(classifyChange(p(10, false), p(10, true), 1000).actions, ["play"]);
  });
  test("forward and backward jumps are seeks", () => {
    assert.deepEqual(classifyChange(p(10), p(300), 1000).actions, ["seek"]);
    assert.deepEqual(classifyChange(p(300), p(20), 1000).actions, ["seek"]);
    assert.deepEqual(classifyChange(p(10, false), p(200, false), 1000).actions, ["seek"]);
  });
  test("a throttled background tab (long gap) that kept playing is NOT a seek", () => {
    assert.deepEqual(classifyChange(p(10), p(70), 60_000).actions, []);
  });
  test("buffering (playing but barely advancing) is a stall, not a pause or seek", () => {
    const r = classifyChange(p(10), p(10.1), 1000);
    assert.deepEqual(r, { actions: [], stalled: true });
  });
  test("a seek that lands while stalled-looking is still a seek when it moved far", () => {
    assert.deepEqual(classifyChange(p(10), p(500), 1000).actions, ["seek"]);
  });
  test("rate is taken into account", () => assert.deepEqual(classifyChange({ position: 10, playing: true, rate: 2 }, { position: 12, playing: true, rate: 2 }, 1000).actions, []));
});

describe("ExpectationFilter", () => {
  test("swallows exactly the echo it expects, once", () => {
    const f = new ExpectationFilter();
    f.expect("play", 0);
    assert.equal(f.consume("play", {}, 100), true);
    assert.equal(f.consume("play", {}, 200), false, "a second play is a real user action");
  });
  test("a different action is never swallowed", () => {
    const f = new ExpectationFilter();
    f.expect("play", 0);
    assert.equal(f.consume("pause", {}, 10), false);
    assert.equal(f.pending, 1);
  });
  test("seek echoes must land near the expected position; a user seek elsewhere is reported", () => {
    const f = new ExpectationFilter();
    f.expect("seek", 0, 100);
    assert.equal(f.consume("seek", { position: 300 }, 10), false);
    assert.equal(f.consume("seek", { position: 100.8 }, 20), true);
  });
  test("expectations expire (a real action long after a remote command is reported)", () => {
    const f = new ExpectationFilter({ ttlMs: 4000 });
    f.expect("pause", 0);
    assert.equal(f.consume("pause", {}, 4001), false);
  });
  test("clear() drops everything (used when an apply fails)", () => {
    const f = new ExpectationFilter(); f.expect("play", 0); f.clear();
    assert.equal(f.consume("play", {}, 1), false);
  });
});
