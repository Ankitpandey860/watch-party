import { randomUUID } from "node:crypto";
import { AppError, ERROR_CODES } from "../constants/errors.js";
import { hmacHex, randomOtp, safeEqual } from "../infra/crypto.js";
import { normalizeEmail } from "../utils/validators.js";

const INVALID = () => new AppError(ERROR_CODES.INVALID_CODE, "That code is incorrect or has expired.", 400);

/**
 * Email one-time codes.
 *  - 6 digits from a CSPRNG; only an HMAC (keyed with a server secret, bound to the challenge id
 *    and the email) is stored, so a leaked table cannot be brute-forced offline.
 *  - Short expiry, single use, limited attempts, new request invalidates older codes.
 *  - Anyone can request a code for any address (sign-in auto-creates the account), so there is no
 *    "does this account exist" oracle: responses never depend on prior registration.
 *  - A wrong, expired, used or exhausted code all return the same INVALID_CODE error.
 */
export function createOtpService({ db, config, mailer, hmacKey, now = Date.now }) {
  const macOf = (challengeId, email, code) => hmacHex(hmacKey, `${challengeId}:${email}:${code}`);

  return {
    async request(rawEmail) {
      const email = normalizeEmail(rawEmail);
      if (!email) throw new AppError(ERROR_CODES.INVALID_PAYLOAD, "Enter a valid email address.", 400);

      const t = now();
      const cooldownMs = config.otp.resendCooldownMs;
      const recent = (await db.query(
        `SELECT created_at FROM otp_challenges
         WHERE email = $1 AND invalidated_at IS NULL AND consumed_at IS NULL AND created_at > $2
         ORDER BY created_at DESC LIMIT 1`,
        [email, new Date(t - cooldownMs)],
      )).rows[0];
      if (recent) {
        const wait = Math.ceil((new Date(recent.created_at).getTime() + cooldownMs - t) / 1000);
        return { ok: true, resendAfterSeconds: Math.max(1, wait) }; // same shape; no second email
      }

      // A fresh code replaces every earlier one for this address.
      await db.query(
        "UPDATE otp_challenges SET invalidated_at = $2 WHERE email = $1 AND consumed_at IS NULL AND invalidated_at IS NULL",
        [email, new Date(t)],
      );

      const id = randomUUID();
      const code = randomOtp();
      await db.query(
        `INSERT INTO otp_challenges (id, email, code_hmac, created_at, expires_at, max_attempts) VALUES ($1,$2,$3,$4,$5,$6)`,
        [id, email, macOf(id, email, code), new Date(t), new Date(t + config.otp.ttlMs), config.otp.maxAttempts],
      );

      try {
        await mailer.sendOtp({ to: email, code, ttlMinutes: Math.round(config.otp.ttlMs / 60_000) });
      } catch (err) {
        await db.query("UPDATE otp_challenges SET invalidated_at = $2 WHERE id = $1", [id, new Date(now())]);
        throw err;
      }
      return { ok: true, resendAfterSeconds: Math.ceil(cooldownMs / 1000) };
    },

    /** Returns the verified, normalised email on success; throws INVALID_CODE otherwise. */
    async verify(rawEmail, rawCode) {
      const email = normalizeEmail(rawEmail);
      const code = typeof rawCode === "string" ? rawCode.trim() : "";
      if (!email || !/^\d{6}$/.test(code)) throw INVALID();

      const t = new Date(now());
      const challenge = (await db.query(
        `SELECT id, code_hmac FROM otp_challenges
         WHERE email = $1 AND consumed_at IS NULL AND invalidated_at IS NULL AND expires_at > $2
         ORDER BY created_at DESC LIMIT 1`,
        [email, t],
      )).rows[0];
      if (!challenge) throw INVALID();

      // Count the attempt BEFORE comparing, atomically, so concurrent guesses cannot exceed the cap.
      const attempt = (await db.query(
        `UPDATE otp_challenges SET attempts = attempts + 1
         WHERE id = $1 AND attempts < max_attempts AND consumed_at IS NULL AND invalidated_at IS NULL
         RETURNING attempts, max_attempts`,
        [challenge.id],
      )).rows[0];
      if (!attempt) throw INVALID();

      if (!safeEqual(macOf(challenge.id, email, code), challenge.code_hmac)) {
        if (attempt.attempts >= attempt.max_attempts) {
          await db.query("UPDATE otp_challenges SET invalidated_at = $2 WHERE id = $1", [challenge.id, t]);
        }
        throw INVALID();
      }

      // Single use: only one concurrent redeemer can flip consumed_at.
      const consumed = await db.query(
        "UPDATE otp_challenges SET consumed_at = $2 WHERE id = $1 AND consumed_at IS NULL AND invalidated_at IS NULL RETURNING id",
        [challenge.id, t],
      );
      if (!consumed.rows[0]) throw INVALID();
      return email;
    },
  };
}
