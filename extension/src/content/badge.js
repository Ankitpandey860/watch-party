// A tiny, unobtrusive status pill (Shadow DOM, so Netflix's CSS can't touch it and ours can't leak).
export function createBadge(doc = document) {
  let host = null, el = null, hideTimer = null;
  function ensure() {
    if (host && host.isConnected) return;
    host = doc.createElement("div");
    host.style.cssText = "all:initial;position:fixed;left:16px;bottom:72px;z-index:2147483647;pointer-events:none;";
    const root = host.attachShadow({ mode: "closed" });
    el = doc.createElement("div");
    el.style.cssText = "font:600 12px/1.3 system-ui,sans-serif;color:#fff;background:rgba(17,24,39,.86);border:1px solid rgba(255,255,255,.18);padding:6px 10px;border-radius:999px;max-width:320px;opacity:0;transition:opacity .25s;";
    root.appendChild(el);
    (doc.fullscreenElement || doc.documentElement).appendChild(host);
  }
  return {
    show(text, { sticky = false } = {}) {
      if (!text) return this.hide();
      ensure();
      // Keep the pill inside the fullscreen element when the player is fullscreen.
      const parent = doc.fullscreenElement || doc.documentElement;
      if (host.parentNode !== parent) parent.appendChild(host);
      el.textContent = `Watch Party · ${text}`;
      el.style.opacity = "1";
      clearTimeout(hideTimer);
      if (!sticky) hideTimer = setTimeout(() => { el.style.opacity = "0"; }, 4000);
    },
    hide() { if (el) el.style.opacity = "0"; clearTimeout(hideTimer); },
    destroy() { host?.remove(); clearTimeout(hideTimer); },
  };
}
