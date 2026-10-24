import { useCallback, useEffect, useState } from "react";
import YouTube from "react-youtube";
import { Play as PlayIcon } from "lucide-react";
import { Badge } from "../Badge";
import { EmptyState } from "../EmptyState";
import { extractYouTubeId } from "../../utils/youtube";
import { createYouTubeAdapter } from "./adapters/youtube";
import { useSyncedPlayer } from "./sync/useSyncedPlayer";

// YT.PlayerState values we care about (see the IFrame API docs). Buffering/cued/unstarted/ended are
// ignored: only real play/pause toggles matter for synchronisation.
const YT_STATE = { PLAYING: 1, PAUSED: 2 };

// YouTube IFrame player. ALL synchronisation (server-authoritative apply, drift correction, echo
// suppression, snap-back for viewers, host position reports) lives in sync/useSyncedPlayer.js and is
// shared with every other provider; this component only creates the player, wraps it in the
// PlayerAdapter contract and forwards its native events.
// Native YouTube controls are disabled (`controls: 0`): scrubbing/volume only happen through our
// own Controls component. Clicking the video canvas still toggles playback; that is caught below.
export function Player({ videoUrl, playing, providerLabel = "YouTube" }) {
  const videoId = extractYouTubeId(videoUrl);
  const [adapter, setAdapter] = useState(null);
  const [embedError, setEmbedError] = useState(false);
  const { onPlayState } = useSyncedPlayer({ adapter });

  // A different video means a different player instance.
  useEffect(() => {
    setAdapter(null);
    setEmbedError(false);
  }, [videoId]);

  const handleReady = useCallback((event) => setAdapter(createYouTubeAdapter(event.target)), []);

  const handleStateChange = useCallback(
    (event) => {
      const state = event.data;
      if (state !== YT_STATE.PLAYING && state !== YT_STATE.PAUSED) return;
      onPlayState(state === YT_STATE.PLAYING);
    },
    [onPlayState],
  );

  // YT error codes 2/5/100/101/150 all mean "can't be embedded/played here".
  const handleError = useCallback(() => setEmbedError(true), []);

  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-black shadow-elevated">
      <div className="aspect-video w-full">
        {videoId && !embedError ? (
          <div className="relative h-full w-full">
            <YouTube
              videoId={videoId}
              opts={{
                width: "100%",
                height: "100%",
                playerVars: {
                  autoplay: 0,
                  controls: 0,
                  disablekb: 1,
                  modestbranding: 1,
                  rel: 0,
                  playsinline: 1,
                },
              }}
              onReady={handleReady}
              onStateChange={handleStateChange}
              onError={handleError}
              className="h-full w-full"
              iframeClassName="h-full w-full"
            />
            <div className="pointer-events-none absolute left-4 top-4 flex gap-2">
              <Badge tone={playing ? "playing" : "paused"} dot>
                {playing ? "Playing" : "Paused"}
              </Badge>
              <Badge tone="neutral">{providerLabel}</Badge>
            </div>
          </div>
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-white/[0.02] to-transparent p-6">
            <EmptyState
              icon={PlayIcon}
              title={embedError ? "This video can't be played" : "No video selected"}
              description={
                embedError
                  ? "The owner disabled embedding for this video. Try pasting a different YouTube URL below."
                  : "Paste a YouTube URL below to load a video for everyone in the room."
              }
              className="border-transparent"
            />
          </div>
        )}
      </div>
    </div>
  );
}

export default Player;
