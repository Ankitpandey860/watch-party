import { makeCaps } from "./contract";

// Wraps a YT.Player (IFrame API) in the PlayerAdapter contract. YouTube's API is synchronous.
export function createYouTubeAdapter(player) {
  return {
    id: "youtube",
    caps: makeCaps({ play: true, pause: true, seek: true, rate: true, volume: true }),
    play: () => player.playVideo(),
    pause: () => player.pauseVideo(),
    seekTo: (sec) => player.seekTo(sec, true),
    getCurrentTime: () => player.getCurrentTime?.() ?? 0,
    getDuration: () => player.getDuration?.(),
    setVolume(v) {
      player.setVolume(v);
      if (v === 0) player.mute();
      else player.unMute();
    },
    getRate: () => player.getPlaybackRate?.() ?? 1,
    setRate: (r) => player.setPlaybackRate?.(r),
    destroy() {
      /* react-youtube owns the iframe's lifetime */
    },
  };
}
