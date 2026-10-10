import providerRegistry from "../../providers";
import { Player as YouTubePlayer } from "./Player";

// provider id -> player component. A new provider adds ONE entry here (plus a descriptor in
// providers/index.js); the room page, context and socket layer do not change.
const PLAYERS = {
  youtube: YouTubePlayer,
};

/** Renders the player for the room's current provider (defaults to the first registered one). */
export function PlayerHost({ provider, videoUrl, playing }) {
  const id = provider && PLAYERS[provider] ? provider : "youtube";
  const PlayerComponent = PLAYERS[id];
  return (
    <PlayerComponent
      videoUrl={videoUrl}
      playing={playing}
      providerLabel={providerRegistry.labelFor(id)}
    />
  );
}

export default PlayerHost;
