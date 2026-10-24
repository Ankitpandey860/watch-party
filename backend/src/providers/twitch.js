// Twitch provider descriptor. Supported: VODs (full sync) and clips (embedded, NOT controllable).
// Live channels cannot be synchronised (there is nothing to seek to) and are refused with a reason.
const VIDEO_RE = /^\d{6,12}$/;
const CLIP_RE = /^[A-Za-z0-9_-]{4,100}$/;
const CHANNEL_RE = /^[A-Za-z0-9_]{3,25}$/;
const HOSTS = new Set(["twitch.tv", "www.twitch.tv", "m.twitch.tv", "clips.twitch.tv"]);

function analyse(raw) {
  let u;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  const host = u.hostname.toLowerCase();
  if (!HOSTS.has(host)) return null;
  const parts = u.pathname.split("/").filter(Boolean);
  if (host === "clips.twitch.tv") {
    const slug = parts[0] === "embed" ? u.searchParams.get("clip") : parts[0];
    return slug && CLIP_RE.test(slug) ? { kind: "clip", mediaId: slug } : { kind: "invalid" };
  }
  if (parts[0] === "videos") return parts[1] && VIDEO_RE.test(parts[1]) ? { kind: "video", mediaId: parts[1] } : { kind: "invalid" };
  if (parts[1] === "clip") return parts[2] && CLIP_RE.test(parts[2]) ? { kind: "clip", mediaId: parts[2] } : { kind: "invalid" };
  if (parts.length === 1 && CHANNEL_RE.test(parts[0])) return { kind: "live" };
  return { kind: "invalid" };
}

export const twitchProvider = Object.freeze({
  id: "twitch",
  label: "Twitch",
  mode: "embedded",
  parse(input, { explicit = false } = {}) {
    if (typeof input !== "string") return null;
    const value = input.trim();
    if (!value || value.length > 2048) return null;
    if (explicit && /^v?\d{6,12}$/.test(value)) return { mediaId: value.replace(/^v/, ""), params: { kind: "video" } };
    const a = analyse(value);
    if (!a || a.kind === "invalid" || a.kind === "live") return null;
    return { mediaId: a.mediaId, params: { kind: a.kind } };
  },
  explain(input) {
    const a = typeof input === "string" ? analyse(input.trim()) : null;
    if (a?.kind === "live") return "Live Twitch streams can't be synchronised (there is no position to seek to). Use a past broadcast (twitch.tv/videos/…) or a clip.";
    return "That doesn't look like a Twitch video or clip link (e.g. https://www.twitch.tv/videos/123456789).";
  },
});
