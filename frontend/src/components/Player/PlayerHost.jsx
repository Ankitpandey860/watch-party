import { lazy, Suspense } from "react";
import providerRegistry from "../../providers";
import { Player as YouTubePlayer } from "./Player";
import { NetflixCompanion } from "./NetflixCompanion";

// Vimeo/Twitch are code-split: a YouTube-only room never downloads their glue code (the Vimeo SDK
// itself is a dynamic import on top of that).
const VimeoPlayer = lazy(() => import("./VimeoPlayer"));
const TwitchPlayer = lazy(() => import("./TwitchPlayer"));

// provider id -> player component. A new provider adds ONE entry here (plus a descriptor in
// providers/index.js); the room page, context and socket layer do not change.
const PLAYERS = {
  youtube: YouTubePlayer,
  vimeo: VimeoPlayer,
  twitch: TwitchPlayer,
  netflix: NetflixCompanion,
};

/** Renders the player for the room's current provider (defaults to the first registered one). */
export function PlayerHost({ provider, videoUrl, playing }) {
  const id = provider && PLAYERS[provider] ? provider : "youtube";
  const PlayerComponent = PLAYERS[id];
  return (
    <Suspense
      fallback={
        <div className="flex aspect-video w-full items-center justify-center rounded-2xl border border-white/10 bg-black text-sm text-muted-foreground">
          Loading player…
        </div>
      }
    >
      <PlayerComponent
        videoUrl={videoUrl}
        playing={playing}
        providerLabel={providerRegistry.labelFor(id)}
      />
    </Suspense>
  );
}

export default PlayerHost;
