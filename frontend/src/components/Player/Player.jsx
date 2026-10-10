import { useCallback, useEffect, useRef, useState } from "react";
import YouTube from "react-youtube";
import { Play as PlayIcon } from "lucide-react";
import { Badge } from "../Badge";
import { EmptyState } from "../EmptyState";
import { extractYouTubeId } from "../../utils/youtube";
import { useRoom } from "../../context/RoomContext";

// How far the real player's clock is allowed to drift from the room's
// authoritative currentTime before we force a seek when applying a discrete
// sync_state (play/pause/seek/change_video/room_state). Small drift is
// normal (network latency, decode time) and re-seeking for it just causes
// stutter.
const SEEK_DRIFT_TOLERANCE_SECONDS = 1.5;

// How often the host's client pings the server with its current position
// while playing, so the server's clock — and therefore late joiners and
// everyone's drift correction — stays accurate between discrete commands.
const TIME_SYNC_INTERVAL_MS = 3000;

// Drift tolerance for *periodic* corrections only (as opposed to the looser
// SEEK_DRIFT_TOLERANCE_SECONDS used when applying a discrete play/pause/seek
// command). Kept small so periodic pings can't cause a visible seek for
// perfectly normal jitter.
const DRIFT_CORRECTION_TOLERANCE_SECONDS = 0.4;

// YT.PlayerState values we care about (see IFrame API docs). Buffering/cued/
// unstarted/ended are ignored — only actual play/pause toggles matter here.
const YT_STATE = { PLAYING: 1, PAUSED: 2 };

