// Component tests for the Vimeo / Twitch players and the Netflix companion panel. The vendor SDKs are
// replaced by fakes: these prove OUR glue (lifecycle, cleanup, errors, event forwarding, clip handling),
// not Vimeo's or Twitch's real players.
import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, act, waitFor, fireEvent } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  room: {},
  vimeo: { instances: [], failReady: null },
  twitch: { loader: null, players: [] },
  pairing: {},
}));

vi.mock("../../context/RoomContext", () => ({ useRoom: () => mocks.room }));

vi.mock("@vimeo/player", () => {
  class FakeVimeo {
    constructor(el, opts) {
      this.el = el;
      this.opts = opts;
      this.handlers = {};
      this.destroyed = false;
      mocks.vimeo.instances.push(this);
    }
    on(e, f) {
      this.handlers[e] = f;
    }
    off(e) {
      delete this.handlers[e];
    }
    ready() {
      return mocks.vimeo.failReady ? Promise.reject(mocks.vimeo.failReady) : Promise.resolve();
    }
    play() {
      return Promise.resolve();
    }
    pause() {
      return Promise.resolve();
    }
    setCurrentTime(t) {
      this.t = t;
      return Promise.resolve(t);
    }
    getCurrentTime() {
      return Promise.resolve(this.t ?? 0);
    }
    getDuration() {
      return Promise.resolve(120);
    }
    setVolume() {
      return Promise.resolve();
    }
    getPlaybackRate() {
      return Promise.resolve(1);
    }
    setPlaybackRate() {
      return Promise.resolve();
    }
    destroy() {
      this.destroyed = true;
      return Promise.resolve();
    }
  }
  return { default: FakeVimeo };
});

vi.mock("./adapters/sdkLoader", () => ({
  loadScriptOnce: (...args) => mocks.twitch.loader(...args),
}));

vi.mock("../../hooks/useExtensionPairing", () => ({ useExtensionPairing: () => mocks.pairing }));

import { VimeoPlayer } from "./VimeoPlayer";
import { TwitchPlayer, twitchParent } from "./TwitchPlayer";
import { NetflixCompanion } from "./NetflixCompanion";
import { PlayerHost } from "./PlayerHost";

const PB = (o = {}) => ({ playing: false, currentTime: 0, duration: 0, volume: 60, rate: 1, ...o });
function setRoom(over = {}) {
  mocks.room = {
    roomId: "ROOM42",
    userId: "me",
    playback: PB(),
    syncSeq: 0,
    driftSeq: 0,
    role: "participant",
    settings: { moderatorsCanControl: true, maxModerators: 3 },
    participants: [],
    updatePlayback: vi.fn(),
    play: vi.fn(),
    pause: vi.fn(),
    seek: vi.fn(),
    setRate: vi.fn(),
    syncTime: vi.fn(),
    reportPlayerStatus: vi.fn(),
    ...over,
  };
}
const tick = () =>
  act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });

beforeEach(() => {
  mocks.vimeo.instances.length = 0;
  mocks.vimeo.failReady = null;
  mocks.twitch.players.length = 0;
  setRoom();
});

