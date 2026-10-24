import { parseReport, parseSyncState, parseServerOrigin } from "../lib/validate.js";
import { pickTargetTab } from "../lib/tabPicker.js";
import { projectPosition } from "../lib/syncCore.js";

const PROVIDER = "netflix";
const TIME_SYNC_EVERY_MS = 5000;
const REPORT_MAX_AGE_MS = 6000;
const BACKOFF = [1000, 2000, 4000, 8000, 15000, 30000];

/**
 * The extension's coordinator (runs in the MV3 service worker, but every outside dependency is injected
 * so it is unit-tested with a fake socket, fake tabs and a fake clock).
 *
 * It holds the room's CANONICAL state (from the server) and per-tab reports (from content scripts), picks
 * the one tab that is "the player", sends that tab its target, and forwards the user's real actions to the
 * server — only when the server-assigned role allows it. The server stays the authority: this class never
 * invents permissions, and a refused command simply re-asserts the canonical state on the tab.
 *
 * Nothing here ever sees, stores or sends Netflix cookies/credentials: the only data handled is
 * title id, play state and position.
 */
export function createController(deps) {
  const { storage, fetchImpl, connectSocket, sendToTab, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout, diag = { log() {} }, notify = () => {} } = deps;

  const S = {
    paired: false, server: null, token: null, roomId: null, expiresAt: null,
    connection: "unpaired", // unpaired | connecting | connected | waiting-for-room | room-ended | disconnected
    you: null, role: null, settings: null, room: null, roomRecvAt: 0, lastError: null, lastNote: null,
  };
  const tabs = new Map(); // tabId -> report + lastSeen
  let socket = null;
  let attempt = 0;
  let retryTimer = null;
  let generation = 0; // bumps on every (re)connect/unpair so stale async work is ignored
  let lastTimeSyncAt = 0;
  let lastReportedStatus = null;
  let lastNoteAt = 0;

  const canControl = () => S.role === "host" || (S.role === "moderator" && S.settings?.moderatorsCanControl !== false);
  const url = (path) => `${S.server}/api/extension${path}`;
  const headers = (extra = {}) => ({ "content-type": "application/json", ...(S.token ? { authorization: `Bearer ${S.token}` } : {}), ...extra });
  const ref = (mediaId) => ({ provider: PROVIDER, mediaId });

  function setConnection(c) { if (S.connection !== c) { S.connection = c; diag.log("connection", { c }); notify(); } }

  async function persist() {
    await storage.set({ wp: S.paired ? { server: S.server, token: S.token, roomId: S.roomId, expiresAt: S.expiresAt } : null });
  }

  function clearSocket() {
    generation++;
    clearTimer(retryTimer); retryTimer = null;
    if (socket) { try { socket.removeAllListeners?.(); socket.disconnect(); } catch { /* closing */ } socket = null; }
  }

  function scheduleRetry(ms) {
    clearTimer(retryTimer);
    const g = generation;
    retryTimer = setTimer(() => { if (g === generation) connect(); }, ms);
  }

  // ------------------------------------------------------------------ connection
  async function connect() {
    if (!S.paired) return;
    const g = ++generation;
    setConnection("connecting");
    let res;
    try {
      res = await fetchImpl(url("/socket-ticket"), { method: "POST", headers: headers(), body: "{}" });
    } catch {
      if (g !== generation) return;
      S.lastError = "Can't reach the Watch Party server.";
      setConnection("disconnected");
      return scheduleRetry(BACKOFF[Math.min(attempt++, BACKOFF.length - 1)]);
    }
    if (g !== generation) return;
    const body = await res.json().catch(() => ({}));
    const code = body?.error?.code ?? body?.code;
    if (res.status === 401) { await unpair("Pairing was revoked or expired. Pair again from the room."); return; }
    if (res.status === 404) { S.lastError = "This room has ended."; setConnection("room-ended"); return; }
    if (res.status === 409 || (res.status === 403 && code !== "BANNED")) {
      S.lastError = "Open this room in Watch Party first; the extension attaches to your seat there.";
      setConnection("waiting-for-room");
      return scheduleRetry(5000);
    }
    if (res.status === 403) { await unpair("You were removed from this room."); return; }
    if (res.status === 429) { setConnection("disconnected"); return scheduleRetry(10_000); }
    if (!res.ok || !body.ticket) {
      S.lastError = "Unexpected response from the server.";
      setConnection("disconnected");
      return scheduleRetry(BACKOFF[Math.min(attempt++, BACKOFF.length - 1)]);
    }

    const sock = connectSocket(S.server, body.ticket);
    socket = sock;
    sock.on("connect", () => { attempt = 0; S.lastError = null; });
    sock.on("companion_ready", (m) => { if (g === generation) onReady(m); });
    sock.on("sync_state", (m) => { if (g === generation) onSync(m); });
    sock.on("room_settings", (m) => { if (g === generation && m?.settings) { S.settings = m.settings; pushTargets(false); notify(); } });
    for (const ev of ["participants_updated", "host_changed", "role_assigned"]) sock.on(ev, (m) => { if (g === generation) onRoster(m); });
    sock.on("error_event", (m) => { if (g === generation) onServerError(m); });
    sock.on("companion_ended", (m) => { if (g === generation) onEnded(m); });
    sock.on("auth_expired", () => { if (g === generation) unpair("Your Watch Party session ended."); });
    sock.on("connect_error", (err) => {
      if (g !== generation) return;
      const c = err?.data?.code;
      if (c === "PAIRING_INVALID" || c === "BANNED") { unpair(c === "BANNED" ? "You were removed from this room." : "Pairing was revoked. Pair again from the room."); return; }
      if (c === "ROOM_NOT_FOUND") { S.lastError = "This room has ended."; setConnection("room-ended"); return; }
      if (c === "NOT_IN_ROOM") { setConnection("waiting-for-room"); return scheduleRetry(5000); }
      setConnection("disconnected");
      scheduleRetry(BACKOFF[Math.min(attempt++, BACKOFF.length - 1)]);
    });
    sock.on("disconnect", () => {
      if (g !== generation) return;
      socket = null;
      if (S.connection === "connected") setConnection("disconnected");
      if (S.paired && S.connection !== "unpaired" && S.connection !== "room-ended") scheduleRetry(BACKOFF[Math.min(attempt++, BACKOFF.length - 1)]);
    });
  }

  function onReady(m) {
    S.you = m?.you || null;
    S.role = m?.you?.role || null;
    S.settings = m?.settings || null;
    const st = parseSyncState(m?.state);
    if (st) { S.room = st; S.roomRecvAt = now(); }
    lastReportedStatus = null;
    setConnection("connected");
    pushTargets(true);
    reportPlayerStatus();
  }

  function onSync(m) {
    const st = parseSyncState(m);
    if (!st) return;
    if (S.room && st.seq < S.room.seq) return; // stale / out-of-order broadcast
    const mediaChanged = !S.room || S.room.mediaId !== st.mediaId || S.room.provider !== st.provider;
    S.room = st; S.roomRecvAt = now();
    lastTimeSyncAt = 0;
    pushTargets(false);
    if (mediaChanged) { lastReportedStatus = null; reportPlayerStatus(); }
    notify();
  }

  function onRoster(m) {
    if (!S.you || !Array.isArray(m?.participants)) return;
    const me = m.participants.find((p) => p.id === S.you.id);
    if (me && me.role !== S.role) { S.role = me.role; pushTargets(false); notify(); }
  }

  function onServerError(m) {
    S.lastError = typeof m?.message === "string" ? m.message.slice(0, 160) : "The server refused a command.";
    diag.log("server-error", { code: m?.code });
    // A refused command means the user's tab drifted from the room: put it back on the canonical state.
    pushTargets(true);
    notify();
  }

  async function onEnded(m) {
    diag.log("ended", { reason: m?.reason });
    const reason = m?.reason;
    if (reason === "replaced") { S.lastError = "Another browser took over this pairing."; await unpair(); }
    else if (reason === "revoked" || reason === "extension_disconnected") await unpair("Pairing was revoked.");
    else if (reason === "removed") await unpair("You were removed from this room.");
    else { clearSocket(); setConnection("waiting-for-room"); S.lastError = "You left the room in Watch Party. Re-open it to continue."; scheduleRetry(5000); }
  }

  // ------------------------------------------------------------------ tabs
  const liveReports = () => [...tabs.values()].filter((r) => now() - r.lastSeen <= REPORT_MAX_AGE_MS);
  const targetTab = () => (S.room?.provider === PROVIDER ? pickTargetTab(liveReports(), S.room.mediaId, now(), REPORT_MAX_AGE_MS) : null);

  function targetFor(tabId, force) {
    if (!S.room || S.room.provider !== PROVIDER || !S.room.mediaId) {
      return { kind: "target", target: null, canControl: canControl(), force: false, note: S.room?.mediaId ? "The room isn't on a Netflix title." : null };
    }
    const tt = targetTab();
    const mine = tabs.get(tabId);
    if (tt && tt.tabId === tabId) {
      const t = projectPosition({ playing: S.room.playing, time: S.room.time, rate: S.room.rate }, S.roomRecvAt, now());
      return { kind: "target", canControl: canControl(), force: !!force, note: null,
        target: { mediaId: S.room.mediaId, playing: S.room.playing, time: S.room.time, rate: S.room.rate, seq: S.room.seq, _projected: t } };
    }
    let note = null;
    if (mine && mine.titleId && mine.titleId !== S.room.mediaId) note = "The room is watching a different title. Open the one the host picked.";
    else if (mine && mine.titleId === S.room.mediaId && tt) note = "Another Netflix tab is already synced to this room.";
    return { kind: "target", target: null, canControl: canControl(), force: false, note };
  }

  function pushTargets(force) {
    for (const r of liveReports()) {
      const msg = targetFor(r.tabId, force);
      if (msg.target) delete msg.target._projected;
      sendToTab(r.tabId, msg);
    }
  }

  function derivePlayerStatus() {
    if (!S.room?.mediaId || S.room.provider !== PROVIDER) return null;
    const reports = liveReports();
    if (!reports.length) return { status: "no_player" };
    const match = reports.filter((r) => r.titleId === S.room.mediaId);
    if (!match.length) return { status: "ready", ref: ref(reports[0].titleId || "0") }; // server derives wrong_title from the ref
    const t = targetTab() || match[0];
    if (t.status === "blocked") return { status: "blocked" };
    if (!t.caps.play && !t.caps.pause && t.status !== "no-player") return { status: "unsupported" };
    return { status: "ready", ref: ref(S.room.mediaId) };
  }

  function reportPlayerStatus() {
    if (!socket || S.connection !== "connected") return;
    const d = derivePlayerStatus();
    if (!d) return;
    const key = d.status + (d.ref?.mediaId || "");
    if (key === lastReportedStatus) return;
    lastReportedStatus = key;
    socket.emit("player_status", d);
  }

  /** Content script -> here. Returns the message the tab should receive in reply. */
  function onReport(tabId, raw, sender = {}) {
    const rep = parseReport(raw);
    if (!rep) { diag.log("bad-report"); return { ok: false }; }
    const prevR = tabs.get(tabId);
    tabs.set(tabId, { ...rep, tabId, lastSeen: now(), active: !!sender.active, playing: !!rep.state?.playing, userAction: null });
    const entry = tabs.get(tabId);
    const tt = targetTab();
    const isTarget = !!tt && tt.tabId === tabId;

    if (rep.userAction && isTarget && S.connection === "connected" && S.room) {
      if (canControl()) forwardUserAction(rep);
      else {
        // Viewers can't steer the room: put their player back and say why (rate limited so it is not spammy).
        if (now() - lastNoteAt > 4000) { lastNoteAt = now(); S.lastNote = "Only the host (or moderators) control playback."; }
        sendToTab(tabId, { ...targetFor(tabId, true), note: S.lastNote });
      }
    }
    if (isTarget && canControl() && S.connection === "connected" && S.room?.playing && rep.state?.playing && rep.status === "ok" && now() - lastTimeSyncAt >= TIME_SYNC_EVERY_MS) {
      lastTimeSyncAt = now();
      socket?.emit("time_sync", { time: rep.state.position, seq: S.room.seq, ref: ref(S.room.mediaId) });
    }
    if (!prevR || prevR.titleId !== rep.titleId || prevR.status !== rep.status) { lastReportedStatus = prevR && prevR.titleId === rep.titleId ? lastReportedStatus : null; reportPlayerStatus(); notify(); }
    const reply = targetFor(tabId, !prevR);
    if (reply.target) delete reply.target._projected;
    entry.sentTarget = !!reply.target;
    return reply;
  }

  function forwardUserAction(rep) {
    const mediaId = S.room.mediaId;
    const pos = rep.state.position;
    const serverPos = projectPosition({ playing: S.room.playing, time: S.room.time, rate: S.room.rate }, S.roomRecvAt, now());
    const r = ref(mediaId);
    if (rep.userAction === "seek") { socket.emit("seek", { time: pos, ref: r }); return; }
    // play/pause carry no time on the wire: first align the room's clock if the user's position differs.
    if (Math.abs(pos - serverPos) > 1) socket.emit("seek", { time: pos, ref: r });
    socket.emit(rep.userAction, { ref: r });
  }

  function onTabClosed(tabId) { if (tabs.delete(tabId)) { lastReportedStatus = null; reportPlayerStatus(); notify(); } }

  // ------------------------------------------------------------------ lifecycle
  async function unpair(message = null) {
    const server = S.server, token = S.token;
    clearSocket();
    Object.assign(S, { paired: false, token: null, roomId: null, expiresAt: null, you: null, role: null, settings: null, room: null, lastError: message });
    setConnection("unpaired");
    await storage.set({ wp: null });
    if (server && token && deps.revokeOnUnpair !== false) {
      fetchImpl(`${server}/api/extension/disconnect`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: "{}" }).catch(() => {});
    }
    for (const r of liveReports()) sendToTab(r.tabId, { kind: "target", target: null, canControl: false, force: false, note: "Watch Party isn't paired." });
    notify();
  }

  return {
    state: S,
    async init() {
      const { wp } = await storage.get("wp");
      if (wp?.token && wp?.server && parseServerOrigin(wp.server)) {
        Object.assign(S, { paired: true, server: wp.server, token: wp.token, roomId: wp.roomId, expiresAt: wp.expiresAt });
        attempt = 0;
        return connect();
      }
      setConnection("unpaired");
    },
    async pair({ serverUrl, code, label = "Browser extension" }) {
      const origin = parseServerOrigin(serverUrl);
      if (!origin) return { ok: false, error: "Enter your Watch Party address (https://…)." };
      let res;
      try {
        res = await fetchImpl(`${origin}/api/extension/pair`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code, label }) });
      } catch { return { ok: false, error: "Can't reach that server." }; }
      const body = await res.json().catch(() => ({}));
      if (res.status === 429) return { ok: false, error: "Too many attempts. Wait a minute and try again." };
      if (!res.ok || !body.token) return { ok: false, error: body?.error?.message || body?.message || "That code didn't work. Generate a new one in the room." };
      clearSocket();
      Object.assign(S, { paired: true, server: origin, token: body.token, roomId: body.roomId, expiresAt: body.expiresAt, lastError: null });
      await persist();
      attempt = 0;
      connect();
      return { ok: true };
    },
    unpair,
    /** Cheap periodic check (alarm): if we should be connected but are not, and nothing is already scheduled, try now. */
    ensure() { if (S.paired && !socket && !retryTimer && (S.connection === "disconnected" || S.connection === "connecting")) connect(); },
    reconnect() { if (!S.paired) return; clearSocket(); attempt = 0; connect(); },
    onReport, onTabClosed, pushTargets,
    getStatus() {
      const tt = targetTab();
      const reports = liveReports();
      const match = S.room?.mediaId ? reports.filter((r) => r.titleId === S.room.mediaId) : [];
      let tab = "none";
      if (reports.length) tab = match.length ? (tt?.limited ? "limited" : tt?.status || "ok") : "wrong-title";
      return {
        paired: S.paired, server: S.server, roomId: S.roomId, connection: S.connection, role: S.role, canControl: canControl(),
        room: S.room ? { provider: S.room.provider, mediaId: S.room.mediaId, playing: S.room.playing, seq: S.room.seq } : null,
        tab: { state: tab, titleId: tt?.titleId ?? reports[0]?.titleId ?? null, adapter: tt?.adapter ?? null, limited: tt?.limited ?? null, page: reports[0]?.page ?? null, tabs: reports.length },
        error: S.lastError,
      };
    },
    close() { clearSocket(); },
  };
}
