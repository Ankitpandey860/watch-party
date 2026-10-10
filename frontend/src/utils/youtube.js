// YouTube URL helpers. Parsing is deliberately strict and mirrors backend/src/providers/youtube.js:
// exact hostnames only and an 11-character video id, so lookalike domains and junk are rejected.
const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;
const HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtu.be",
]);

/** Accepts a YouTube URL or a bare 11-char video id; returns the video id or null. */
export function extractYouTubeId(input) {
  if (typeof input !== "string") return null;
  const value = input.trim();
  if (!value || value.length > 2048) return null;
  if (VIDEO_ID_RE.test(value)) return value;

  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.toLowerCase();
  if (!HOSTS.has(host)) return null;

  let candidate = null;
  if (host === "youtu.be") {
    candidate = url.pathname.split("/").filter(Boolean)[0] || null;
  } else {
    candidate = url.searchParams.get("v");
    if (!candidate) {
      const parts = url.pathname.split("/").filter(Boolean);
      const i = parts.findIndex((p) => p === "embed" || p === "shorts" || p === "live");
      candidate = i >= 0 ? parts[i + 1] || null : null;
    }
  }
  return candidate && VIDEO_ID_RE.test(candidate) ? candidate : null;
}

/** Formats seconds as m:ss or h:mm:ss. */
export function formatTime(seconds) {
  const s = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}
