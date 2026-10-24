import { useEffect, useRef, useState } from "react";
import providerRegistry from "../../providers";
import { createTwitchAdapter, TWITCH_SDK_URL } from "./adapters/twitch";
import { loadScriptOnce } from "./adapters/sdkLoader";
import { useSyncedPlayer } from "./sync/useSyncedPlayer";
import { PlayerFrame } from "./PlayerFrame";
import { useRoom } from "../../context/RoomContext";

// Twitch seeks are coarse (keyframe-aligned), so use looser tolerances to avoid seek ping-pong.
const TOLERANCES = { seek: 2.5, drift: 1.2 };

// Twitch requires the embedding page's hostname as `parent`; without it the player refuses to load.
export function twitchParent(loc = typeof window !== "undefined" ? window.location : null) {
  return loc?.hostname || "localhost";
}

/**
 * Twitch through the official embed. VODs are fully synchronised (play/pause/seek, drift, late join).
 * CLIPS use Twitch's separate non-interactive embed that has no JS API, so they are shown but cannot
 * be remote-controlled: we say so on screen instead of pretending. Live streams are refused by the
 * server/UI before they get here.
 */
export function TwitchPlayer({ videoUrl, playing, providerLabel = "Twitch" }) {
  const media = providerRegistry.resolve(videoUrl, "twitch");
  const id = media?.mediaId || "";
  const isClip = media?.params?.kind === "clip";
  const holder = useRef(null);
  const [adapter, setAdapter] = useState(null);
  const [error, setError] = useState(null);
  const { reportPlayerStatus } = useRoom();

  const sync = useSyncedPlayer({ adapter, tolerances: TOLERANCES });
  const handlers = useRef(sync);
  handlers.current = sync;
  const report = useRef(reportPlayerStatus);
  report.current = reportPlayerStatus;

  useEffect(() => {
    if (!id || isClip) return undefined;
    let cancelled = false;
    let created = null;
    setAdapter(null);
    setError(null);

    const onEvent = (ev) => {
      const h = handlers.current;
      if (ev.type === "play") h.onPlayState(true);
      else if (ev.type === "pause") h.onPlayState(false);
      else if (ev.type === "seek" && Number.isFinite(ev.time)) h.onSeek(ev.time);
      else if (ev.type === "blocked") h.onBlocked();
      else if (ev.type === "error") {
        setError({
          message:
            "This Twitch video isn't available (it may have expired, been deleted, or be subscriber-only).",
        });
        report.current?.("unsupported");
      }
    };

    loadScriptOnce(TWITCH_SDK_URL, { globalName: "Twitch" })
      .then((Twitch) => {
        if (cancelled || !holder.current) return;
        const el = document.createElement("div");
        el.style.width = "100%";
        el.style.height = "100%";
        holder.current.replaceChildren(el);
        const player = new Twitch.Player(el, {
          video: `v${id}`,
          parent: [twitchParent()],
          autoplay: false,
          muted: false,
          width: "100%",
          height: "100%",
        });
        const READY = Twitch.Player.READY;
        const onReady = () => {
          if (cancelled) return;
          created = createTwitchAdapter(player, Twitch.Player, onEvent);
          setAdapter(created);
        };
        player.addEventListener(READY, onReady);
      })
      .catch((err) => {
        if (cancelled) return;
        setError({ message: err?.message || "Twitch's player couldn't be loaded." });
        report.current?.("unsupported");
      });

    return () => {
      cancelled = true;
      setAdapter(null);
      created?.destroy();
      holder.current?.replaceChildren();
    };
  }, [id, isClip]);

  const empty = id
    ? null
    : {
        title: "No video selected",
        description: "Paste a Twitch past broadcast or clip link below.",
      };

  if (isClip) {
    const src = `https://clips.twitch.tv/embed?clip=${encodeURIComponent(id)}&parent=${encodeURIComponent(twitchParent())}&autoplay=false`;
    return (
      <PlayerFrame
        providerLabel={providerLabel}
        playing={false}
        notice="Twitch clips can't be remote-controlled: each person presses play themselves, so playback is not synchronised."
      >
        <iframe
          title="Twitch clip"
          src={src}
          className="h-full w-full"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
        />
      </PlayerFrame>
    );
  }

  return (
    <PlayerFrame
      providerLabel={providerLabel}
      playing={playing}
      buffering={sync.buffering}
      blocked={sync.blocked}
      onResume={sync.resume}
      error={error ? { title: "This video can't be played", message: error.message } : null}
      empty={empty}
    >
      <div
        ref={holder}
        className="h-full w-full [&_iframe]:h-full [&_iframe]:w-full"
        data-testid="twitch-holder"
      />
    </PlayerFrame>
  );
}

export default TwitchPlayer;
