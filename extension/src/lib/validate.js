// Strict validators for every message that crosses a trust boundary inside the extension, and for the
// server events it consumes. Unknown fields are dropped; anything malformed yields null.
const isNum = (n) => typeof n === "number" && Number.isFinite(n);
const isId = (s) => typeof s === "string" && /^[0-9]{5,12}$/.test(s);
const STATUSES = new Set(["ok", "no-player", "buffering", "ad", "blocked", "error", "limited"]);
const ACTIONS = new Set(["play", "pause", "seek"]);
const PAGES = new Set(["watch", "title-page", "browse", "not-netflix"]);

/** content script -> service worker. */
export function parseReport(m) {
  if (!m || typeof m !== "object" || m.kind !== "report") return null;
  if (m.titleId !== null && !isId(m.titleId)) return null;
  if (typeof m.adapter !== "string" || m.adapter.length > 40) return null;
  if (!STATUSES.has(m.status)) return null;
  let state = null;
  if (m.state != null) {
    const s = m.state;
    if (typeof s.playing !== "boolean" || !isNum(s.position) || s.position < 0 || s.position > 360_000) return null;
    state = { playing: s.playing, position: s.position, duration: isNum(s.duration) ? s.duration : null, rate: isNum(s.rate) && s.rate > 0 && s.rate <= 16 ? s.rate : 1 };
  }
  if (m.userAction != null && !ACTIONS.has(m.userAction)) return null;
  const caps = m.caps && typeof m.caps === "object" ? { play: !!m.caps.play, pause: !!m.caps.pause, seek: !!m.caps.seek, rate: !!m.caps.rate } : { play: false, pause: false, seek: false, rate: false };
  return { titleId: m.titleId, adapter: m.adapter, status: m.status, state, userAction: m.userAction || null, caps, limited: typeof m.limited === "string" ? m.limited.slice(0, 20) : null, page: PAGES.has(m.page) ? m.page : null };
}

/** server sync_state -> normalised canonical state, or null. */
export function parseSyncState(s) {
  if (!s || typeof s !== "object") return null;
  if (typeof s.provider !== "string" || !(s.videoId === null || typeof s.videoId === "string")) return null;
  if (typeof s.playing !== "boolean" || !isNum(s.currentTime) || !isNum(s.seq)) return null;
  return { provider: s.provider, mediaId: s.videoId, playing: s.playing, time: s.currentTime, rate: isNum(s.rate) && s.rate > 0 ? s.rate : 1, seq: s.seq };
}

/** service worker -> content script. */
export function parseTarget(m) {
  if (!m || typeof m !== "object" || m.kind !== "target") return null;
  const t = m.target;
  if (!t) return { kind: "target", target: null, canControl: !!m.canControl, force: false, note: typeof m.note === "string" ? m.note.slice(0, 160) : null };
  if (!isId(t.mediaId) || typeof t.playing !== "boolean" || !isNum(t.time) || t.time < 0 || t.time > 360_000 || !isNum(t.seq)) return null;
  return {
    kind: "target",
    target: { mediaId: t.mediaId, playing: t.playing, time: t.time, rate: isNum(t.rate) && t.rate >= 0.25 && t.rate <= 2 ? t.rate : 1, seq: t.seq },
    canControl: !!m.canControl, force: !!m.force, note: typeof m.note === "string" ? m.note.slice(0, 160) : null,
  };
}

/** Validates the server the user typed. https only, except loopback for development. Returns an origin or null. */
export function parseServerOrigin(input) {
  let u;
  try { u = new URL(String(input).trim()); } catch { return null; }
  const loopback = u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "[::1]";
  if (u.protocol !== "https:" && !(u.protocol === "http:" && loopback)) return null;
  if (u.username || u.password) return null;
  return u.origin;
}