describe("VimeoPlayer", () => {
  test("loads the SDK on demand with the video id and privacy-friendly options, then syncs", async () => {
    setRoom({ playback: PB({ playing: true, currentTime: 40 }) });
    render(<VimeoPlayer videoUrl="https://vimeo.com/76979871" playing />);
    await waitFor(() => expect(mocks.vimeo.instances).toHaveLength(1));
    const v = mocks.vimeo.instances[0];
    expect(v.opts).toMatchObject({ id: 76979871, dnt: true, responsive: true });
    await tick();
    expect(v.t).toBe(40); // seeked to the room position on ready
    expect(mocks.room.reportPlayerStatus).toHaveBeenCalledWith("ready");
  });
  test("an unlisted video is loaded through its URL form so the privacy hash is used", async () => {
    render(<VimeoPlayer videoUrl="https://vimeo.com/76979871/abcdef0123" playing={false} />);
    await waitFor(() => expect(mocks.vimeo.instances).toHaveLength(1));
    expect(mocks.vimeo.instances[0].opts.url).toBe("https://vimeo.com/76979871/abcdef0123");
    expect(mocks.vimeo.instances[0].opts.id).toBeUndefined();
  });
  test("a privacy failure shows a specific explanation and tells the room this player is unsupported", async () => {
    mocks.vimeo.failReady = Object.assign(new Error("x"), { name: "PrivacyError" });
    render(<VimeoPlayer videoUrl="https://vimeo.com/76979871" playing={false} />);
    expect(await screen.findByText(/privacy settings/i)).toBeInTheDocument();
    expect(mocks.room.reportPlayerStatus).toHaveBeenCalledWith("unsupported");
  });
  test("SDK events are forwarded: a host's native pause is emitted, a viewer's is reverted", async () => {
    setRoom({ role: "host", playback: PB({ playing: true }) });
    render(<VimeoPlayer videoUrl="https://vimeo.com/76979871" playing />);
    await waitFor(() => expect(mocks.vimeo.instances).toHaveLength(1));
    await tick();
    act(() => mocks.vimeo.instances[0].handlers.pause());
    expect(mocks.room.pause).toHaveBeenCalledTimes(1);
  });
  test("a viewer's native pause emits nothing", async () => {
    setRoom({ role: "participant", playback: PB({ playing: true }) });
    render(<VimeoPlayer videoUrl="https://vimeo.com/76979871" playing />);
    await waitFor(() => expect(mocks.vimeo.instances).toHaveLength(1));
    await tick();
    act(() => mocks.vimeo.instances[0].handlers.pause());
    expect(mocks.room.pause).not.toHaveBeenCalled();
  });
  test("buffering is shown and unmounting destroys the SDK player (no leak)", async () => {
    const { unmount } = render(
      <VimeoPlayer videoUrl="https://vimeo.com/76979871" playing={false} />,
    );
    await waitFor(() => expect(mocks.vimeo.instances).toHaveLength(1));
    await tick();
    act(() => mocks.vimeo.instances[0].handlers.bufferstart());
    expect(screen.getByText("Buffering")).toBeInTheDocument();
    unmount();
    expect(mocks.vimeo.instances[0].destroyed).toBe(true);
  });
  test("changing video destroys the old player and creates a new one", async () => {
    const { rerender } = render(
      <VimeoPlayer videoUrl="https://vimeo.com/111111" playing={false} />,
    );
    await waitFor(() => expect(mocks.vimeo.instances).toHaveLength(1));
    await tick();
    rerender(<VimeoPlayer videoUrl="https://vimeo.com/222222" playing={false} />);
    await waitFor(() => expect(mocks.vimeo.instances).toHaveLength(2));
    expect(mocks.vimeo.instances[0].destroyed).toBe(true);
    expect(mocks.vimeo.instances[1].opts.id).toBe(222222);
  });
  test("an unrecognised URL shows the empty state and never loads the SDK", () => {
    render(<VimeoPlayer videoUrl="" playing={false} />);
    expect(screen.getByText("No video selected")).toBeInTheDocument();
    expect(mocks.vimeo.instances).toHaveLength(0);
  });
});

