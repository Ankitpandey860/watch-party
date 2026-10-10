import {
  createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync,
  randomBytes, randomInt, timingSafeEqual,
} from "node:crypto";

/** URL-safe random token (default 256 bits). */
export const randomToken = (bytes = 32) => randomBytes(bytes).toString("base64url");

export const sha256Hex = (value) => createHash("sha256").update(value).digest("hex");
export const sha256Base64Url = (value) => createHash("sha256").update(value).digest("base64url");

/** Derives an independent 32-byte key for one purpose from the master secret (HKDF-SHA256). */
export function deriveKey(secret, purpose) {
  return Buffer.from(hkdfSync("sha256", secret, "watch-party/v1", purpose, 32));
}

export const hmacHex = (key, message) => createHmac("sha256", key).update(message).digest("hex");

/** Constant-time string comparison (safe for different lengths). */
export function safeEqual(a, b) {
  const ha = createHash("sha256").update(String(a)).digest();
  const hb = createHash("sha256").update(String(b)).digest();
  return timingSafeEqual(ha, hb) && String(a).length === String(b).length;
}

/** Uniformly random 6-digit code from a CSPRNG, zero-padded. */
export const randomOtp = () => String(randomInt(0, 1_000_000)).padStart(6, "0");

/** AES-256-GCM seal/open for short-lived cookie payloads (OAuth state + PKCE verifier). */
export function seal(key, obj) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(obj), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64url");
}

export function open(key, sealed) {
  try {
    const buf = Buffer.from(String(sealed), "base64url");
    if (buf.length < 29) return null;
    const decipher = createDecipheriv("aes-256-gcm", key, buf.subarray(0, 12));
    decipher.setAuthTag(buf.subarray(12, 28));
    const plain = Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]);
    return JSON.parse(plain.toString("utf8"));
  } catch {
    return null; // tampered, truncated or wrong key
  }
}
