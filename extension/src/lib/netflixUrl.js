// Netflix watch-page URL handling. Kept dependency-free: the SAME rules run in the content script,
// the service worker and the unit tests (and mirror backend/src/providers/netflix.js).
const HOSTS = new Set(["www.netflix.com", "netflix.com"]);
// /watch/<id> optionally behind a locale prefix such as /in-hi/ or /gb/
const WATCH = /^\/(?:[a-z]{2}(?:-[A-Za-z]{2,4})?\/)?watch\/(\d{5,12})\/?$/;

/** The Netflix title (viewable) id of a playback page, or null for anything that is not one. */
// Test builds (only) add one extra origin that hosts a local mock page; production builds define it as "".
const MOCK_ORIGIN = typeof __WP_MOCK_ORIGIN__ === "string" ? __WP_MOCK_ORIGIN__ : "";

export function netflixTitleId(href) {
  let u;
  try { u = new URL(href); } catch { return null; }
  const isMock = MOCK_ORIGIN !== "" && u.origin === MOCK_ORIGIN;
  if (!isMock && (u.protocol !== "https:" || !HOSTS.has(u.hostname))) return null;
  const m = WATCH.exec(u.pathname);
  return m ? m[1] : null;
}

/** Classifies a Netflix URL so the UI can explain *why* a page cannot be synchronised. */
export function classifyNetflixPage(href) {
  let u;
  try { u = new URL(href); } catch { return "not-netflix"; }
  if (netflixTitleId(href)) return "watch";
  if (!HOSTS.has(u.hostname) && !(MOCK_ORIGIN && u.origin === MOCK_ORIGIN)) return "not-netflix";
  if (/\/title\/\d+/.test(u.pathname)) return "title-page"; // details page: pick Play first
  return "browse";
}
