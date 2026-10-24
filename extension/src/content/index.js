import { netflixTitleId, classifyNetflixPage } from "../lib/netflixUrl.js";
import { parseTarget } from "../lib/validate.js";
import { createDiagnostics } from "../lib/diagnostics.js";
import { createCadmiumAdapter } from "./adapters/netflixCadmium.js";
import { createDomAdapter } from "./adapters/netflixDom.js";
import { createPlayerController } from "./playerController.js";
import { createBadge } from "./badge.js";

// Isolated-world content script for netflix.com. Everything it sends goes to OUR service worker via
// chrome.runtime messaging: title id, play state, position, capability flags. Nothing else.
if (!globalThis.__wpContent) {
  globalThis.__wpContent = true;
  const diag = createDiagnostics();
  const badge = createBadge();

  let adapter = null;
  let stopNative = null;
  let lastProbeAt = 0;
  let readFailures = 0;
  let controller = null;

  const titleId = () => netflixTitleId(location.href);
  const page = () => classifyNetflixPage(location.href);

  function adopt(next, reason) {
    if (adapter && adapter !== next) { stopNative?.(); stopNative = null; adapter.destroy?.(); }
    adapter = next;
    readFailures = 0;
    diag.log("adapter", { id: next?.id || null, reason, methods: next?.methods });
    if (next?.onNativeEvents) stopNative = next.onNativeEvents((e) => controller.onNative(e));
  }

  /** Capability detection with fallback: prefer the full player API, else the limited DOM adapter, re-probing periodically. */
  async function ensureAdapter() {
    if (!titleId()) { if (adapter) adopt(null, "left-watch-page"); return; }
    const t = Date.now();
    const wait = adapter ? (adapter.id === "netflix-cadmium" ? Infinity : 15_000) : 1_500;
    if (t - lastProbeAt < wait) return;
    lastProbeAt = t;
    const cad = createCadmiumAdapter();
    const probe = await cad.probe();
    if (probe.available) { if (adapter?.id !== "netflix-cadmium") adopt(cad, "full-player-api"); else cad.destroy(); return; }
    cad.destroy();
    diag.log("cadmium-unavailable", probe);
    if (adapter?.id === "netflix-dom") return;
    const dom = createDomAdapter();
    if ((await dom.probe()).available) adopt(dom, "fallback-limited");
  }

  controller = createPlayerController({
    getAdapter: () => adapter,
    getTitleId: titleId,
    diag,
    report: (r) => {
      chrome.runtime.sendMessage({ kind: "report", page: page(), ...r }).then(handleReply).catch(() => {});
    },
  });

  function handleReply(msg) {
    const parsed = parseTarget(msg);
    if (!parsed) return;
    if (parsed.note) badge.show(parsed.note);
    controller.setTarget(parsed);
  }

  chrome.runtime.onMessage.addListener((msg, sender) => {
    if (sender.id !== chrome.runtime.id) return;
    handleReply(msg);
  });

  // Netflix is a single-page app: the URL changes without a reload, and the player object is replaced.
  let lastHref = location.href;
  const timers = [];
  /** After an extension reload/update this orphaned script can no longer talk to the extension: stop cleanly. */
  function shutdownIfOrphaned() {
    if (chrome.runtime?.id) return false;
    for (const t of timers) clearInterval(t);
    stopNative?.(); adapter?.destroy?.(); adapter = null;
    globalThis.__wpContent = false; // a freshly injected script may take over
    return true;
  }
  timers.push(setInterval(() => {
    if (shutdownIfOrphaned()) return;
    if (location.href === lastHref) return;
    lastHref = location.href;
    diag.log("navigated", { page: page(), title: titleId() });
    controller.reset();
    lastProbeAt = 0;
    if (!titleId() && adapter) adopt(null, "navigated-away");
  }, 400));

  async function loop() {
    if (shutdownIfOrphaned()) return;
    try {
      await ensureAdapter();
      const before = adapter;
      await controller.tick();
      // The cadmium adapter returning nothing repeatedly means the player was replaced or the API vanished: re-select.
      if (before && controller.status === "no-player") { if (++readFailures >= 5) { adopt(null, "lost-player"); lastProbeAt = 0; } } else readFailures = 0;
      const st = controller.status;
      if (st === "blocked") badge.show("Netflix blocked autoplay — press play once", { sticky: true });
      else if (st === "ad") badge.show("Ad playing — sync paused");
      else if (controller.limited) badge.show(`Limited sync (${controller.limited} unavailable)`);
    } catch (e) {
      diag.log("loop-error", { error: String(e?.message || e).slice(0, 80) });
    }
  }
  timers.push(setInterval(loop, 1000));
  loop();
}
