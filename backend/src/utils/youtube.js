// Server-side mirror of the frontend's src/utils/youtube.js extractYouTubeId().
// The frontend already validates the URL before calling onChangeVideo, but the
// server must never trust the client — a participant could hand-craft a
// change_video socket event, so we re-validate here.
export function extractYouTubeId(url) {
  if (!url || typeof url !== "string") return null;
  try {
    const u = new URL(url);
    if (u.hostname === "youtu.be") return u.pathname.slice(1) || null;
    if (u.hostname.includes("youtube.com")) {
      if (u.searchParams.get("v")) return u.searchParams.get("v");
      const parts = u.pathname.split("/").filter(Boolean);
      const idx = parts.findIndex((p) => p === "embed" || p === "shorts");
      if (idx >= 0 && parts[idx + 1]) return parts[idx + 1];
    }
  } catch {
    return null;
  }
  return null;
}

const VIDEO_ID_RE = /^[a-zA-Z0-9_-]{11}$/;

/** Accepts either a raw 11-char video id or a full YouTube URL, returns a clean id or null. */
export function resolveVideoId(input) {
  if (!input || typeof input !== "string") return null;
  const trimmed = input.trim();
  if (VIDEO_ID_RE.test(trimmed)) return trimmed;
  return extractYouTubeId(trimmed);
}
