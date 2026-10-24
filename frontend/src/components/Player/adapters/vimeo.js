import { makeCaps } from "./contract";

// Wraps a @vimeo/player Player (official SDK, MIT) in the PlayerAdapter contract. Vimeo's API is
// promise-based. `emit` receives normalised native events: { type: "play"|"pause"|"seek"|"rate"|
// "buffering"|"error", ... } so the component can forward them to the sync engine.
const EVENTS = [
  "play",
  "pause",
  "seeked",
  "playbackratechange",
  "bufferstart",
  "bufferend",
  "error",
];

export function createVimeoAdapter(player, emit = () => {}) {
  const handlers = {
    play: () => emit({ type: "play" }),
    pause: () => emit({ type: "pause" }),
    seeked: (e) => emit({ type: "seek", time: Number(e?.seconds) }),
    playbackratechange: (e) => emit({ type: "rate", rate: Number(e?.playbackRate) }),
    bufferstart: () => emit({ type: "buffering", value: true }),
    bufferend: () => emit({ type: "buffering", value: false }),
    error: (e) => emit({ type: "error", error: e }),
  };
  for (const ev of EVENTS) player.on(ev, handlers[ev]);
  let destroyed = false;

  return {
    id: "vimeo",
    caps: makeCaps({ play: true, pause: true, seek: true, rate: true, volume: true }),
    play: () => player.play(),
    pause: () => player.pause(),
    seekTo: (sec) => player.setCurrentTime(sec),
    getCurrentTime: () => player.getCurrentTime(),
    getDuration: () => player.getDuration(),
    setVolume: (v) => player.setVolume(Math.min(1, Math.max(0, v / 100))),
    getRate: () => player.getPlaybackRate(),
    setRate: (r) => player.setPlaybackRate(r),
    destroy() {
      if (destroyed) return;
      destroyed = true;
      for (const ev of EVENTS) {
        try {
          player.off(ev, handlers[ev]);
        } catch {
          /* ignore */
        }
      }
      try {
        const out = player.destroy();
        if (out && out.catch) out.catch(() => {});
      } catch {
        /* ignore */
      }
    },
  };
}

/** Vimeo error -> { code, message } in user-facing words (never leaks SDK internals). */
export function describeVimeoError(err) {
  const name = String(err?.name || "");
  if (name === "PrivacyError")
    return {
      code: "privacy",
      message:
        "This video's privacy settings don't allow it to be embedded here. Ask the owner to allow this site, or use an unlisted link.",
    };
  if (name === "PasswordError")
    return {
      code: "password",
      message: "This video is password-protected, so it can't be shared in a room.",
    };
  if (name === "NotFoundError" || /not.?found|404|doesn.?t exist/i.test(String(err?.message)))
    return {
      code: "not-found",
      message: "This Vimeo video wasn't found (it may be private, deleted or the link is wrong).",
    };
  if (name === "UnsupportedError")
    return { code: "unsupported", message: "Your browser can't play this Vimeo video." };
  return { code: "unavailable", message: "This Vimeo video can't be played here." };
}
