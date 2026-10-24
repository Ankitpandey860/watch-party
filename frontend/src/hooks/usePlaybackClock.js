import { useEffect, useRef, useState } from "react";

/**
 * The room's playback position, advancing locally while the room is playing. Used for providers
 * with no embedded player on our page (Netflix companion): there is nothing to read a position from,
 * so we project from the server's last known (position, playing, rate) like the server itself does.
 * Re-anchors on every new authoritative value; display-only (never sent anywhere).
 */
export function usePlaybackClock({ currentTime, playing, rate = 1 }, { tickMs = 500 } = {}) {
  const anchor = useRef({ time: currentTime, at: Date.now() });
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    anchor.current = { time: currentTime, at: Date.now() };
    setNow(Date.now());
  }, [currentTime, playing, rate]);

  useEffect(() => {
    if (!playing) return undefined;
    const id = setInterval(() => setNow(Date.now()), tickMs);
    return () => clearInterval(id);
  }, [playing, tickMs]);

  if (!playing) return currentTime;
  const elapsed = Math.max(0, now - anchor.current.at) / 1000;
  return anchor.current.time + elapsed * (rate || 1);
}

export default usePlaybackClock;
