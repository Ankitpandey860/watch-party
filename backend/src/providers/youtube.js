// YouTube provider descriptor. The server never plays media; it only validates what a client
// asks the room to load, so a hand-crafted change_video event cannot smuggle arbitrary strings.
const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;
const HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be"]);

function idFromUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  const host = u.hostname.toLowerCase();
  if (!HOSTS.has(host)) return null; // exact match: "notyoutube.com" and "youtube.com.evil.io" are rejected
  if (host === "youtu.be") return u.pathname.split("/").filter(Boolean)[0] || null;
  const v = u.searchParams.get("v");
  if (v) return v;
  const parts = u.pathname.split("/").filter(Boolean);
  const i = parts.findIndex((p) => p === "embed" || p === "shorts" || p === "live");
  return i >= 0 ? parts[i + 1] || null : null;
}

export const youtubeProvider = Object.freeze({
  id: "youtube",
  label: "YouTube",
  /** Accepts an 11-char video id or a YouTube URL; returns { mediaId } or null. */
  parse(input) {
    if (typeof input !== "string") return null;
    const value = input.trim();
    if (!value || value.length > 2048) return null;
    const candidate = VIDEO_ID_RE.test(value) ? value : idFromUrl(value);
    return candidate && VIDEO_ID_RE.test(candidate) ? { mediaId: candidate } : null;
  },
});
