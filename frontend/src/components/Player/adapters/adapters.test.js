import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { assertAdapter, makeCaps, chain, isAutoplayBlock, normalizeError } from "./contract";
import { createYouTubeAdapter } from "./youtube";
import { createVimeoAdapter, describeVimeoError } from "./vimeo";
import { createTwitchAdapter } from "./twitch";
import { loadScriptOnce, _resetSdkLoader } from "./sdkLoader";

describe("contract helpers", () => {
  test("makeCaps defaults every flag to false (a missing capability is 'not supported')", () => {
    expect(makeCaps()).toEqual({
      play: false,
      pause: false,
      seek: false,
      rate: false,
      volume: false,
    });
    expect(makeCaps({ seek: true, rate: "yes" })).toMatchObject({ seek: true, rate: false });
    expect(Object.isFrozen(makeCaps())).toBe(true);
  });
  test("assertAdapter rejects incomplete adapters and inconsistent capability claims", () => {
    expect(() => assertAdapter(null)).toThrow();
    expect(() => assertAdapter({ caps: makeCaps() })).toThrow(/play is required/);
    const base = {
      play() {},
      pause() {},
      seekTo() {},
      getCurrentTime() {},
      getDuration() {},
      destroy() {},
    };
    expect(() => assertAdapter({ ...base, caps: { play: true } })).toThrow(/every capability/);
    expect(() => assertAdapter({ ...base, caps: makeCaps({ rate: true }) })).toThrow(/setRate/);
    expect(() => assertAdapter({ ...base, caps: makeCaps({ volume: true }) })).toThrow(/setVolume/);
    expect(assertAdapter({ ...base, caps: makeCaps({ play: true }) })).toBeTruthy();
  });
  test("chain stays synchronous for plain values and chains promises", async () => {
    expect(chain(2, (x) => x + 1)).toBe(3);
    await expect(chain(Promise.resolve(2), (x) => x + 1)).resolves.toBe(3);
  });
  test("isAutoplayBlock recognises browser/SDK autoplay refusals only", () => {
    expect(isAutoplayBlock({ name: "NotAllowedError" })).toBe(true);
    expect(isAutoplayBlock(new Error("play() failed because the user didn't interact"))).toBe(true);
    expect(isAutoplayBlock(new Error("network down"))).toBe(false);
    expect(isAutoplayBlock(null)).toBe(false);
  });
  test("normalizeError never leaks SDK internals", () => {
    const e = normalizeError(
      "x",
      Object.assign(new Error("secret stack token=abc"), { name: "Weird" }),
    );
    expect(JSON.stringify(e)).not.toMatch(/secret|token/);
  });
});

describe("YouTube adapter", () => {
  const yt = () => ({
    playVideo: vi.fn(),
    pauseVideo: vi.fn(),
    seekTo: vi.fn(),
    getCurrentTime: vi.fn(() => 12),
    getDuration: vi.fn(() => 99),
    setVolume: vi.fn(),
    mute: vi.fn(),
    unMute: vi.fn(),
    getPlaybackRate: vi.fn(() => 1.25),
    setPlaybackRate: vi.fn(),
  });
  test("satisfies the contract and maps every call onto the IFrame API", () => {
    const p = yt();
    const a = assertAdapter(createYouTubeAdapter(p));
    a.play();
    a.pause();
    a.seekTo(30);
    a.setRate(1.5);
    expect(p.playVideo).toHaveBeenCalled();
    expect(p.pauseVideo).toHaveBeenCalled();
    expect(p.seekTo).toHaveBeenCalledWith(30, true);
    expect(p.setPlaybackRate).toHaveBeenCalledWith(1.5);
    expect(a.getCurrentTime()).toBe(12);
    expect(a.getDuration()).toBe(99);
    expect(a.getRate()).toBe(1.25);
  });
  test("volume 0 mutes, anything else unmutes", () => {
    const p = yt();
    const a = createYouTubeAdapter(p);
    a.setVolume(0);
    expect(p.mute).toHaveBeenCalled();
    a.setVolume(40);
    expect(p.unMute).toHaveBeenCalled();
  });
  test("tolerates an older/minimal player object (no rate API)", () => {
    const p = yt();
    delete p.getPlaybackRate;
    delete p.setPlaybackRate;
    const a = createYouTubeAdapter(p);
    expect(a.getRate()).toBe(1);
    expect(() => a.setRate(2)).not.toThrow();
  });
});

