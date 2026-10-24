// Pure URL/ID parsers for every provider. MIRRORS backend/src/providers/*.js (the server is the
// authority and re-validates everything; these exist so the UI can validate before sending and
// explain refusals). providers.parity.test.js runs one shared corpus through BOTH implementations.
//
// Every parser returns { mediaId, params } or null and never throws.
import { extractYouTubeId } from "../utils/youtube";

const MAX_INPUT = 2048;

function clean(input) {
  if (typeof input !== "string") return "";
  const v = input.trim();
  return v && v.length <= MAX_INPUT ? v : "";
}

function toUrl(value, { httpOk = true } = {}) {
  let u;
  try {
    u = new URL(value);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && !(httpOk && u.protocol === "http:")) return null;
  return u;
}

// ---- YouTube ---------------------------------------------------------------------------------
export function parseYouTube(input) {
  const v = clean(input);
  if (!v) return null;
  const id = extractYouTubeId(v);
  return id ? { mediaId: id, params: {} } : null;
}

// ---- Vimeo -----------------------------------------------------------------------------------
const VIMEO_ID = /^\d{3,12}$/;
const VIMEO_HASH = /^[0-9a-f]{8,20}$/i;
const VIMEO_HOSTS = new Set(["vimeo.com", "www.vimeo.com", "player.vimeo.com"]);
const SLUG = /^[A-Za-z0-9_-]{1,64}$/;

function vimeoPrefixOk(b) {
  if (b.length === 0) return true;
  const [a, x, c] = b;
  if (b.length === 1) return a === "video";
  if (b.length === 2)
    return (a === "channels" || a === "album" || a === "showcase") && SLUG.test(x);
  if (b.length === 3)
    return (
      ((a === "groups" && c === "videos") ||
        ((a === "album" || a === "showcase") && c === "video")) &&
      SLUG.test(x)
    );
  return false;
}

export function parseVimeo(input, { explicit = false } = {}) {
  const v = clean(input);
  if (!v) return null;
  if (explicit && VIMEO_ID.test(v)) return { mediaId: v, params: {} };
  const u = toUrl(v);
  if (!u || !VIMEO_HOSTS.has(u.hostname.toLowerCase())) return null;
  const parts = u.pathname.split("/").filter(Boolean);
  const i = parts.findIndex((p) => VIMEO_ID.test(p));
  if (i < 0 || !vimeoPrefixOk(parts.slice(0, i))) return null;
  let hash = u.searchParams.get("h");
  if (!hash && parts[i + 1] && VIMEO_HASH.test(parts[i + 1])) hash = parts[i + 1];
  if (hash && !VIMEO_HASH.test(hash)) return null;
  return { mediaId: parts[i], params: hash ? { hash: hash.toLowerCase() } : {} };
}

// ---- Twitch ----------------------------------------------------------------------------------
const TW_VIDEO = /^\d{6,12}$/;
const TW_CLIP = /^[A-Za-z0-9_-]{4,100}$/;
const TW_CHANNEL = /^[A-Za-z0-9_]{3,25}$/;
const TW_HOSTS = new Set(["twitch.tv", "www.twitch.tv", "m.twitch.tv", "clips.twitch.tv"]);

function analyseTwitch(raw) {
  const u = toUrl(raw);
  if (!u) return null;
  const host = u.hostname.toLowerCase();
  if (!TW_HOSTS.has(host)) return null;
  const parts = u.pathname.split("/").filter(Boolean);
  if (host === "clips.twitch.tv") {
    const slug = parts[0] === "embed" ? u.searchParams.get("clip") : parts[0];
    return slug && TW_CLIP.test(slug) ? { kind: "clip", mediaId: slug } : { kind: "invalid" };
  }
  if (parts[0] === "videos")
    return parts[1] && TW_VIDEO.test(parts[1])
      ? { kind: "video", mediaId: parts[1] }
      : { kind: "invalid" };
  if (parts[1] === "clip")
    return parts[2] && TW_CLIP.test(parts[2])
      ? { kind: "clip", mediaId: parts[2] }
      : { kind: "invalid" };
  if (parts.length === 1 && TW_CHANNEL.test(parts[0])) return { kind: "live" };
  return { kind: "invalid" };
}

export function parseTwitch(input, { explicit = false } = {}) {
  const v = clean(input);
  if (!v) return null;
  if (explicit && /^v?\d{6,12}$/.test(v))
    return { mediaId: v.replace(/^v/, ""), params: { kind: "video" } };
  const a = analyseTwitch(v);
  if (!a || a.kind === "invalid" || a.kind === "live") return null;
  return { mediaId: a.mediaId, params: { kind: a.kind } };
}

export function explainTwitch(input) {
  const a = typeof input === "string" ? analyseTwitch(input.trim()) : null;
  if (a?.kind === "live")
    return "Live Twitch streams can't be synchronised (there is no position to seek to). Use a past broadcast (twitch.tv/videos/…) or a clip.";
  return "That doesn't look like a Twitch video or clip link (e.g. https://www.twitch.tv/videos/123456789).";
}

// ---- Netflix ---------------------------------------------------------------------------------
const NF_HOSTS = new Set(["netflix.com", "www.netflix.com"]);
const NF_WATCH = /^\/(?:[a-z]{2}(?:-[A-Za-z]{2,4})?\/)?watch\/(\d{5,12})\/?$/;

export function parseNetflix(input) {
  const v = clean(input);
  if (!v) return null;
  const u = toUrl(v, { httpOk: false });
  if (!u || !NF_HOSTS.has(u.hostname.toLowerCase())) return null;
  const m = u.pathname.match(NF_WATCH);
  return m ? { mediaId: m[1], params: {} } : null;
}
