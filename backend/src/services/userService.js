import { randomUUID } from "node:crypto";
import { AppError, ERROR_CODES } from "../constants/errors.js";
import { normalizeDisplayName, normalizeEmail, nameFromEmail } from "../utils/validators.js";

/**
 * Account resolution and linking.
 *
 * Rules (the whole point of this file):
 *  1. An identity is only ever stored once its email is VERIFIED: a Google ID token with
 *     email_verified=true, or an email OTP that was just redeemed. Unverified emails are rejected.
 *  2. (provider, subject) is unique; the same Google `sub` or the same email always resolves to
 *     the same user.
 *  3. A NEW identity whose verified email matches an existing user is attached to that user.
 *     This is safe only because rule 1 means BOTH sides have proven control of the address.
 *     Nothing is ever merged on an unverified claim, and existing users are never overwritten.
 */
export function createUserService({ db, now = Date.now }) {
  return {
    async resolveIdentity({ provider, subject, email, emailVerified, displayName }) {
      const normalizedEmail = normalizeEmail(email);
      if (!normalizedEmail || emailVerified !== true || !subject) {
        throw new AppError(ERROR_CODES.FORBIDDEN, "A verified email address is required.", 403);
      }
      const at = new Date(now());

      return db.tx(async (q) => {
        const byIdentity = await q.query(
          `SELECT u.* FROM auth_identities i JOIN users u ON u.id = i.user_id WHERE i.provider = $1 AND i.subject = $2`,
          [provider, subject],
        );
        let user = byIdentity.rows[0];
        let created = false;
        let linked = false;

        if (!user) {
          user = (await q.query("SELECT * FROM users WHERE email = $1", [normalizedEmail])).rows[0];
          if (!user) {
            const name = normalizeDisplayName(displayName) || nameFromEmail(normalizedEmail);
            const ins = await q.query(
              `INSERT INTO users (id, email, display_name, created_at, last_login_at) VALUES ($1,$2,$3,$4,$4)
               ON CONFLICT (email) DO NOTHING RETURNING *`,
              [randomUUID(), normalizedEmail, name, at],
            );
            user = ins.rows[0] || (await q.query("SELECT * FROM users WHERE email = $1", [normalizedEmail])).rows[0];
            created = Boolean(ins.rows[0]);
          } else {
            linked = true;
          }
          await q.query(
            `INSERT INTO auth_identities (id, user_id, provider, subject, email, email_verified_at, created_at)
             VALUES ($1,$2,$3,$4,$5,$6,$6) ON CONFLICT (provider, subject) DO NOTHING`,
            [randomUUID(), user.id, provider, subject, normalizedEmail, at],
          );
        }

        await q.query("UPDATE users SET last_login_at = $2 WHERE id = $1", [user.id, at]);
        return { user, created, linked };
      });
    },

    async getById(id) {
      return (await db.query("SELECT * FROM users WHERE id = $1", [id])).rows[0] || null;
    },

    async listIdentities(userId) {
      return (await db.query("SELECT provider, email, created_at FROM auth_identities WHERE user_id = $1 ORDER BY created_at", [userId])).rows;
    },
  };
}