describe("Vimeo adapter", () => {
  function fakeVimeo() {
    const handlers = {};
    return {
      handlers,
      on: vi.fn((e, f) => (handlers[e] = f)),
      off: vi.fn((e) => delete handlers[e]),
      play: vi.fn(() => Promise.resolve()),
      pause: vi.fn(() => Promise.resolve()),
      setCurrentTime: vi.fn((t) => Promise.resolve(t)),
      getCurrentTime: vi.fn(() => Promise.resolve(5)),
      getDuration: vi.fn(() => Promise.resolve(60)),
      setVolume: vi.fn(() => Promise.resolve()),
      getPlaybackRate: vi.fn(() => Promise.resolve(1)),
      setPlaybackRate: vi.fn(() => Promise.resolve()),
      destroy: vi.fn(() => Promise.resolve()),
    };
  }
  test("satisfies the contract; volume is scaled 0-100 -> 0-1 and clamped", async () => {
    const p = fakeVimeo();
    const a = assertAdapter(createVimeoAdapter(p));
    await expect(a.getCurrentTime()).resolves.toBe(5);
    a.seekTo(30);
    a.setVolume(50);
    a.setVolume(500);
    a.setVolume(-5);
    a.setRate(1.5);
    expect(p.setCurrentTime).toHaveBeenCalledWith(30);
    expect(p.setVolume.mock.calls.map((c) => c[0])).toEqual([0.5, 1, 0]);
    expect(p.setPlaybackRate).toHaveBeenCalledWith(1.5);
  });
  test("normalises SDK events into the engine's vocabulary", () => {
    const p = fakeVimeo();
    const seen = [];
    createVimeoAdapter(p, (e) => seen.push(e));
    p.handlers.play();
    p.handlers.pause();
    p.handlers.seeked({ seconds: 12.5 });
    p.handlers.playbackratechange({ playbackRate: 1.5 });
    p.handlers.bufferstart();
    p.handlers.bufferend();
    p.handlers.error({ name: "PrivacyError" });
    expect(seen.map((e) => e.type)).toEqual([
      "play",
      "pause",
      "seek",
      "rate",
      "buffering",
      "buffering",
      "error",
    ]);
    expect(seen[2].time).toBe(12.5);
    expect(seen[3].rate).toBe(1.5);
    expect([seen[4].value, seen[5].value]).toEqual([true, false]);
  });
  test("destroy removes every listener, destroys the player, and is idempotent", () => {
    const p = fakeVimeo();
    const a = createVimeoAdapter(p);
    a.destroy();
    a.destroy();
    expect(Object.keys(p.handlers)).toEqual([]);
    expect(p.destroy).toHaveBeenCalledTimes(1);
  });
  test("destroy survives an SDK that throws", () => {
    const p = fakeVimeo();
    p.destroy = vi.fn(() => {
      throw new Error("boom");
    });
    p.off = vi.fn(() => {
      throw new Error("boom");
    });
    expect(() => createVimeoAdapter(p).destroy()).not.toThrow();
  });
  test("errors become specific, user-facing messages (privacy / password / missing / unsupported / generic)", () => {
    expect(describeVimeoError({ name: "PrivacyError" })).toMatchObject({ code: "privacy" });
    expect(describeVimeoError({ name: "PasswordError" })).toMatchObject({ code: "password" });
    expect(describeVimeoError(new Error("The video was not found (404)"))).toMatchObject({
      code: "not-found",
    });
    expect(describeVimeoError({ name: "UnsupportedError" })).toMatchObject({ code: "unsupported" });
    expect(describeVimeoError(undefined)).toMatchObject({ code: "unavailable" });
    expect(describeVimeoError({ name: "PrivacyError" }).message).toMatch(/privacy/i);
  });
});

