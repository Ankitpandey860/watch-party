import { Play as PlayIcon, Loader2, Info } from "lucide-react";
import { Badge } from "../Badge";
import { EmptyState } from "../EmptyState";

/**
 * Shared chrome for embedded providers: the aspect-ratio box, the status badges, the buffering pill,
 * the "browser blocked autoplay" prompt, a limitation notice and the error state. Keeps Vimeo/Twitch
 * (and future providers) visually identical without duplicating markup.
 */
export function PlayerFrame({
  providerLabel,
  playing,
  buffering = false,
  blocked = false,
  onResume,
  error = null, // { title, message }
  notice = null, // string shown over the bottom edge (e.g. "Clips can't be remote-controlled")
  empty = null, // { title, description } when nothing is loaded
  children,
}) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-black shadow-elevated">
      <div className="aspect-video w-full">
        {error || empty ? (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-white/[0.02] to-transparent p-6">
            <EmptyState
              icon={PlayIcon}
              title={error ? error.title : empty.title}
              description={error ? error.message : empty.description}
              className="border-transparent"
            />
          </div>
        ) : (
          <div className="relative h-full w-full">
            {children}
            <div className="pointer-events-none absolute left-4 top-4 flex flex-wrap gap-2">
              <Badge tone={playing ? "playing" : "paused"} dot>
                {playing ? "Playing" : "Paused"}
              </Badge>
              <Badge tone="neutral">{providerLabel}</Badge>
              {buffering && (
                <Badge tone="neutral">
                  <Loader2 className="mr-1 inline h-3 w-3 animate-spin" aria-hidden="true" />
                  Buffering
                </Badge>
              )}
            </div>
            {blocked && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/70 p-4 text-center">
                <div className="max-w-sm space-y-3">
                  <p className="text-sm text-white/90">
                    Your browser blocked automatic playback. Click to join the room's playback.
                  </p>
                  <button
                    type="button"
                    onClick={onResume}
                    className="rounded-full bg-white px-5 py-2 text-sm font-medium text-black"
                  >
                    Join playback
                  </button>
                </div>
              </div>
            )}
            {notice && (
              <div
                role="note"
                className="pointer-events-none absolute inset-x-3 bottom-3 flex items-start gap-2 rounded-lg bg-black/75 px-3 py-2 text-xs text-white/85"
              >
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>{notice}</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default PlayerFrame;