// Real YouTube IFrame Player, driven entirely by the server:
//
//  - The server is the *only* source of truth for playback. This component
//    never optimistically updates `playback` in RoomContext for a play/pause/
//    seek action — not even for the host. Every control (Controls' buttons,
//    or clicking directly on the embedded video) only emits a socket event.
//    The server validates it, updates its own state, and broadcasts
//    `sync_state` to everyone (including the sender). Only that broadcast —
//    surfaced here as `syncSeq` (discrete commands) or `driftSeq` (periodic
//    pings) — ever causes this component to call seekTo()/playVideo()/
//    pauseVideo(). This is what makes playback deterministic: every client,
//    including the host's own screen, ends up in the state the server says,
//    never a locally-guessed one.
//  - On any discrete authoritative update (`syncSeq` change — this also
//    covers the very first sync after a reconnect, since `room_state` bumps
//    the same counter), we seek first and only then set play/pause, so a
//    client that reconnects after falling behind lands on the right
//    timestamp before it starts/stops playing.
//  - The player's own progress/duration are reported back into context so
//    Controls' slider reflects real playback. This is local display-only
//    bookkeeping — it never touches `syncSeq`/`driftSeq`, so it can't loop
//    back into a seek or a play/pause call.
//  - Clicking directly on the embedded video (YouTube still allows toggling
//    play/pause by clicking the video canvas even with controls hidden) is
//    caught via onStateChange. If the click came from someone without
//    playback permission, we snap the real player back to the authoritative
//    state (the iframe already toggled itself locally — that's inherent to
//    clicking inside the YouTube canvas and can't be prevented — but our app
//    must not treat it as a command). If it came from the host/moderator, we
//    only emit the same play/pause socket event Controls uses; we do not
//    touch RoomContext locally, so the visible state only changes once
//    sync_state comes back — exactly like every other client.
//  - Because every `applyToPlayer` call brings the real player in line with
//    `playback.playing`/`playback.currentTime` *before* it runs, any
//    onStateChange event it triggers (buffering blips, echoed play/pause
//    from the IFrame) will already match the current authoritative state by
//    the time it fires — so a simple equality check is enough to recognize
//    and ignore these echoes. No time-based suppression window is needed.
// Native YouTube controls are disabled (`controls: 0`) so scrubbing/volume/
// fullscreen etc. still only happen through our own Controls component.
export function Player({ videoUrl, playing, providerLabel = "YouTube" }) {
  const { playback, syncSeq, driftSeq, role, updatePlayback, play, pause, syncTime } = useRoom();
  const videoId = extractYouTubeId(videoUrl);
  const canControl = role === "host" || role === "moderator";
  const isHost = role === "host";

  const playerInstanceRef = useRef(null);
  const lastAppliedSyncSeqRef = useRef(syncSeq);
  const lastAppliedDriftSeqRef = useRef(driftSeq);
  const tickIntervalRef = useRef(null);
  const lastTimeSyncAtRef = useRef(0);
  const [ready, setReady] = useState(false);
  const [embedError, setEmbedError] = useState(false);

  // Always-fresh snapshot for callbacks that must stay referentially stable
  // (no need to re-subscribe them on the player every render).
  const latestRef = useRef({ playback, syncSeq, play, pause, updatePlayback, canControl, isHost });
  latestRef.current = { playback, syncSeq, play, pause, updatePlayback, canControl, isHost };

  // Reset readiness/error state whenever the video itself changes.
  useEffect(() => {
    setReady(false);
    setEmbedError(false);
    playerInstanceRef.current = null;
  }, [videoId]);

  // Brings the real player in line with an authoritative (playing, targetTime)
  // pair from the server. Seek is always issued before play/pause: the
  // IFrame API processes the commands we post to it in order, so the player
  // lands on the right timestamp before (or as) it starts/stops — this is
  // what makes a reconnect (which can be seconds or minutes behind) land
  // correctly instead of playing briefly from the wrong spot.
  const applyToPlayer = useCallback((player, targetTime, shouldPlay) => {
    try {
      const target = targetTime || 0;
      const current = player.getCurrentTime?.() ?? 0;
      if (Math.abs(current - target) > SEEK_DRIFT_TOLERANCE_SECONDS) {
        player.seekTo(target, true);
      }
      if (shouldPlay) {
        player.playVideo();
      } else {
        player.pauseVideo();
      }
    } catch {
      // Player briefly unavailable (mid-navigation/teardown) — safe to ignore.
    }
  }, []);

  // Apply authoritative play/pause/seek/change_video/room_state commands
  // from the server to the real player. This is the only path (besides the
  // drift-only correction below) that ever calls seekTo()/playVideo()/
  // pauseVideo() — sync_state is the only thing that changes playback.
  useEffect(() => {
    if (!ready || !playerInstanceRef.current) return;
    if (syncSeq === lastAppliedSyncSeqRef.current) return;
    lastAppliedSyncSeqRef.current = syncSeq;
    applyToPlayer(playerInstanceRef.current, playback.currentTime, playback.playing);
  }, [syncSeq, ready, playback.currentTime, playback.playing, applyToPlayer]);

  // Soft drift correction from periodic time_sync pings. Unlike the effect
  // above, this never calls playVideo()/pauseVideo() — the playing state
  // hasn't changed, only the clock has — so it only seeks when drift is
  // actually noticeable.
  useEffect(() => {
    if (!ready || !playerInstanceRef.current) return;
    if (driftSeq === lastAppliedDriftSeqRef.current) return;
    lastAppliedDriftSeqRef.current = driftSeq;

    const player = playerInstanceRef.current;
    try {
      const current = player.getCurrentTime?.() ?? 0;
      const drift = Math.abs(current - (playback.currentTime || 0));
      if (drift > DRIFT_CORRECTION_TOLERANCE_SECONDS) {
        player.seekTo(playback.currentTime || 0, true);
      }
    } catch {
      // Player briefly unavailable — safe to ignore, the next ping will retry.
    }
  }, [driftSeq, ready, playback.currentTime]);

  // Keep the real player's volume in sync with the Controls volume slider.
  useEffect(() => {
    if (!ready || !playerInstanceRef.current) return;
    try {
      playerInstanceRef.current.setVolume(playback.volume);
      if (playback.volume === 0) playerInstanceRef.current.mute();
      else playerInstanceRef.current.unMute();
    } catch {
      // ignore
    }
  }, [ready, playback.volume]);

  // Report real progress + duration back into context for the Controls
  // slider. Local display-only bookkeeping: intentionally does not bump
  // syncSeq/driftSeq, so it can never itself trigger a seek or play/pause.
  useEffect(() => {
    if (!ready) return;
    tickIntervalRef.current = setInterval(() => {
      const player = playerInstanceRef.current;
      if (!player) return;
      try {
        const t = player.getCurrentTime?.();
        const d = player.getDuration?.();
        if (typeof t === "number") updatePlayback({ currentTime: t });
        if (typeof d === "number" && d > 0) updatePlayback({ duration: d });

        // Continuous synchronization: the host periodically reports its
        // position so the server's stored currentTime — and therefore late
        // joiners and everyone's drift correction — stays accurate between
        // discrete play/pause/seek commands. Only the host pings, and only
        // while playing, to keep traffic minimal and keep a single source of
        // truth.
        const { playback: currentPlayback, isHost: currentIsHost } = latestRef.current;
        if (
          currentIsHost &&
          currentPlayback.playing &&
          typeof t === "number" &&
          Date.now() - lastTimeSyncAtRef.current >= TIME_SYNC_INTERVAL_MS
        ) {
          lastTimeSyncAtRef.current = Date.now();
          syncTime(t);
        }
      } catch {
        // ignore
      }
    }, 500);
    return () => clearInterval(tickIntervalRef.current);
  }, [ready, updatePlayback, syncTime]);

  // Fires for every play/pause/buffer/etc. transition, whether it came from
  // our own applyToPlayer() calls (an authoritative sync being applied) or
  // the user clicking directly on the embedded video.
  const handleStateChange = useCallback(
    (event) => {
      const state = event.data;
      if (state !== YT_STATE.PLAYING && state !== YT_STATE.PAUSED) return;

      const {
        playback: currentPlayback,
        play: doPlay,
        pause: doPause,
        canControl: currentCanControl,
      } = latestRef.current;
      const isPlaying = state === YT_STATE.PLAYING;

      // Already matches what the server last told us. This covers every echo
      // of our own applyToPlayer() calls (buffering blips from a seek, a
      // playVideo()/pauseVideo() call that just confirms the state we already
      // have) without needing a time-based suppression window: applyToPlayer
      // always brings the player in line with `currentPlayback` first, so any
      // event it causes will match `currentPlayback` by the time it fires.
      if (currentPlayback.playing === isPlaying) return;

      const player = playerInstanceRef.current;

      if (!currentCanControl) {
        // A participant without playback permission clicked the embedded
        // video. The iframe already toggled its own state locally (inherent
        // to clicking inside the YouTube canvas, can't be prevented), but our
        // app must not treat it as a command: don't touch RoomContext, don't
        // emit play/pause — just snap the real player back to the last
        // authoritative state.
        if (player) applyToPlayer(player, currentPlayback.currentTime, currentPlayback.playing);
        return;
      }

      // A host/moderator toggled the video directly. Only emit the socket
      // event, the same one Controls' Play/Pause button uses — never update
      // RoomContext here. The server remains the only source of truth: it
      // will broadcast sync_state back to everyone, including us, and that
      // broadcast (via the syncSeq effect above) is what will actually change
      // what's visible.
      if (isPlaying) doPlay();
      else doPause();
    },
    [applyToPlayer],
  );

  const handleReady = useCallback(
    (event) => {
      const player = event.target;
      playerInstanceRef.current = player;

      // Use the freshest known playback/syncSeq (not values captured when
      // this callback was created) so a sync_state that arrived while the
      // video was still loading isn't lost or double-applied.
      const { playback: currentPlayback, syncSeq: currentSyncSeq } = latestRef.current;
      lastAppliedSyncSeqRef.current = currentSyncSeq;

      try {
        player.setVolume(currentPlayback.volume);
        const d = player.getDuration?.();
        if (d) updatePlayback({ duration: d });
      } catch {
        // ignore
      }
      applyToPlayer(player, currentPlayback.currentTime, currentPlayback.playing);
      setReady(true);
    },
    [applyToPlayer, updatePlayback],
  );

  const handleError = useCallback(() => {
    // YT error codes 2/5/100/101/150 all mean "can't be embedded/played here".
    setEmbedError(true);
  }, []);

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