describe("TwitchPlayer", () => {
  function fakeTwitchGlobal() {
    class P {
      static READY = "ready";
      static PLAY = "play";
      static PLAYING = "playing";
      static PAUSE = "pause";
      static SEEK = "seek";
      static PLAYBACK_BLOCKED = "playbackBlocked";
      static OFFLINE = "offline";
      constructor(el, opts) {
        this.el = el;
        this.opts = opts;
        this.handlers = {};
        this.t = 0;
        mocks.twitch.players.push(this);
      }
      addEventListener(e, f) {
        this.handlers[e] = f;
      }
      removeEventListener(e) {
        delete this.handlers[e];
      }
      play() {}
      pause() {}
      seek(t) {
        this.t = t;
      }
      getCurrentTime() {
        return this.t;
      }
      getDuration() {
        return 500;
      }
      setVolume() {}
    }
    return { Player: P };
  }
  beforeEach(() => {
    const T = fakeTwitchGlobal();
    mocks.twitch.loader = vi.fn(() => Promise.resolve(T));
  });

  test("loads the official embed for a VOD with the page hostname as parent, autoplay off", async () => {
    render(<TwitchPlayer videoUrl="https://www.twitch.tv/videos/1234567890" playing={false} />);
    await waitFor(() => expect(mocks.twitch.players).toHaveLength(1));
    expect(mocks.twitch.loader).toHaveBeenCalledWith("https://player.twitch.tv/js/embed/v1.js", {
      globalName: "Twitch",
    });
    const p = mocks.twitch.players[0];
    expect(p.opts).toMatchObject({
      video: "v1234567890",
      autoplay: false,
      parent: [twitchParent()],
    });
  });
  test("syncs only after the player is READY; then seek-first apply + native event forwarding", async () => {
    setRoom({ role: "host", playback: PB({ playing: true, currentTime: 90 }) });
    render(<TwitchPlayer videoUrl="https://www.twitch.tv/videos/1234567890" playing />);
    await waitFor(() => expect(mocks.twitch.players).toHaveLength(1));
    const p = mocks.twitch.players[0];
    expect(p.t).toBe(0); // not touched before READY
    act(() => p.handlers.ready());
    expect(p.t).toBe(90);
    act(() => p.handlers.pause());
    expect(mocks.room.pause).toHaveBeenCalledTimes(1);
  });
  test("the browser's autoplay block is surfaced with a 'Join playback' prompt", async () => {
    setRoom({ playback: PB({ playing: true }) });
    render(<TwitchPlayer videoUrl="https://www.twitch.tv/videos/1234567890" playing />);
    await waitFor(() => expect(mocks.twitch.players).toHaveLength(1));
    const p = mocks.twitch.players[0];
    act(() => p.handlers.ready());
    act(() => p.handlers.playbackBlocked());
    expect(screen.getByText(/blocked automatic playback/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Join playback" }));
    expect(screen.queryByText(/blocked automatic playback/i)).toBeNull();
  });
  test("a script that cannot load (ad-blocker/network) shows an explanation, not a blank box", async () => {
    mocks.twitch.loader = vi.fn(() =>
      Promise.reject(
        new Error(
          "Couldn't load player.twitch.tv (blocked by a network, ad-blocker or privacy setting?)",
        ),
      ),
    );
    render(<TwitchPlayer videoUrl="https://www.twitch.tv/videos/1234567890" playing={false} />);
    expect(await screen.findByText(/ad-blocker/)).toBeInTheDocument();
    expect(mocks.room.reportPlayerStatus).toHaveBeenCalledWith("unsupported");
  });
  test("CLIPS: official clip embed with the parent, explicit 'not synchronised' notice, and NO player sync", async () => {
    setRoom({ role: "host", playback: PB({ playing: true, currentTime: 30 }) });
    const { container } = render(
      <TwitchPlayer videoUrl="https://clips.twitch.tv/FunnySlug-abc123" playing />,
    );
    const frame = container.querySelector("iframe");
    expect(frame.getAttribute("src")).toBe(
      `https://clips.twitch.tv/embed?clip=FunnySlug-abc123&parent=${encodeURIComponent(twitchParent())}&autoplay=false`,
    );
    expect(screen.getByRole("note")).toHaveTextContent(/not synchronised/i);
    expect(mocks.twitch.loader).not.toHaveBeenCalled();
    expect(mocks.room.reportPlayerStatus).not.toHaveBeenCalledWith("ready");
  });
  test("unmounting releases the player's listeners", async () => {
    const { unmount } = render(
      <TwitchPlayer videoUrl="https://www.twitch.tv/videos/1234567890" playing={false} />,
    );
    await waitFor(() => expect(mocks.twitch.players).toHaveLength(1));
    const p = mocks.twitch.players[0];
    act(() => p.handlers.ready());
    unmount();
    expect(Object.keys(p.handlers)).toEqual(["ready"]); // adapter listeners removed (READY is ours, one-shot)
  });
});

describe("NetflixCompanion", () => {
  const NF = "https://www.netflix.com/watch/80100172";
  const status = (o = {}) => ({
    paired: false,
    connected: false,
    label: null,
    expiresAt: null,
    ...o,
  });
  beforeEach(() => {
    mocks.pairing = {
      status: status(),
      code: null,
      expiresIn: 0,
      busy: false,
      error: "",
      pair: vi.fn(),
      revoke: vi.fn(),
    };
  });

  test("not paired: explains the model and offers 'Pair extension' (wired to the pairing call)", () => {
    render(<NetflixCompanion videoUrl={NF} />);
    expect(screen.getByText("Extension not paired")).toBeInTheDocument();
    expect(screen.getByText(/their own Netflix tab/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Pair extension" }));
    expect(mocks.pairing.pair).toHaveBeenCalled();
  });
  test("the Netflix link opens in a new tab without leaking the opener", () => {
    render(<NetflixCompanion videoUrl={NF} />);
    const a = screen.getByRole("link", { name: /Open title 80100172 on Netflix/ });
    expect(a).toHaveAttribute("href", NF);
    expect(a).toHaveAttribute("target", "_blank");
    expect(a.getAttribute("rel")).toMatch(/noopener/);
  });
  test("shows the one-time code with its expiry and the site address to enter", () => {
    mocks.pairing = { ...mocks.pairing, code: "ABCD-EFGH", expiresIn: 87 };
    render(<NetflixCompanion videoUrl={NF} />);
    expect(screen.getByTestId("pairing-code")).toHaveTextContent("ABCD-EFGH");
    expect(screen.getByText(/expires in 87s/)).toBeInTheDocument();
    expect(screen.getByText(window.location.origin)).toBeInTheDocument();
  });
  test("paired + connected: shows the connection and 'Revoke pairing' (wired)", () => {
    mocks.pairing = {
      ...mocks.pairing,
      status: status({ paired: true, connected: true, label: "Chrome on Linux" }),
    };
    render(<NetflixCompanion videoUrl={NF} />);
    expect(screen.getByText("Extension connected")).toBeInTheDocument();
    expect(screen.getByText(/Chrome on Linux/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Revoke pairing/ }));
    expect(mocks.pairing.revoke).toHaveBeenCalled();
  });
  test("paired but offline is distinguished from connected, with a way to recover", () => {
    mocks.pairing = { ...mocks.pairing, status: status({ paired: true, connected: false }) };
    render(<NetflixCompanion videoUrl={NF} />);
    expect(screen.getByText("Paired, extension offline")).toBeInTheDocument();
    expect(screen.getByText(/press Reconnect/)).toBeInTheDocument();
  });
  test("pairing errors are announced", () => {
    mocks.pairing = { ...mocks.pairing, error: "Join the room first, then pair your extension." };
    render(<NetflixCompanion videoUrl={NF} />);
    expect(screen.getByRole("alert")).toHaveTextContent(/Join the room first/);
  });
  test("room status: counts who is in sync and names anyone on the wrong title", () => {
    setRoom({
      participants: [
        { id: "me", username: "Me", online: true, playerStatus: "ready" },
        { id: "b", username: "Bob", online: true, playerStatus: "wrong_title" },
        { id: "c", username: "Cy", online: true, playerStatus: null },
        { id: "d", username: "Gone", online: false, playerStatus: "ready" },
      ],
    });
    mocks.pairing = { ...mocks.pairing, status: status({ paired: true, connected: true }) };
    render(<NetflixCompanion videoUrl={NF} />);
    expect(screen.getByText(/1 of 3 online people have/)).toBeInTheDocument();
    expect(screen.getByText(/Wrong title open: Bob/)).toBeInTheDocument();
    expect(screen.getByText("In sync")).toBeInTheDocument(); // my own status badge
  });
  test("no title yet: viewers are told the host will load one; controllers are told how", () => {
    const { rerender } = render(<NetflixCompanion videoUrl="" />);
    expect(screen.getByText(/host will load one/)).toBeInTheDocument();
    setRoom({ role: "host" });
    rerender(<NetflixCompanion videoUrl="" />);
    expect(screen.getByText(/Paste a netflix\.com\/watch link/)).toBeInTheDocument();
  });
  test("states that no Netflix credentials or video reach Watch Party", () => {
    render(<NetflixCompanion videoUrl={NF} />);
    expect(
      screen.getByText(/login, cookies and video never reach Watch Party/),
    ).toBeInTheDocument();
  });
});

describe("PlayerHost routing", () => {
  test("netflix renders the companion panel (no embedded player, no SDK)", () => {
    mocks.pairing = {
      status: { paired: false, connected: false },
      code: null,
      expiresIn: 0,
      busy: false,
      error: "",
      pair: vi.fn(),
      revoke: vi.fn(),
    };
    render(
      <PlayerHost
        provider="netflix"
        videoUrl="https://www.netflix.com/watch/80100172"
        playing={false}
      />,
    );
    expect(screen.getByTestId("netflix-companion")).toBeInTheDocument();
  });
  test("vimeo is lazy-loaded and mounts its own player", async () => {
    render(<PlayerHost provider="vimeo" videoUrl="https://vimeo.com/76979871" playing={false} />);
    expect(await screen.findByTestId("vimeo-holder")).toBeInTheDocument();
  });
  test("an unknown or missing provider falls back to YouTube (old servers / old rooms)", () => {
    render(<PlayerHost provider={null} videoUrl="" playing={false} />);
    expect(screen.getByText("No video selected")).toBeInTheDocument();
  });
});
