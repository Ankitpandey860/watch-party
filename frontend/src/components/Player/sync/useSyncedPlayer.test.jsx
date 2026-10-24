// Tests of the provider-neutral sync engine using FAKE adapters (sync and promise-based). These prove
// the logic shared by every embedded provider; they do not prove any provider's real SDK.
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act } from "@testing-library/react";

const mocks = vi.hoisted(() => ({ room: {} }));
vi.mock("../../../context/RoomContext", () => ({ useRoom: () => mocks.room }));

import { useSyncedPlayer } from "./useSyncedPlayer";
import { makeCaps } from "../adapters/contract";

const PB = (over = {}) => ({
  playing: false,
  currentTime: 0,
  duration: 0,
  volume: 60,
  rate: 1,
  ...over,
});

function setRoom(over = {}) {
  mocks.room = {
    playback: PB(),
    syncSeq: 0,
    driftSeq: 0,
    role: "participant",
    settings: { moderatorsCanControl: true, maxModerators: 3 },
    updatePlayback: vi.fn(),
    play: vi.fn(),
    pause: vi.fn(),
    seek: vi.fn(),
    setRate: vi.fn(),
    syncTime: vi.fn(),
    reportPlayerStatus: vi.fn(),
    ...over,
  };
  return mocks.room;
}

function fakeAdapter({ time = 0, async = false, caps = {}, duration = 300 } = {}) {
  const wrap = (v) => (async ? Promise.resolve(v) : v);
  const a = {
    id: "fake",
    caps: makeCaps({ play: true, pause: true, seek: true, rate: true, volume: true, ...caps }),
    time,
    order: [],
    play: vi.fn(() => {
      a.order.push("play");
      return wrap(undefined);
    }),
    pause: vi.fn(() => {
      a.order.push("pause");
      return wrap(undefined);
    }),
    seekTo: vi.fn((t) => {
      a.order.push(`seek:${t}`);
      a.time = t;
      return wrap(t);
    }),
    getCurrentTime: vi.fn(() => wrap(a.time)),
    getDuration: vi.fn(() => wrap(duration)),
    setVolume: vi.fn(),
    getRate: vi.fn(() => 1),
    setRate: vi.fn(),
    destroy: vi.fn(),
  };
  return a;
}

let api;
function Harness({ adapter, tolerances }) {
  api = useSyncedPlayer({ adapter, tolerances });
  return null;
}
const ui = (adapter, tolerances) => <Harness adapter={adapter} tolerances={tolerances} />;
const flush = () =>
  act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

beforeEach(() => setRoom());

describe("initial apply (also late join / reconnect: the first thing a new player does)", () => {
  test("seeks FIRST when far from the room position, then plays; volume and duration are set", () => {
    setRoom({ playback: PB({ playing: true, currentTime: 50, volume: 40 }) });
    const a = fakeAdapter({ time: 0 });
    render(ui(a));
    expect(a.order).toEqual(["seek:50", "play"]);
    expect(a.setVolume).toHaveBeenCalledWith(40);
    expect(mocks.room.updatePlayback).toHaveBeenCalledWith({ duration: 300 });
  });
  test("does not seek when within tolerance; pauses when the room is paused", () => {
    setRoom({ playback: PB({ playing: false, currentTime: 50 }) });
    const a = fakeAdapter({ time: 49 });
    render(ui(a));
    expect(a.order).toEqual(["pause"]);
  });
  test("reports 'ready' to the room exactly once per adapter", () => {
    const a = fakeAdapter();
    const { rerender } = render(ui(a));
    rerender(ui(a));
    expect(mocks.room.reportPlayerStatus).toHaveBeenCalledTimes(1);
    expect(mocks.room.reportPlayerStatus).toHaveBeenCalledWith("ready");
  });
  test("no adapter yet => nothing happens and nothing throws", () => {
    render(ui(null));
    expect(api.ready).toBe(false);
  });
  test("works with a promise-based SDK: seek completes before play", async () => {
    setRoom({ playback: PB({ playing: true, currentTime: 80 }) });
    const a = fakeAdapter({ time: 0, async: true });
    render(ui(a));
    await flush();
    expect(a.order).toEqual(["seek:80", "play"]);
  });
});

