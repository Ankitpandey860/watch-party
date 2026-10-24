import { makeCaps } from "./contract";

export const TWITCH_SDK_URL = "https://player.twitch.tv/js/embed/v1.js";

// Wraps a Twitch.Player (official embed) for a VOD. Twitch's embed has no playback-rate API, so
// caps.rate is false and the room's rate is simply not applied (the UI says so). `emit` receives
// normalised native events.
export function createTwitchAdapter(player, TwitchPlayer, emit = () => {}) {
  const E = TwitchPlayer;
  const pairs = [
    [E.PLAY, () => emit({ type: "play" })],
    [E.PLAYING, () => emit({ type: "play" })],
    [E.PAUSE, () => emit({ type: "pause" })],
    [E.SEEK, (e) => emit({ type: "seek", time: Number(e?.position) })],
    [E.PLAYBACK_BLOCKED, () => emit({ type: "blocked" })],
    [E.OFFLINE, () => emit({ type: "error", error: { name: "Offline" } })],
  ].filter(([name]) => typeof name === "string");
  for (const [name, fn] of pairs) player.addEventListener(name, fn);
  let destroyed = false;

  return {
    id: "twitch",
    caps: makeCaps({ play: true, pause: true, seek: true, rate: false, volume: true }),
    play: () => player.play(),
    pause: () => player.pause(),
    seekTo: (sec) => player.seek(sec),
    getCurrentTime: () => player.getCurrentTime(),
    getDuration: () => player.getDuration(),
    setVolume: (v) => player.setVolume(Math.min(1, Math.max(0, v / 100))),
    destroy() {
      if (destroyed) return;
      destroyed = true;
      for (const [name, fn] of pairs) {
        try {
          player.removeEventListener?.(name, fn);
        } catch {
          /* ignore */
        }
      }
    },
  };
}
