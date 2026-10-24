// Vimeo provider descriptor. The server never plays media; it only validates what a client asks the
// room to load. Unlisted videos need their privacy hash (`h`), which we keep as a media parameter.
const ID_RE = /^\d{3,12}$/;
const HASH_RE = /^[0-9a-f]{8,20}$/i;
const HOSTS = new Set(["vimeo.com", "www.vimeo.com", "player.vimeo.com"]);

const SLUG = /^[A-Za-z0-9_-]{1,64}$/;
/** Known Vimeo path shapes only; anything else (e.g. /etc/<id>) is not a Vimeo video link. */
function validPrefix(b) {
  if (b.length === 0) return true;
  const [a, x, c] = b;
  if (b.length === 1) return a === "video";
  if (b.length === 2) return (a === "channels" || a === "album" || a === "showcase") && SLUG.test(x);
  if (b.length === 3) return ((a === "groups" && c === "videos") || ((a === "album" || a === "showcase") && c === "video")) && SLUG.test(x);
  return false;
}

function fromUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  if (!HOSTS.has(u.hostname.toLowerCase())) return null; // exact match: "notvimeo.com" is rejected
  const parts = u.pathname.split("/").filter(Boolean);
  const i = parts.findIndex((p) => ID_RE.test(p));
  if (i < 0) return null;
  // Only the segments that precede the id may be navigational: video | channels/x | groups/x/videos | album/x/video
  const before = parts.slice(0, i);
  if (!validPrefix(before)) return null;
  let hash = u.searchParams.get("h");
  if (!hash && parts[i + 1] && HASH_RE.test(parts[i + 1])) hash = parts[i + 1]; // vimeo.com/<id>/<hash>
  if (hash && !HASH_RE.test(hash)) return null;
  return { mediaId: parts[i], params: hash ? { hash: hash.toLowerCase() } : {} };
}

export const vimeoProvider = Object.freeze({
  id: "vimeo",
  label: "Vimeo",
  mode: "embedded",
  /** A bare numeric id is only accepted when the caller explicitly chose Vimeo (it is ambiguous otherwise). */
  parse(input, { explicit = false } = {}) {
    if (typeof input !== "string") return null;
    const value = input.trim();
    if (!value || value.length > 2048) return null;
    if (explicit && ID_RE.test(value)) return { mediaId: value, params: {} };
    return fromUrl(value);
  },
  explain: () => "That doesn't look like a Vimeo link (e.g. https://vimeo.com/123456789).",
});