describe("discrete commands (syncSeq)", () => {
  test("a new syncSeq re-applies; an unchanged one does not", () => {
    const a = fakeAdapter();
    const { rerender } = render(ui(a));
    a.order.length = 0;
    rerender(ui(a));
    expect(a.order).toEqual([]);
    setRoom({ playback: PB({ playing: true, currentTime: 120 }), syncSeq: 1 });
    rerender(ui(a));
    expect(a.order).toEqual(["seek:120", "play"]);
  });
  test("rapid consecutive commands: the older async apply is cancelled, the newest wins", async () => {
    // Slow seeks: command 1 (seek 100 then play) is still seeking when command 2 (seek 200, pause) lands.
    const a = fakeAdapter({ time: 0, async: true });
    let release1;
    a.seekTo = vi.fn((t) => {
      a.order.push(`seek:${t}`);
      a.time = t;
      if (t === 100) return new Promise((r) => (release1 = r));
      return Promise.resolve(t);
    });
    const { rerender } = render(ui(a));
    await flush();
    a.order.length = 0;
    setRoom({ playback: PB({ playing: true, currentTime: 100 }), syncSeq: 1 });
    rerender(ui(a));
    await flush();
    setRoom({ playback: PB({ playing: false, currentTime: 200 }), syncSeq: 2 });
    rerender(ui(a));
    await flush();
    release1(); // the stale seek finally resolves
    await flush();
    expect(a.order).toEqual(["seek:100", "seek:200", "pause"]); // the stale command's play never fires
  });
  test("a rate the room changed is applied once (and not repeated for unchanged rate)", () => {
    const a = fakeAdapter();
    const { rerender } = render(ui(a));
    setRoom({ playback: PB({ rate: 1.5 }), syncSeq: 1 });
    rerender(ui(a));
    expect(a.setRate).toHaveBeenCalledWith(1.5);
    setRoom({ playback: PB({ rate: 1.5 }), syncSeq: 2 });
    rerender(ui(a));
    expect(a.setRate).toHaveBeenCalledTimes(1);
  });
  test("a provider without rate support never gets setRate (capability is explicit)", () => {
    const a = fakeAdapter({ caps: { rate: false } });
    a.setRate = undefined;
    a.getRate = undefined;
    const { rerender } = render(ui(a));
    setRoom({ playback: PB({ rate: 2 }), syncSeq: 1 });
    expect(() => rerender(ui(a))).not.toThrow();
  });
  test("a provider without seek support never seeks (limited, not broken)", () => {
    setRoom({ playback: PB({ playing: true, currentTime: 90 }) });
    const a = fakeAdapter({ time: 0, caps: { seek: false } });
    render(ui(a));
    expect(a.seekTo).not.toHaveBeenCalled();
    expect(a.order).toEqual(["play"]);
  });
});

describe("drift correction (driftSeq)", () => {
  test("only seeks beyond the tolerance and NEVER toggles play/pause", () => {
    setRoom({ playback: PB({ playing: true, currentTime: 100 }) });
    const a = fakeAdapter({ time: 100 });
    const { rerender } = render(ui(a));
    a.order.length = 0;
    a.time = 100.3;
    setRoom({ playback: PB({ playing: true, currentTime: 100 }), driftSeq: 1 });
    rerender(ui(a));
    expect(a.seekTo).toHaveBeenCalledTimes(0 + a.seekTo.mock.calls.length); // none beyond initial
    expect(a.order).toEqual([]);
    a.time = 101;
    setRoom({ playback: PB({ playing: true, currentTime: 100 }), driftSeq: 2 });
    rerender(ui(a));
    expect(a.order).toEqual(["seek:100"]);
  });
  test("provider tolerances are honoured (Twitch-style loose drift)", () => {
    setRoom({ playback: PB({ playing: true, currentTime: 100 }) });
    const a = fakeAdapter({ time: 100 });
    const { rerender } = render(ui(a, { drift: 1.2 }));
    a.order.length = 0;
    a.time = 101; // 1 s: inside 1.2
    setRoom({ playback: PB({ playing: true, currentTime: 100 }), driftSeq: 1 });
    rerender(ui(a, { drift: 1.2 }));
    expect(a.order).toEqual([]);
  });
  test("is skipped while the player is buffering (we never fight a stall)", () => {
    setRoom({ playback: PB({ playing: true, currentTime: 100 }) });
    const a = fakeAdapter({ time: 100 });
    const { rerender } = render(ui(a));
    a.order.length = 0;
    act(() => api.onBuffering(true));
    a.time = 90;
    setRoom({ playback: PB({ playing: true, currentTime: 100 }), driftSeq: 1 });
    rerender(ui(a));
    expect(a.order).toEqual([]);
    expect(api.buffering).toBe(true);
    act(() => api.onBuffering(false));
    a.time = 90;
    setRoom({ playback: PB({ playing: true, currentTime: 100 }), driftSeq: 2 });
    rerender(ui(a));
    expect(a.order).toEqual(["seek:100"]);
  });
  test("a player that cannot seek is never drift-corrected", () => {
    setRoom({ playback: PB({ playing: true, currentTime: 100 }) });
    const a = fakeAdapter({ time: 100, caps: { seek: false } });
    const { rerender } = render(ui(a));
    a.time = 10;
    setRoom({ playback: PB({ playing: true, currentTime: 100 }), driftSeq: 1 });
    rerender(ui(a));
    expect(a.seekTo).not.toHaveBeenCalled();
  });
});

