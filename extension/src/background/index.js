import { io } from "socket.io-client";
import { createController } from "./controller.js";
import { createDiagnostics } from "../lib/diagnostics.js";
import { parseServerOrigin } from "../lib/validate.js";

const MOCK_ORIGIN = typeof __WP_MOCK_ORIGIN__ === "string" ? __WP_MOCK_ORIGIN__ : "";
const NETFLIX_ORIGINS = new Set(["https://www.netflix.com", ...(MOCK_ORIGIN ? [MOCK_ORIGIN] : [])]);

const diag = createDiagnostics();
const controller = createController({
  storage: chrome.storage.local,
  fetchImpl: (...a) => fetch(...a),
  // websocket ONLY: an MV3 service worker has no XHR, and one transport means one failure mode.
  connectSocket: (server, ticket) => io(server, { transports: ["websocket"], auth: { ticket }, reconnection: false, forceNew: true }),
  sendToTab: (tabId, msg) => { chrome.tabs.sendMessage(tabId, msg).catch(() => {}); },
  diag,
});

// The service worker can be suspended at any time: everything durable is in chrome.storage; on wake we re-init.
const ready = controller.init().catch((e) => diag.log("init-failed", { error: String(e?.message || e) }));

chrome.alarms.create("wp-keepalive", { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener(async (a) => { if (a.name === "wp-keepalive") { await ready; controller.ensure(); } });
chrome.tabs.onRemoved.addListener((tabId) => controller.onTabClosed(tabId));

// Trust = the sender is one of THIS extension's own pages (popup). Content scripts also carry our id, but their
// sender.url is a web page, so they never match. (Checked by URL, not by "no tab": a popup opened in a tab is still ours.)
const fromOwnPage = (sender) => sender.id === chrome.runtime.id && typeof sender.url === "string" && sender.url.startsWith(chrome.runtime.getURL(""));
const fromNetflix = (sender) => {
  if (sender.id !== chrome.runtime.id || !sender.tab || !sender.url) return false;
  try { return NETFLIX_ORIGINS.has(new URL(sender.url).origin); } catch { return false; }
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    await ready;
    if (msg?.kind === "report" && fromNetflix(sender)) {
      sendResponse(controller.onReport(sender.tab.id, msg, { active: sender.tab.active }));
    } else if (fromOwnPage(sender) && msg?.kind === "getStatus") {
      sendResponse(controller.getStatus());
    } else if (fromOwnPage(sender) && msg?.kind === "pair") {
      const origin = parseServerOrigin(msg.serverUrl);
      const out = await controller.pair({ serverUrl: msg.serverUrl, code: String(msg.code || ""), label: msg.label });
      if (out.ok && origin) chrome.storage.local.set({ lastServer: origin }).catch(() => {});
      sendResponse(out);
    } else if (fromOwnPage(sender) && msg?.kind === "unpair") {
      await controller.unpair(); sendResponse({ ok: true });
    } else if (fromOwnPage(sender) && msg?.kind === "reconnect") {
      controller.reconnect(); sendResponse({ ok: true });
    } else if (fromOwnPage(sender) && msg?.kind === "getDiagnostics") {
      sendResponse({ extension: chrome.runtime.getManifest().version, status: controller.getStatus(), events: diag.dump() });
    } else sendResponse({ ok: false, error: "forbidden" }); // anything else (including web pages) gets nothing
  })();
  return true;
});
