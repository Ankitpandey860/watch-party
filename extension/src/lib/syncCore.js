// Pure synchronisation maths and the echo filter. No DOM, no chrome.*, no timers of its own:
// everything takes the current time as an argument so it is deterministic under test.

/** Per-adapter tolerances (seconds). Every correction on a DRM player is a re-buffer, so be generous. */
export const TOLERANCE = Object.freeze({
  "netflix-cadmium": { seek: 2.5, pausedSeek: 0.75, cooldownMs: 6000, jump: 1.5 },
  // Seeking is unsupported here (caps.seek=false), but the thresholds stay finite so a position mismatch is
  // still DETECTED and surfaced to the user as "limited" rather than silently ignored.
  "netflix-dom": { seek: 2.5, pausedSeek: 0.75, cooldownMs: 6000, jump: 1.5 },
  default: { seek: 2.0, pausedSeek: 0.75, cooldownMs: 4000, jump: 1.5 },
});
export const toleranceFor = (adapterId) => TOLERANCE[adapterId] || TOLERANCE.default;

/** Where a follower should be NOW given an authoritative state received at `recvAt` (ms, local clock). */
export function projectPosition(state, recvAt, now) {
  const dt = Math.max(0, (now - recvAt) / 1000);
  const rate = Number.isFinite(state.rate) && state.rate > 0 ? state.rate : 1;
  return state.playing ? state.time + dt * rate : state.time;
}

/**
 * What must be done to make `actual` match `target`. Returns { actions, limited }.
 *  - `caps` says what the adapter can do; anything needed but missing sets `limited` (shown to the user)
 *    instead of being faked.
 *  - a drift correction (not `force`) is skipped inside `cooldownMs` of the previous seek, so two
 *    sources of correction can never fight each other.
 */
export function decideReconcile({ target, actual, caps, adapterId, now, lastSeekAt = -Infinity, force = false, buffering = false }) {
  const actions = [];
  let limited = null;
  if (!actual || !target) return { actions, limited };
  const tol = toleranceFor(adapterId);

  const diff = Math.abs(actual.position - target.position);
  const threshold = target.playing ? tol.seek : tol.pausedSeek;
  const wantSeek = force ? diff > 0.25 : diff > threshold;
  if (wantSeek) {
    if (!caps.seek) limited = "seek";
    else if (force || (now - lastSeekAt >= tol.cooldownMs && !buffering)) actions.push({ type: "seek", time: target.position });
  }
  if (target.playing !== actual.playing) {
    if (target.playing && !caps.play) limited = limited || "play";
    else if (!target.playing && !caps.pause) limited = limited || "pause";
    else actions.push({ type: target.playing ? "play" : "pause" });
  }
  if (caps.rate && Number.isFinite(target.rate) && Math.abs((actual.rate || 1) - target.rate) > 0.01) {
    actions.push({ type: "rate", rate: target.rate });
  } else if (!caps.rate && Number.isFinite(target.rate) && Math.abs(target.rate - 1) > 0.01) {
    limited = limited || "rate";
  }
  return { actions, limited };
}

/**
 * Players without reliable DOM events (Netflix's own player API) are polled. This infers what the USER
 * did between two polls. A stall (buffering) is neither a pause nor a seek.
 */
export function classifyChange(prev, cur, dtMs, jump = 1.5) {
  if (!prev || !cur) return { actions: [], stalled: false };
  const actions = [];
  if (prev.playing !== cur.playing) actions.push(cur.playing ? "play" : "pause");
  const dt = dtMs / 1000;
  const expected = prev.position + (prev.playing ? dt * (prev.rate || 1) : 0);
  const delta = cur.position - expected;
  // Playing but advancing far less than real time = buffering. It only counts as a stall if it did not move backwards.
  const stalled = prev.playing && cur.playing && dt >= 0.8 && cur.position >= prev.position - 0.05 && cur.position - prev.position < dt * 0.2;
  if (!stalled && Math.abs(delta) > jump) actions.push("seek");
  return { actions, stalled };
}

/**
 * Echo suppression. After WE apply a remote command we expect exactly one resulting change. A change that
 * matches an outstanding expectation is swallowed; anything else is a genuine user action. Expectations
 * are typed and expire, so a real action right after a remote command is never mistaken for an echo.
 */
export class ExpectationFilter {
  constructor({ ttlMs = 4000, seekEpsilon = 1.5 } = {}) { this.ttlMs = ttlMs; this.seekEpsilon = seekEpsilon; this.list = []; }
  expect(type, now, position = null) { this.list.push({ type, position, until: now + this.ttlMs }); }
  /** true => this change was caused by us (swallow it). */
  consume(type, cur, now) {
    this.list = this.list.filter((e) => e.until > now);
    const i = this.list.findIndex((e) => e.type === type && (type !== "seek" || e.position === null || Math.abs((cur?.position ?? 0) - e.position) <= this.seekEpsilon));
    if (i < 0) return false;
    this.list.splice(i, 1);
    return true;
  }
  clear() { this.list = []; }
  get pending() { return this.list.length; }
}