describe("native play/pause events: echoes, controllers and viewers", () => {
  test("a state equal to the room's is an echo: nothing is emitted", () => {
    setRoom({ role: "host", playback: PB({ playing: true }) });
    render(ui(fakeAdapter()));
    act(() => api.onPlayState(true));
    expect(mocks.room.play).not.toHaveBeenCalled();
    expect(mocks.room.pause).not.toHaveBeenCalled();
  });
  test("host or moderator toggling the native player emits the same event the controls use", () => {
    for (const role of ["host", "moderator"]) {
      const room = setRoom({ role, playback: PB({ playing: false }) });
      const { unmount } = render(ui(fakeAdapter()));
      act(() => api.onPlayState(true));
      expect(room.play).toHaveBeenCalledTimes(1);
      unmount();
    }
    const room = setRoom({ role: "host", playback: PB({ playing: true }) });
    render(ui(fakeAdapter()));
    act(() => api.onPlayState(false));
    expect(room.pause).toHaveBeenCalledTimes(1);
  });
  test("a viewer is snapped BACK to the room's state and emits nothing", () => {
    const room = setRoom({
      role: "participant",
      playback: PB({ playing: false, currentTime: 30 }),
    });
    const a = fakeAdapter({ time: 30 });
    render(ui(a));
    a.order.length = 0;
    act(() => api.onPlayState(true));
    expect(room.play).not.toHaveBeenCalled();
    expect(a.order).toEqual(["pause"]);
  });
  test("a moderator loses native control the moment the host disables moderator control", () => {
    const room = setRoom({
      role: "moderator",
      settings: { moderatorsCanControl: false },
      playback: PB({ playing: false }),
    });
    const a = fakeAdapter();
    render(ui(a));
    expect(api.canControl).toBe(false);
    a.order.length = 0;
    act(() => api.onPlayState(true));
    expect(room.play).not.toHaveBeenCalled();
    expect(a.order).toEqual(["pause"]);
  });
});

describe("native seek events", () => {
  test("the echo of OUR OWN seek is ignored (no seek loop)", () => {
    setRoom({ role: "host", playback: PB({ playing: true, currentTime: 100 }) });
    const a = fakeAdapter({ time: 0 });
    render(ui(a)); // initial apply seeks to 100
    act(() => api.onSeek(100.2)); // the SDK's seeked event for that seek
    expect(mocks.room.seek).not.toHaveBeenCalled();
  });
  test("a controller scrubbing the native timeline emits a seek (once the echo window is spent)", () => {
    setRoom({ role: "host", playback: PB({ playing: true, currentTime: 100 }) });
    render(ui(fakeAdapter({ time: 100 })));
    act(() => api.onSeek(500));
    expect(mocks.room.seek).toHaveBeenCalledWith(500);
  });
  test("a viewer who scrubs is snapped back and emits nothing", () => {
    setRoom({ role: "participant", playback: PB({ playing: true, currentTime: 100 }) });
    const a = fakeAdapter({ time: 100 });
    render(ui(a));
    a.order.length = 0;
    act(() => api.onSeek(500));
    expect(mocks.room.seek).not.toHaveBeenCalled();
    expect(a.order).toEqual(["play"]); // re-applies the room state (already near position: no seek)
  });
  test("a seek event already at the room position is a no-op", () => {
    setRoom({ role: "host", playback: PB({ currentTime: 100 }) });
    render(ui(fakeAdapter({ time: 100 })));
    act(() => api.onSeek(100.5));
    expect(mocks.room.seek).not.toHaveBeenCalled();
  });
});

