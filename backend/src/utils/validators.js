// Shared input normalisation. Every external string goes through one of these before use.

// Control chars, zero-width and bidi-override characters (used for spoofing / invisible names).
const UNSAFE_CHARS = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/g;

export const MAX_DISPLAY_NAME = 20;

/** Returns a clean display name (1-20 chars) or "" if there is nothing usable. */
export function normalizeDisplayName(raw) {
  if (typeof raw !== "string") return "";
  const cleaned = raw.replace(UNSAFE_CHARS, "").replace(/\s+/g, " ").trim();
  return Array.from(cleaned).slice(0, MAX_DISPLAY_NAME).join("").trim();
}

/** True when the raw name is usable but would be altered/truncated (so callers can reject instead of silently cutting). */
export function isDisplayNameTooLong(raw) {
  return typeof raw === "string" && Array.from(raw.replace(UNSAFE_CHARS, "").replace(/\s+/g, " ").trim()).length > MAX_DISPLAY_NAME;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Lower-cased, trimmed address, or null if it is not a plausible email. */
export function normalizeEmail(raw) {
  if (typeof raw !== "string") return null;
  const email = raw.trim().toLowerCase();
  if (email.length < 6 || email.length > 254) return null;
  if (UNSAFE_CHARS.test(email)) { UNSAFE_CHARS.lastIndex = 0; return null; }
  UNSAFE_CHARS.lastIndex = 0;
  return EMAIL_RE.test(email) ? email : null;
}

/** Only same-site relative paths are allowed as post-login destinations (no open redirects). */
export function safeReturnTo(raw, fallback = "/") {
  if (typeof raw !== "string" || raw.length > 200) return fallback;
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\") || /[\u0000-\u001f]/.test(raw)) return fallback;
  return raw;
}

/** A friendly default display name from an email address's local part. */
export function nameFromEmail(email) {
  const local = String(email).split("@")[0].replace(/[._+-]+/g, " ");
  return normalizeDisplayName(local.charAt(0).toUpperCase() + local.slice(1)) || "Guest";
}
