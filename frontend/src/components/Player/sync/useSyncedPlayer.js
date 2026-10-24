import { useCallback, useEffect, useRef, useState } from "react";
import { useRoom } from "../../../context/RoomContext";
import { chain, isAutoplayBlock } from "../adapters/contract";

// Provider-neutral synchronisation engine. It was extracted from the YouTube player (whose behaviour
// it preserves exactly) so Vimeo, Twitch and any future embedded provider share ONE implementation
// of: authoritative apply, drift correction, echo suppression, permission snap-back, host position
// reports, buffering and autoplay-block handling.
//
// The rules (all of them are pinned by tests):
//  - The SERVER is the only source of truth. Nothing here optimistically edits room playback; a
//    controller's click only emits an event, and the player changes when the server's sync_state
//    comes back (surfaced as `syncSeq` for discrete commands, `driftSeq` for periodic pings).
//  - On every discrete update we SEEK FIRST and only then play/pause, so a late joiner or a
//    reconnecting client lands on the right timestamp before it starts or stops.
//  - Drift correction (periodic) only seeks, and only beyond a small tolerance; it never toggles
//    play/pause, and it is skipped while the player is buffering (we must not fight a stall).
//  - Echo suppression is state-based, not time-window based: applying a command first brings the
//    player in line with the room, so any native event it triggers already matches room state.
//    Native SEEK events (providers that emit them) are matched against the seek we just issued.
//  - Someone without playback permission who uses the native controls is snapped back and emits
//    nothing; a host/moderator's native action emits the SAME event the on-screen controls use.
//  - A newer command cancels the unfinished tail of an older asynchronous apply (rapid commands).
//  - Adapters may be synchronous (YouTube) or promise-based (Vimeo); both work.

export const DEFAULT_TOLERANCES = Object.freeze({
  seek: 1.5, // discrete apply: re-seek only if further than this from the room position
  drift: 0.4, // periodic apply: re-seek only if further than this
  echoSeek: 1.5, // a native seek landing this close to the one we issued is OUR echo
  echoSeekWindowMs: 3000,
});
const TIME_SYNC_INTERVAL_MS = 3000; // host position report cadence (server drops anything faster)
const TICK_MS = 500;

