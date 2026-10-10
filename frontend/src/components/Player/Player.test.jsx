// Characterization tests for components/Player/Player.jsx.
// react-youtube (an iframe) and useRoom are mocked; Player's own logic is real.
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";

const mocks = vi.hoisted(() => ({ yt: { props: null }, room: {} }));

// No JSX inside the factory (it is hoisted above the JSX runtime import).
vi.mock("react-youtube", () => ({
  default: (props) => {
    mocks.yt.props = props;
    return null;
  },
}));
vi.mock("../../context/RoomContext", () => ({ useRoom: () => mocks.room }));

import { Player } from "./Player";

const URL_A = "https://www.youtube.com/watch?v=aaaaaaaaaaa";

function fakePlayer({ current = 0, duration = 300 } = {}) {
  const p = {
    time: current,
    getCurrentTime: vi.fn(() => p.time),
    getDuration: vi.fn(() => duration),
    seekTo: vi.fn(),
    playVideo: vi.fn(),
    pauseVideo: vi.fn(),
    setVolume: vi.fn(),
    mute: vi.fn(),
    unMute: vi.fn(),
  };
  return p;
}

function setRoom(over = {}) {
  mocks.room = {
    playback: { playing: false, currentTime: 0, duration: 0, volume: 60 },
    syncSeq: 0,
    driftSeq: 0,
    role: "participant",
    updatePlayback: vi.fn(),
    play: vi.fn(),
    pause: vi.fn(),
    syncTime: vi.fn(),
    ...over,
  };
  return mocks.room;
}

const ui = () => <Player videoUrl={URL_A} playing={mocks.room.playback.playing} />;
const ready = (player) => act(() => mocks.yt.props.onReady({ target: player }));
const stateChange = (data) => act(() => mocks.yt.props.onStateChange({ data }));

beforeEach(() => {
  mocks.yt.props = null;
  setRoom();
});

describe("rendering", () => {
  test("no video: shows the empty state and does not mount the YouTube player", () => {
    render(<Player videoUrl="" playing={false} />);
    expect(screen.getByText("No video selected")).toBeInTheDocument();
    expect(mocks.yt.props).toBeNull();
  });

  test("with a video: mounts YouTube with the extracted id and native controls disabled", () => {
    render(ui());
    expect(mocks.yt.props.videoId).toBe("aaaaaaaaaaa");
    expect(mocks.yt.props.opts.playerVars).toMatchObject({
      controls: 0,
      disablekb: 1,
      autoplay: 0,
      playsinline: 1,
    });
  });

  test("shows a 'YouTube' badge and the playing/paused badge (provider name is hard-coded)", () => {
    const { rerender } = render(<Player videoUrl={URL_A} playing={false} />);
    expect(screen.getByText("Paused")).toBeInTheDocument();
    expect(screen.getByText("YouTube")).toBeInTheDocument();
    rerender(<Player videoUrl={URL_A} playing={true} />);
    expect(screen.getByText("Playing")).toBeInTheDocument();
  });

  test("an embed error replaces the player with an explanatory empty state", () => {
    render(ui());
    act(() => mocks.yt.props.onError({ data: 150 }));
    expect(screen.getByText("This video can't be played")).toBeInTheDocument();
  });
});

describe("onReady applies the authoritative state", () => {
  test("seeks first when drift > 1.5s, then plays; also sets volume and reports duration", () => {
    setRoom({ playback: { playing: true, currentTime: 50, duration: 0, volume: 40 } });
    render(ui());
    const player = fakePlayer({ current: 0, duration: 300 });
    ready(player);
    expect(player.seekTo).toHaveBeenCalledWith(50, true);
    expect(player.playVideo).toHaveBeenCalled();
    expect(player.seekTo.mock.invocationCallOrder[0]).toBeLessThan(
      player.playVideo.mock.invocationCallOrder[0],
    );
    expect(player.setVolume).toHaveBeenCalledWith(40);
    expect(mocks.room.updatePlayback).toHaveBeenCalledWith({ duration: 300 });
  });

  test("does NOT seek when drift is within 1.5s; pauses when the room is paused", () => {
    setRoom({ playback: { playing: false, currentTime: 50, duration: 0, volume: 60 } });
    render(ui());
    const player = fakePlayer({ current: 49 });
    ready(player);
    expect(player.seekTo).not.toHaveBeenCalled();
    expect(player.pauseVideo).toHaveBeenCalled();
    expect(player.playVideo).not.toHaveBeenCalled();
  });
});

