// Netflix provider descriptor ("companion" mode). The room only stores WHICH title is loaded; every
// participant plays it in their OWN Netflix session, controlled by our browser extension. The server
// never sees Netflix cookies, tokens or video. Netflix is not embeddable in our page.
const ID_RE = /^\d{5,12}$/;
const HOSTS = new Set(["netflix.com", "www.netflix.com"]);
// Optional country/language prefix such as /in/ or /in-hi/ before /watch/<id>.
const WATCH_RE = /^\/(?:[a-z]{2}(?:-[A-Za-z]{2,4})?\/)?watch\/(\d{5,12})\/?$/;

function idFromUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== "https:") return null;
  if (!HOSTS.has(u.hostname.toLowerCase())) return null;
  const m = u.pathname.match(WATCH_RE);
  return m && ID_RE.test(m[1]) ? m[1] : null;
}

export const netflixProvider = Object.freeze({
  id: "netflix",
  label: "Netflix",
  mode: "companion",
  parse(input) {
    if (typeof input !== "string") return null;
    const value = input.trim();
    if (!value || value.length > 2048) return null;
    const id = idFromUrl(value);
    return id ? { mediaId: id, params: {} } : null;
  },
  explain: () => "Paste the address of the playing title: https://www.netflix.com/watch/<number>. (Title pages /title/… are not playback pages.)",
});