export function useSyncedPlayer({ adapter, tolerances } = {}) {
  const {
    playback,
    syncSeq,
    driftSeq,
    role,
    settings,
    updatePlayback,
    play,
    pause,
    seek,
    setRate,
    syncTime,
    reportPlayerStatus,
  } = useRoom();
  const tol = { ...DEFAULT_TOLERANCES, ...tolerances };

  // Mirrors the server's rule: moderators only control playback while the host allows it.
  const canControl =
    role === "host" || (role === "moderator" && settings?.moderatorsCanControl !== false);
  const isHost = role === "host";

  const [buffering, setBuffering] = useState(false);
  const [blocked, setBlocked] = useState(false);

  // Always-fresh values for callbacks that must stay referentially stable.
  const latest = useRef({});
  latest.current = {
    playback,
    play,
    pause,
    seek,
    setRate,
    updatePlayback,
    canControl,
    isHost,
    syncTime,
    reportPlayerStatus,
    tol,
  };

  const adapterRef = useRef(null);
  adapterRef.current = adapter;
  const lastSyncSeq = useRef(syncSeq);
  const lastDriftSeq = useRef(driftSeq);
  const lastTimeSyncAt = useRef(0);
  const generation = useRef(0); // bumped by every apply; an older async apply sees it changed and stops
  const expectedSeek = useRef(null); // { time, at } of the seek WE issued
  const appliedRate = useRef(1);
  const bufferingRef = useRef(false);

  const markSeek = (time) => {
    expectedSeek.current = { time, at: Date.now() };
  };

  const onBlockedError = useCallback((err) => {
    if (!isAutoplayBlock(err)) return false;
    setBlocked(true);
    latest.current.reportPlayerStatus?.("blocked");
    return true;
  }, []);

  /** Bring `a` in line with an authoritative (time, playing[, rate]). Seek first, then play/pause. */
  const applyToPlayer = useCallback(
    (a, targetTime, shouldPlay, rate) => {
      const gen = ++generation.current;
      const stale = () => gen !== generation.current || adapterRef.current !== a;
      try {
        const target = targetTime || 0;
        const out = chain(a.getCurrentTime(), (cur) => {
          if (stale()) return undefined;
          let seeking;
          if (a.caps.seek && Math.abs((cur ?? 0) - target) > latest.current.tol.seek) {
            markSeek(target);
            seeking = a.seekTo(target);
          }
          return chain(seeking, () => {
            if (stale()) return undefined;
            if (a.caps.rate && typeof rate === "number" && rate !== appliedRate.current) {
              appliedRate.current = rate;
              try {
                a.setRate(rate);
              } catch {
                /* the owner/provider may refuse speed changes: playback still syncs */
              }
            }
            const started = shouldPlay ? a.play() : a.pause();
            if (started && typeof started.catch === "function") {
              return started
                .then(() => {
                  if (shouldPlay && !stale()) setBlocked(false);
                })
                .catch((err) => {
                  onBlockedError(err); // anything else (mid-teardown etc.) is safe to ignore
                });
            }
            return undefined;
          });
        });
        if (out && typeof out.catch === "function") out.catch((err) => onBlockedError(err));
      } catch (err) {
        onBlockedError(err); // sync adapters can throw NotAllowed too; other errors: player briefly unavailable
      }
    },
    [onBlockedError],
  );

  // First apply when the player becomes ready (also covers late join and reconnect: room_state bumps
  // syncSeq, and a freshly created player starts from the freshest known state).
  useEffect(() => {
    if (!adapter) return;
    lastSyncSeq.current = syncSeq;
    appliedRate.current = 1;
    const { playback: pb } = latest.current;
    try {
      if (adapter.caps.volume) adapter.setVolume(pb.volume);
      chain(adapter.getDuration(), (d) => {
        if (d) latest.current.updatePlayback({ duration: d });
      });
    } catch {
      /* ignore */
    }
    setBlocked(false); // a new player starts unblocked; the apply below may block it again
    applyToPlayer(adapter, pb.currentTime, pb.playing, pb.rate);
    latest.current.reportPlayerStatus?.("ready");
  }, [adapter]);

  // Discrete authoritative commands: play / pause / seek / set_rate / change_video / room_state.
  useEffect(() => {
    if (!adapter) return;
    if (syncSeq === lastSyncSeq.current) return;
    lastSyncSeq.current = syncSeq;
    applyToPlayer(adapter, playback.currentTime, playback.playing, playback.rate);
  }, [syncSeq, adapter, playback.currentTime, playback.playing, playback.rate, applyToPlayer]);

  // Periodic drift correction: only ever seeks, only beyond tolerance, never while buffering.
  useEffect(() => {
    if (!adapter) return;
    if (driftSeq === lastDriftSeq.current) return;
    lastDriftSeq.current = driftSeq;
    if (bufferingRef.current || !adapter.caps.seek) return;
    try {
      const target = playback.currentTime || 0;
      chain(adapter.getCurrentTime(), (cur) => {
        if (adapterRef.current !== adapter || bufferingRef.current) return;
        if (Math.abs((cur ?? 0) - target) > latest.current.tol.drift) {
          markSeek(target);
          adapter.seekTo(target);
        }
      });
    } catch {
      /* the next ping retries */
    }
  }, [driftSeq, adapter, playback.currentTime]);

  // The Controls volume slider drives the real player.
  useEffect(() => {
    if (!adapter || !adapter.caps.volume) return;
    try {
      adapter.setVolume(playback.volume);
    } catch {
      /* ignore */
    }
  }, [adapter, playback.volume]);

  // Local display bookkeeping (+ the host's periodic position report). Never touches syncSeq/driftSeq,
  // so it cannot loop back into a seek or a play/pause.
  useEffect(() => {
    if (!adapter) return undefined;
    const id = setInterval(() => {
      try {
        chain(adapter.getCurrentTime(), (t) => {
          chain(adapter.getDuration(), (d) => {
            if (adapterRef.current !== adapter) return;
            const L = latest.current;
            if (typeof t === "number") L.updatePlayback({ currentTime: t });
            if (typeof d === "number" && d > 0) L.updatePlayback({ duration: d });
            if (
              L.isHost &&
              L.playback.playing &&
              !bufferingRef.current &&
              typeof t === "number" &&
              Date.now() - lastTimeSyncAt.current >= TIME_SYNC_INTERVAL_MS
            ) {
              lastTimeSyncAt.current = Date.now();
              L.syncTime(t);
            }
          });
        });
      } catch {
        /* ignore */
      }
    }, TICK_MS);
    return () => clearInterval(id);
  }, [adapter]);

  // Releasing the adapter (video change / unmount) cancels anything still in flight.
  useEffect(() => {
    return () => {
      generation.current += 1;
    };
  }, [adapter]);

  // ---- native events (normalised by the provider component) -----------------------------------------
  const snapBack = () => {
    const a = adapterRef.current;
    const { playback: pb } = latest.current;
    if (a) applyToPlayer(a, pb.currentTime, pb.playing, pb.rate);
  };

  /** The user (or the SDK) changed play/pause on the native player. */
  const onPlayState = useCallback((isPlaying) => {
    const L = latest.current;
    if (L.playback.playing === isPlaying) return; // echo of our own apply (or a no-op)
    if (!L.canControl) {
      snapBack(); // not allowed: restore the room's state and emit nothing
      return;
    }
    if (isPlaying) L.play();
    else L.pause(); // server broadcast is what changes visible state
  }, []);

  /** The native player reports a seek to `time` (providers that emit seek events). */
  const onSeek = useCallback((time) => {
    const L = latest.current;
    const exp = expectedSeek.current;
    if (
      exp &&
      Date.now() - exp.at < L.tol.echoSeekWindowMs &&
      Math.abs(exp.time - time) <= L.tol.echoSeek
    ) {
      expectedSeek.current = null; // our own seek coming back
      return;
    }
    if (Math.abs((L.playback.currentTime || 0) - time) <= L.tol.seek) return; // already there
    if (!L.canControl) {
      snapBack();
      return;
    }
    L.seek?.(time);
  }, []);

  /** The native player's playback rate changed (providers that emit it). */
  const onRate = useCallback((rate) => {
    const L = latest.current;
    if (typeof rate !== "number" || rate === appliedRate.current) return;
    if (rate === L.playback.rate) {
      appliedRate.current = rate;
      return;
    }
    if (!L.canControl) {
      const a = adapterRef.current;
      try {
        a?.setRate?.(L.playback.rate);
      } catch {
        /* ignore */
      }
      return;
    }
    appliedRate.current = rate;
    L.setRate?.(rate);
  }, []);

  /** The browser refused to start playback without a user gesture (autoplay policy). */
  const onBlocked = useCallback(() => {
    setBlocked(true);
    latest.current.reportPlayerStatus?.("blocked");
  }, []);

  const onBuffering = useCallback((isBuffering) => {
    bufferingRef.current = !!isBuffering;
    setBuffering(!!isBuffering);
  }, []);

  /** The viewer clicked "join playback" (a user gesture): retry the room's state. */
  const resume = useCallback(() => {
    setBlocked(false);
    snapBack();
  }, []);

  return {
    ready: Boolean(adapter),
    buffering,
    blocked,
    canControl,
    onPlayState,
    onSeek,
    onRate,
    onBuffering,
    onBlocked,
    resume,
  };
}

export default useSyncedPlayer;