describe("applying later server updates", () => {
  test("a new syncSeq re-applies (seek + play/pause); an unchanged syncSeq does not", () => {
    setRoom({ playback: { playing: false, currentTime: 0, duration: 0, volume: 60 } });
    const { rerender } = render(ui());
    const player = fakePlayer({ current: 0 });
    ready(player);
    player.seekTo.mockClear();
    player.playVideo.mockClear();
    player.pauseVideo.mockClear();

    rerender(ui()); // same syncSeq -> nothing
    expect(player.playVideo).not.toHaveBeenCalled();

    setRoom({
      playback: { playing: true, currentTime: 120, duration: 300, volume: 60 },
      syncSeq: 1,
    });
    rerender(ui());
    expect(player.seekTo).toHaveBeenCalledWith(120, true);
    expect(player.playVideo).toHaveBeenCalledTimes(1);
  });

  test("a new driftSeq only seeks when drift > 0.4s and NEVER calls play/pause", () => {
    setRoom({ playback: { playing: true, currentTime: 100, duration: 0, volume: 60 } });
    const { rerender } = render(ui());
    const player = fakePlayer({ current: 100 });
    ready(player);
    player.seekTo.mockClear();
    player.playVideo.mockClear();
    player.pauseVideo.mockClear();

    player.time = 100.3; // 0.3s drift: tolerated
    setRoom({
      playback: { playing: true, currentTime: 100, duration: 0, volume: 60 },
      driftSeq: 1,
    });
    rerender(ui());
    expect(player.seekTo).not.toHaveBeenCalled();

    player.time = 101; // 1s drift: corrected
    setRoom({
      playback: { playing: true, currentTime: 100, duration: 0, volume: 60 },
      driftSeq: 2,
    });
    rerender(ui());
    expect(player.seekTo).toHaveBeenCalledWith(100, true);
    expect(player.playVideo).not.toHaveBeenCalled();
    expect(player.pauseVideo).not.toHaveBeenCalled();
  });
});

describe("clicks inside the iframe (onStateChange)", () => {
  const PLAYING = 1,
    PAUSED = 2,
    BUFFERING = 3;

  test("a state that matches the server's is an echo and is ignored", () => {
    setRoom({ role: "host", playback: { playing: true, currentTime: 0, duration: 0, volume: 60 } });
    render(ui());
    ready(fakePlayer());
    stateChange(PLAYING);
    expect(mocks.room.play).not.toHaveBeenCalled();
    expect(mocks.room.pause).not.toHaveBeenCalled();
  });

  test("buffering/other states are ignored", () => {
    setRoom({ role: "host" });
    render(ui());
    ready(fakePlayer());
    stateChange(BUFFERING);
    expect(mocks.room.play).not.toHaveBeenCalled();
  });

  test("host/moderator clicking play on a paused room emits play (and does not touch local state)", () => {
    for (const role of ["host", "moderator"]) {
      const room = setRoom({
        role,
        playback: { playing: false, currentTime: 0, duration: 0, volume: 60 },
      });
      const { unmount } = render(ui());
      const player = fakePlayer();
      ready(player);
      player.playVideo.mockClear();
      player.pauseVideo.mockClear();
      stateChange(PLAYING);
      expect(room.play).toHaveBeenCalledTimes(1);
      expect(player.pauseVideo).not.toHaveBeenCalled();
      unmount();
    }
  });

  test("host clicking pause on a playing room emits pause", () => {
    const room = setRoom({
      role: "host",
      playback: { playing: true, currentTime: 0, duration: 0, volume: 60 },
    });
    render(ui());
    ready(fakePlayer());
    stateChange(PAUSED);
    expect(room.pause).toHaveBeenCalledTimes(1);
  });

  test("a plain participant clicking play is snapped BACK to the server state and emits nothing", () => {
    const room = setRoom({
      role: "participant",
      playback: { playing: false, currentTime: 30, duration: 0, volume: 60 },
    });
    render(ui());
    const player = fakePlayer({ current: 30 });
    ready(player);
    player.pauseVideo.mockClear();
    stateChange(PLAYING);
    expect(room.play).not.toHaveBeenCalled();
    expect(room.pause).not.toHaveBeenCalled();
    expect(player.pauseVideo).toHaveBeenCalled();
  });
});

describe("host time_sync reporting", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  test("host + playing: reports position on the first 500ms tick, then at most once every 3s", () => {
    const room = setRoom({
      role: "host",
      playback: { playing: true, currentTime: 0, duration: 0, volume: 60 },
    });
    render(ui());
    const player = fakePlayer({ current: 12.5 });
    ready(player);

    act(() => vi.advanceTimersByTime(500));
    expect(room.syncTime).toHaveBeenCalledTimes(1);
    expect(room.syncTime).toHaveBeenCalledWith(12.5);
    expect(room.updatePlayback).toHaveBeenCalledWith({ currentTime: 12.5 });

    act(() => vi.advanceTimersByTime(2000));
    expect(room.syncTime).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(1000));
    expect(room.syncTime).toHaveBeenCalledTimes(2);
  });

  test.each([
    ["a moderator", { role: "moderator", playing: true }],
    ["a participant", { role: "participant", playing: true }],
    ["a host while paused", { role: "host", playing: false }],
  ])("%s never reports time_sync", (_label, { role, playing }) => {
    const room = setRoom({ role, playback: { playing, currentTime: 0, duration: 0, volume: 60 } });
    render(ui());
    ready(fakePlayer({ current: 5 }));
    act(() => vi.advanceTimersByTime(10_000));
    expect(room.syncTime).not.toHaveBeenCalled();
  });

  test("every participant's ticker mirrors the real player position and duration into context", () => {
    const room = setRoom({ role: "participant" });
    render(ui());
    ready(fakePlayer({ current: 7, duration: 200 }));
    act(() => vi.advanceTimersByTime(500));
    expect(room.updatePlayback).toHaveBeenCalledWith({ currentTime: 7 });
    expect(room.updatePlayback).toHaveBeenCalledWith({ duration: 200 });
  });
});