describe("Twitch adapter", () => {
  const E = {
    READY: "ready",
    PLAY: "play",
    PLAYING: "playing",
    PAUSE: "pause",
    SEEK: "seek",
    PLAYBACK_BLOCKED: "playbackBlocked",
    OFFLINE: "offline",
  };
  function fakeTwitch() {
    const handlers = {};
    return {
      handlers,
      addEventListener: vi.fn((e, f) => (handlers[e] = f)),
      removeEventListener: vi.fn((e) => delete handlers[e]),
      play: vi.fn(),
      pause: vi.fn(),
      seek: vi.fn(),
      getCurrentTime: vi.fn(() => 8),
      getDuration: vi.fn(() => 400),
      setVolume: vi.fn(),
    };
  }
  test("satisfies the contract and states that playback rate is NOT supported", () => {
    const p = fakeTwitch();
    const a = assertAdapter(createTwitchAdapter(p, E));
    expect(a.caps).toMatchObject({
      play: true,
      pause: true,
      seek: true,
      rate: false,
      volume: true,
    });
    expect(a.setRate).toBeUndefined();
    a.seekTo(30);
    a.setVolume(25);
    expect(p.seek).toHaveBeenCalledWith(30);
    expect(p.setVolume).toHaveBeenCalledWith(0.25);
    expect(a.getCurrentTime()).toBe(8);
  });
  test("normalises events: PLAY and PLAYING are both 'play'; blocked and offline are surfaced", () => {
    const p = fakeTwitch();
    const seen = [];
    createTwitchAdapter(p, E, (e) => seen.push(e));
    p.handlers.play();
    p.handlers.playing();
    p.handlers.pause();
    p.handlers.seek({ position: 44 });
    p.handlers.playbackBlocked();
    p.handlers.offline();
    expect(seen.map((e) => e.type)).toEqual(["play", "play", "pause", "seek", "blocked", "error"]);
    expect(seen[3].time).toBe(44);
  });
  test("a Twitch build lacking an event constant degrades instead of throwing", () => {
    const p = fakeTwitch();
    expect(() => createTwitchAdapter(p, { PLAY: "play", PAUSE: "pause" })).not.toThrow();
  });
  test("destroy removes listeners and is idempotent", () => {
    const p = fakeTwitch();
    const a = createTwitchAdapter(p, E);
    a.destroy();
    a.destroy();
    expect(Object.keys(p.handlers)).toEqual([]);
  });
});

describe("SDK script loader", () => {
  let doc, win, scripts;
  beforeEach(() => {
    _resetSdkLoader();
    scripts = [];
    win = {};
    doc = {
      createElement: () => {
        const s = { remove: vi.fn() };
        scripts.push(s);
        return s;
      },
      head: { appendChild: vi.fn() },
    };
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());
  const SRC = "https://player.example.test/sdk.js";

  test("concurrent callers share ONE script tag; resolves with the global once loaded", async () => {
    const a = loadScriptOnce(SRC, { globalName: "SDK", doc, win });
    const b = loadScriptOnce(SRC, { globalName: "SDK", doc, win });
    expect(scripts).toHaveLength(1);
    win.SDK = { ok: true };
    scripts[0].onload();
    await expect(a).resolves.toEqual({ ok: true });
    await expect(b).resolves.toEqual({ ok: true });
  });
  test("an already-present global resolves immediately without adding a script", async () => {
    win.SDK = { ok: 1 };
    await expect(loadScriptOnce(SRC, { globalName: "SDK", doc, win })).resolves.toEqual({ ok: 1 });
    expect(scripts).toHaveLength(0);
  });
  test("a failed load is not cached: the next call retries with a fresh script", async () => {
    const first = loadScriptOnce(SRC, { globalName: "SDK", doc, win });
    scripts[0].onerror();
    await expect(first).rejects.toThrow(/Couldn't load/);
    expect(scripts[0].remove).toHaveBeenCalled();
    const second = loadScriptOnce(SRC, { globalName: "SDK", doc, win });
    expect(scripts).toHaveLength(2);
    win.SDK = 1;
    scripts[1].onload();
    await expect(second).resolves.toBe(1);
  });
  test("times out instead of hanging", async () => {
    const p = loadScriptOnce(SRC, { globalName: "SDK", doc, win, timeoutMs: 1000 });
    const assertion = expect(p).rejects.toThrow(/Timed out/);
    vi.advanceTimersByTime(1001);
    await assertion;
  });
  test("a script that loads but defines nothing is an error (blocked / wrong file)", async () => {
    const p = loadScriptOnce(SRC, { globalName: "SDK", doc, win });
    scripts[0].onload();
    await expect(p).rejects.toThrow(/did not define SDK/);
  });
});
