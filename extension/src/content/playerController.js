import { ExpectationFilter, classifyChange, decideReconcile, projectPosition, toleranceFor } from "../lib/syncCore.js";

/**
 * The per-tab synchronisation brain. It owns NO globals: the adapter, clock and report channel are
 * injected, so the whole race/echo/drift behaviour is unit-tested with a fake player and a fake clock.
 *
 *  - applies the room's canonical target (play/pause/seek/rate) through the adapter, once per new `seq`;
 *  - followers also run a gentle drift check; controllers do NOT (their position feeds the room);
 *  - detects USER actions (native events or polling) and reports them, swallowing our own echoes;
 *  - never touches a player whose title is not the room's title.
 */
export function createPlayerController({ getAdapter, getTitleId, report, now = () => Date.now(), diag = { log() {} } }) {
  const filter = new ExpectationFilter();
  let target = null; // { mediaId, playing, time, rate, seq, recvAt }
  let canControl = false;
  let appliedSeq = null;
  let lastSeekAt = -Infinity;
  let prev = null;
  let prevAt = 0;
  let status = "no-player";
  let limited = null;
  let stalledSince = null;
  let busy = false;

  const adapterId = () => getAdapter()?.id || "none";

  function currentTitleMatches() { return !!target && getTitleId() === target.mediaId; }

  function send(cur, userAction = null) {
    const a = getAdapter();
    // Limited mode is a property of the adapter (no seek => no drift correction), so tell the user even when
    // no seek happens to be needed right now; `limited` from reconcile only names a capability that was needed.
    const lim = limited || (a && a.caps && !a.caps.seek ? "seek" : null);
    report({
      titleId: getTitleId(), adapter: adapterId(), status,
      state: cur ? { playing: cur.playing, position: cur.position, duration: cur.duration ?? null, rate: cur.rate || 1 } : null,
      userAction, caps: a?.caps || { play: false, pause: false, seek: false, rate: false }, limited: lim, sentAt: now(),
    });
  }

  async function apply(force) {
    const a = getAdapter();
    if (!a || !target || !currentTitleMatches()) return;
    const cur = await a.read();
    if (!cur) return;
    const t = now();
    const projected = { playing: target.playing, position: projectPosition({ playing: target.playing, time: target.time, rate: target.rate }, target.recvAt, t), rate: target.rate };
    const { actions, limited: lim } = decideReconcile({
      target: projected, actual: cur, caps: a.caps, adapterId: a.id, now: t, lastSeekAt, force, buffering: status === "buffering" || status === "ad",
    });
    limited = lim;
    for (const act of actions) {
      try {
        if (act.type === "seek") { filter.expect("seek", now(), act.time); await a.seek(act.time); lastSeekAt = now(); diag.log("apply-seek", { to: Math.round(act.time) }); }
        else if (act.type === "play") { filter.expect("play", now()); await a.play(); diag.log("apply-play"); }
        else if (act.type === "pause") { filter.expect("pause", now()); await a.pause(); diag.log("apply-pause"); }
        else if (act.type === "rate") { await a.setRate?.(act.rate); diag.log("apply-rate", { rate: act.rate }); }
        if (status === "blocked") status = "ok";
      } catch (e) {
        filter.clear();
        const name = (e && (e.name || e.message)) || "error";
        status = /NotAllowed/i.test(name) ? "blocked" : "error";
        diag.log("apply-failed", { type: act.type, error: String(name).slice(0, 60) });
        break;
      }
    }
    prev = (await a.read()) || cur;
    prevAt = now();
  }

  function handleUserAction(type, cur) {
    if (filter.consume(type, cur, now())) return; // echo of our own command
    send(cur, type);
    diag.log("user-" + type);
  }

  return {
    get status() { return status; },
    get target() { return target; },
    get limited() { return limited; },

    /** Called when the page changes (SPA navigation / new title): forget everything about the old player. */
    reset() { filter.clear(); prev = null; prevAt = 0; appliedSeq = null; lastSeekAt = -Infinity; status = "no-player"; limited = null; stalledSince = null; },

    async setTarget(msg) {
      canControl = !!msg.canControl;
      if (!msg.target) { target = null; return; }
      let force = !!msg.force || !target || target.seq !== msg.target.seq || target.mediaId !== msg.target.mediaId;
      target = { ...msg.target, recvAt: now() };
      if (busy) return; // the running loop below re-reads `target`, so a newer command is never lost
      busy = true;
      try {
        // Apply until the latest target has been applied (commands that arrive mid-apply collapse to the newest).
        while (target && (force || appliedSeq !== target.seq)) {
          const seq = target.seq;
          await apply(force);
          appliedSeq = seq;
          force = false;
        }
      } finally { busy = false; }
    },

    /** Native media event from an adapter that has them. */
    async onNative(evt) {
      const a = getAdapter();
      if (!a) return;
      const cur = await a.read();
      if (!cur) return;
      if (evt === "waiting") { status = "buffering"; stalledSince = stalledSince ?? now(); return; }
      if (evt === "playing" && status === "buffering") { status = "ok"; stalledSince = null; }
      const type = evt === "seeked" ? "seek" : evt === "play" || evt === "playing" ? "play" : evt === "pause" ? "pause" : null;
      if (type && !(type === "play" && evt === "playing")) handleUserAction(type, cur);
    },

    /** One poll (~1 Hz): heartbeat, user-action detection (polled adapters), drift check (followers). */
    async tick() {
      const a = getAdapter();
      const t = now();
      if (!a) { status = "no-player"; send(null); return; }
      const cur = await a.read();
      if (!cur) { status = "no-player"; send(null); return; }
      if (status === "no-player") status = "ok";
      const wasAd = status === "ad";
      const isAd = !!a.isAd?.();
      if (isAd) status = "ad";
      else if (wasAd) status = "ok";

      // The ad timeline is unrelated to the title's: positions during an ad (and the jump back when it
      // ends) must never be classified as a user seek/pause.
      if (!a.onNativeEvents && prev && !isAd && !wasAd) {
        const { actions, stalled } = classifyChange(prev, cur, t - prevAt, toleranceFor(a.id).jump);
        if (stalled) { status = status === "ad" ? "ad" : "buffering"; stalledSince = stalledSince ?? t; }
        else if (status === "buffering") { status = "ok"; stalledSince = null; }
        for (const act of actions) handleUserAction(act, cur);
      }
      prev = cur; prevAt = t;

      // Gentle drift correction: followers only, only on the room's title, never while buffering or after a recent seek.
      if (!canControl && target && currentTitleMatches() && status !== "buffering" && status !== "ad") await apply(false);
      send(cur);
    },
  };
}
