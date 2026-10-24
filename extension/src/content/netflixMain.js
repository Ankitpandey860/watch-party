// MAIN-world half of the Netflix adapter. It is the ONLY code that touches Netflix's internal player
// object and it exposes a deliberately tiny, allow-listed surface (probe/read/play/pause/seek/rate).
// It never reads media data, network traffic, cookies or tokens.
//
// COMPATIBILITY RISK: `netflix.appContext.state.playerApp.getAPI().videoPlayer` is an UNDOCUMENTED,
// internal interface. Netflix can rename or remove it at any time. Everything here fails closed
// (returns null / "unavailable") and the content script falls back to the limited DOM adapter.

const OPTIONAL = ["getDuration", "getPlaybackRate", "setPlaybackRate", "getMovieId", "getBusy", "isPlaying"];

/** Finds the active player object, or null. Never throws. */
export function findPlayer(g) {
  try {
    const vp = g.netflix.appContext.state.playerApp.getAPI().videoPlayer;
    const ids = vp.getAllPlayerSessionIds();
    if (!ids || !ids.length) return null;
    // Newest session last: a replaced player (episode change) leaves older sessions behind briefly.
    return vp.getVideoPlayerBySessionId(ids[ids.length - 1]) || null;
  } catch { return null; }
}

/** The allow-listed operations. `value` is validated here too (defence in depth). */
export function handleOp(g, op, value) {
  const p = findPlayer(g);
  if (op === "probe") {
    if (!p) return { available: false, methods: [] };
    const required = ["play", "pause", "seek", "getCurrentTime", "isPaused"].filter((m) => typeof p[m] === "function");
    const optional = OPTIONAL.filter((m) => typeof p[m] === "function");
    return { available: required.length === 5, methods: [...required, ...optional] };
  }
  if (!p) return null;
  switch (op) {
    case "read": {
      const rate = typeof p.getPlaybackRate === "function" ? Number(p.getPlaybackRate()) : 1;
      return {
        playing: !p.isPaused(),
        position: Number(p.getCurrentTime()) / 1000, // Netflix reports milliseconds
        duration: typeof p.getDuration === "function" ? Number(p.getDuration()) / 1000 : null,
        rate: Number.isFinite(rate) && rate > 0 ? rate : 1,
        busy: typeof p.getBusy === "function" ? !!p.getBusy() : null,
      };
    }
    case "play": return void p.play();
    case "pause": return void p.pause();
    case "seek": {
      if (!Number.isFinite(value) || value < 0 || value > 360_000) throw new Error("bad-seek");
      return void p.seek(Math.round(value * 1000)); // the player API, NOT video.currentTime
    }
    case "rate": {
      if (!Number.isFinite(value) || value < 0.25 || value > 2 || typeof p.setPlaybackRate !== "function") throw new Error("bad-rate");
      return void p.setPlaybackRate(value);
    }
    default: throw new Error("unknown-op");
  }
}

/** Private handshake: only a hello carrying a nonce gets a MessageChannel port; all traffic then flows over it. */
const MAX_CHANNELS = 4; // a legitimate page needs one; stale/abusive handshakes cannot accumulate

export function installBridge(win, g = win) {
  const channels = [];
  const onMessage = (ev) => {
    if (ev.source !== win || ev.origin !== win.location.origin) return;
    const d = ev.data;
    if (!d || d.source !== "wp-netflix-hello" || typeof d.nonce !== "string" || d.nonce.length < 8 || d.nonce.length > 64) return;
    const ch = new win.MessageChannel();
    channels.push(ch);
    while (channels.length > MAX_CHANNELS) { const old = channels.shift(); try { old.port1.close(); } catch { /* already closed */ } }
    ch.port1.onmessage = (m) => {
      const { id, op, value } = m.data || {};
      if (op === "close") { // the isolated side is done: release this end instead of leaking it
        try { ch.port1.close(); } catch { /* already closed */ }
        const i = channels.indexOf(ch); if (i >= 0) channels.splice(i, 1);
        return;
      }
      try { ch.port1.postMessage({ id, ok: true, data: handleOp(g, op, value) }); }
      catch (e) { ch.port1.postMessage({ id, ok: false, error: String((e && e.message) || e).slice(0, 80) }); }
    };
    win.postMessage({ source: "wp-netflix-port", nonce: d.nonce }, win.location.origin, [ch.port2]);
  };
  win.addEventListener("message", onMessage);
  return () => { win.removeEventListener("message", onMessage); for (const ch of channels.splice(0)) { try { ch.port1.close(); } catch { /* already closed */ } } };
}

if (typeof window !== "undefined" && !window.__wpNetflixMain) {
  window.__wpNetflixMain = true;
  installBridge(window);
}