describe("native rate events", () => {
  test("controller rate change is emitted; the room's own rate echo is not", () => {
    setRoom({ role: "host", playback: PB({ rate: 1 }) });
    render(ui(fakeAdapter()));
    act(() => api.onRate(1.5));
    expect(mocks.room.setRate).toHaveBeenCalledWith(1.5);
    mocks.room.setRate.mockClear();
    act(() => api.onRate(1.5)); // same again: duplicate
    expect(mocks.room.setRate).not.toHaveBeenCalled();
  });
  test("a viewer's rate change is reverted and never emitted", () => {
    setRoom({ role: "participant", playback: PB({ rate: 1 }) });
    const a = fakeAdapter();
    render(ui(a));
    act(() => api.onRate(2));
    expect(mocks.room.setRate).not.toHaveBeenCalled();
    expect(a.setRate).toHaveBeenCalledWith(1);
  });
});

describe("autoplay restrictions", () => {
  test("a rejected play() (NotAllowedError) surfaces 'blocked' and tells the room; resume clears it", async () => {
    setRoom({ playback: PB({ playing: true }) });
    const a = fakeAdapter({ async: true });
    a.play = vi.fn(() =>
      Promise.reject(Object.assign(new Error("play() failed"), { name: "NotAllowedError" })),
    );
    render(ui(a));
    await flush();
    expect(api.blocked).toBe(true);
    expect(mocks.room.reportPlayerStatus).toHaveBeenCalledWith("blocked");
    a.play = vi.fn(() => Promise.resolve());
    await act(async () => api.resume());
    await flush();
    expect(a.play).toHaveBeenCalled();
    expect(api.blocked).toBe(false);
  });
  test("a synchronous NotAllowed throw is handled the same way", () => {
    setRoom({ playback: PB({ playing: true }) });
    const a = fakeAdapter();
    a.play = vi.fn(() => {
      const e = new Error("autoplay prevented");
      e.name = "NotAllowedError";
      throw e;
    });
    render(ui(a));
    expect(api.blocked).toBe(true);
  });
  test("other errors are ignored (player mid-teardown) and do not flag blocked", async () => {
    setRoom({ playback: PB({ playing: true }) });
    const a = fakeAdapter({ async: true });
    a.play = vi.fn(() => Promise.reject(new Error("player destroyed")));
    render(ui(a));
    await flush();
    expect(api.blocked).toBe(false);
  });
  test("the SDK's own 'playback blocked' event flags it", () => {
    render(ui(fakeAdapter()));
    act(() => api.onBlocked());
    expect(api.blocked).toBe(true);
  });
});

describe("host position reports and display bookkeeping", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  test("host + playing: first tick reports, then at most once per 3 s", () => {
    const room = setRoom({ role: "host", playback: PB({ playing: true, currentTime: 12.5 }) });
    render(ui(fakeAdapter({ time: 12.5 })));
    act(() => vi.advanceTimersByTime(500));
    expect(room.syncTime).toHaveBeenCalledTimes(1);
    expect(room.syncTime).toHaveBeenCalledWith(12.5);
    act(() => vi.advanceTimersByTime(2000));
    expect(room.syncTime).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(1000));
    expect(room.syncTime).toHaveBeenCalledTimes(2);
  });
  test.each([
    ["a moderator", { role: "moderator", playing: true }],
    ["a participant", { role: "participant", playing: true }],
    ["a host while paused", { role: "host", playing: false }],
  ])("%s never reports position", (_l, { role, playing }) => {
    const room = setRoom({ role, playback: PB({ playing }) });
    render(ui(fakeAdapter({ time: 5 })));
    act(() => vi.advanceTimersByTime(10_000));
    expect(room.syncTime).not.toHaveBeenCalled();
  });
  test("a buffering host does not report a stalled position", () => {
    const room = setRoom({ role: "host", playback: PB({ playing: true }) });
    render(ui(fakeAdapter({ time: 5 })));
    act(() => api.onBuffering(true));
    act(() => vi.advanceTimersByTime(10_000));
    expect(room.syncTime).not.toHaveBeenCalled();
  });
  test("works with a promise-based adapter", async () => {
    const room = setRoom({ role: "host", playback: PB({ playing: true, currentTime: 7 }) });
    render(ui(fakeAdapter({ time: 7, async: true })));
    await act(async () => {
      vi.advanceTimersByTime(500);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(room.syncTime).toHaveBeenCalledWith(7);
    expect(room.updatePlayback).toHaveBeenCalledWith({ currentTime: 7 });
  });
  test("releasing the adapter stops the ticker", () => {
    const room = setRoom({ role: "host", playback: PB({ playing: true }) });
    const a = fakeAdapter({ time: 5 });
    const { rerender } = render(ui(a));
    rerender(ui(null));
    room.syncTime.mockClear();
    act(() => vi.advanceTimersByTime(10_000));
    expect(room.syncTime).not.toHaveBeenCalled();
  });
});
