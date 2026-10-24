import { parseServerOrigin } from "../lib/validate.js";

const $ = (id) => document.getElementById(id);
const send = (msg) => chrome.runtime.sendMessage(msg).catch(() => null);

const CONN = {
  connected: ["Connected", "ok"], connecting: ["Connecting…", "warn"], disconnected: ["Offline — retrying", "warn"],
  "waiting-for-room": ["Waiting for you to open the room in Watch Party", "warn"], "room-ended": ["This room has ended", "bad"], unpaired: ["Not paired", "bad"],
};
const TAB = {
  none: ["No Netflix tab open", "warn"], "wrong-title": ["On a different title than the room", "warn"], ok: ["Synced", "ok"], buffering: ["Buffering…", "warn"],
  ad: ["Ad playing — paused sync", "warn"], blocked: ["Click play in Netflix to join", "warn"], error: ["Player error", "bad"], limited: ["Limited sync (see below)", "warn"], "no-player": ["Waiting for the player", "warn"],
};
const HINTS = {
  none: "Open the same Netflix title the room is watching, in this browser.",
  "wrong-title": "The room is watching a different title. Open the one the host picked.",
  limited: "Netflix's player interface wasn't available, so only play/pause can be synced — seeking and drift correction are off.",
  blocked: "Netflix blocked an automatic start. Press play once; sync resumes after that.",
};

function setText(id, [text, cls]) { const el = $(id); el.textContent = text; el.className = cls || ""; }

async function render() {
  const st = await send({ kind: "getStatus" });
  if (!st) return;
  $("unpaired").hidden = st.paired;
  $("paired").hidden = !st.paired;
  if (!st.paired) { $("pairError").textContent = st.error || $("pairError").textContent; return; }
  $("sServer").textContent = st.server;
  setText("sConn", CONN[st.connection] || [st.connection, ""]);
  $("sRole").textContent = st.role ? `${st.role}${st.canControl ? " (can control playback)" : " (watch only)"}` : "—";
  $("sRoom").textContent = st.room?.mediaId ? (st.room.provider === "netflix" ? `Netflix #${st.room.mediaId}` : `Not a Netflix title (${st.room.provider})`) : "Nothing selected yet";
  setText("sTab", TAB[st.tab.state] || [st.tab.state, ""]);
  $("hint").textContent = HINTS[st.tab.state] || "";
  $("hint").hidden = !HINTS[st.tab.state];
  $("err").textContent = st.error || "";
}

$("pair").addEventListener("click", async () => {
  const btn = $("pair");
  const err = $("pairError");
  err.textContent = "";
  const origin = parseServerOrigin($("server").value);
  if (!origin) { err.textContent = "Enter your Watch Party address (https://…)."; return; }
  btn.disabled = true;
  try {
    // Ask for access to THIS server only, as a direct result of the click (required by the browser).
    const granted = await chrome.permissions.request({ origins: [`${origin}/*`] }).catch(() => false);
    if (!granted) { err.textContent = "Permission to contact that server was not granted."; return; }
    const res = await send({ kind: "pair", serverUrl: origin, code: $("code").value, label: "Chrome extension" });
    if (!res?.ok) err.textContent = res?.error || "Pairing failed.";
    else { $("code").value = ""; }
  } finally { btn.disabled = false; await render(); }
});
$("unpair").addEventListener("click", async () => { await send({ kind: "unpair" }); await render(); });
$("reconnect").addEventListener("click", async () => { await send({ kind: "reconnect" }); await render(); });
$("copyDiag").addEventListener("click", async () => {
  const d = await send({ kind: "getDiagnostics" });
  try { await navigator.clipboard.writeText(JSON.stringify(d, null, 2)); $("err").textContent = "Diagnostics copied."; }
  catch { $("err").textContent = "Couldn't copy to the clipboard."; }
});
chrome.storage.local.get("lastServer").then(({ lastServer }) => { if (lastServer && !$("server").value) $("server").value = lastServer; }).catch(() => {});
render();
setInterval(render, 1000);
