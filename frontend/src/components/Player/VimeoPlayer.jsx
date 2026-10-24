import { useEffect, useRef, useState } from "react";
import providerRegistry from "../../providers";
import { createVimeoAdapter, describeVimeoError } from "./adapters/vimeo";
import { useSyncedPlayer } from "./sync/useSyncedPlayer";
import { PlayerFrame } from "./PlayerFrame";
import { useRoom } from "../../context/RoomContext";

// Vimeo's player reports seeks coarsely; 1.5 s / 0.5 s tolerances keep corrections invisible.
const TOLERANCES = { seek: 1.5, drift: 0.5 };

/** Vimeo through the official @vimeo/player SDK (loaded on demand: other rooms never download it). */
export function VimeoPlayer({ videoUrl, playing, providerLabel = "Vimeo" }) {
  const media = providerRegistry.resolve(videoUrl, "vimeo");
  const id = media?.mediaId || "";
  const hash = media?.params?.hash || "";
  const holder = useRef(null);
  const [adapter, setAdapter] = useState(null);
  const [error, setError] = useState(null);
  const { reportPlayerStatus } = useRoom();

  const sync = useSyncedPlayer({ adapter, tolerances: TOLERANCES });
  // The SDK's events outlive any one render: they call the latest handlers through this ref.
  const handlers = useRef(sync);
  handlers.current = sync;
  const report = useRef(reportPlayerStatus);
  report.current = reportPlayerStatus;

  useEffect(() => {
    if (!id) return undefined;
    let cancelled = false;
    let created = null;
    let player = null;
    setAdapter(null);
    setError(null);

    const onEvent = (ev) => {
      const h = handlers.current;
      if (ev.type === "play") h.onPlayState(true);
      else if (ev.type === "pause") h.onPlayState(false);
      else if (ev.type === "seek" && Number.isFinite(ev.time)) h.onSeek(ev.time);
      else if (ev.type === "rate") h.onRate(ev.rate);
      else if (ev.type === "buffering") h.onBuffering(ev.value);
      else if (ev.type === "error") {
        setError(describeVimeoError(ev.error));
        report.current?.("unsupported");
      }
    };

    import("@vimeo/player")
      .then(({ default: Vimeo }) => {
        if (cancelled || !holder.current) return null;
        // Unlisted videos need their privacy hash; the SDK takes it from the URL form.
        const opts = {
          ...(hash ? { url: `https://vimeo.com/${id}/${hash}` } : { id: Number(id) }),
          responsive: true,
          dnt: true, // no tracking cookies for the room's viewers
          title: false,
          byline: false,
          portrait: false,
        };
        player = new Vimeo(holder.current, opts);
        return player.ready();
      })
      .then(() => {
        if (cancelled || !player) return;
        created = createVimeoAdapter(player, onEvent);
        setAdapter(created);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(describeVimeoError(err));
        report.current?.("unsupported");
      });

    return () => {
      cancelled = true;
      setAdapter(null);
      if (created) created.destroy();
      else if (player) {
        try {
          player.destroy();
        } catch {
          /* ignore */
        }
      }
    };
  }, [id, hash]);

  return (
    <PlayerFrame
      providerLabel={providerLabel}
      playing={playing}
      buffering={sync.buffering}
      blocked={sync.blocked}
      onResume={sync.resume}
      error={error ? { title: "This video can't be played", message: error.message } : null}
      empty={
        id
          ? null
          : {
              title: "No video selected",
              description: "Paste a Vimeo link below to load a video for everyone in the room.",
            }
      }
    >
      <div
        ref={holder}
        className="h-full w-full [&_iframe]:h-full [&_iframe]:w-full"
        data-testid="vimeo-holder"
      />
    </PlayerFrame>
  );
}

export default VimeoPlayer;
