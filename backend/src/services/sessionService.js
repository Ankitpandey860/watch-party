import { randomUUID } from "node:crypto";
import { randomToken, sha256Hex } from "../infra/crypto.js";

const TOUCH_INTERVAL_MS = 5 * 60_000; // refresh last_seen at most this often (limits DB writes)

/**
 * Server-managed sessions. The browser holds only an opaque random token (HttpOnly cookie);
 * the database holds only its SHA-256, so a database leak does not yield usable sessions.
 *
 * A "principal" is the authenticated identity the rest of the app works with:
 *   { id, kind: "user" | "guest", displayName, sessionId, expiresAt }
 */
export function createSessionService({ db, config, now = Date.now }) {
  const revokeListeners = new Set();

  const toPrincipal = (row) => ({
    id: row.kind === "user" ? row.user_id : row.guest_id,
    kind: row.kind,
    displayName: row.kind === "user" ? row.user_name : row.display_name,
    sessionId: row.id,
    expiresAt: new Date(row.expires_at).getTime(),
  });

  const SELECT = `
    SELECT s.id, s.kind, s.user_id, s.guest_id, s.display_name, s.expires_at, s.last_seen_at, u.display_name AS user_name
    FROM sessions s LEFT JOIN users u ON u.id = s.user_id`;

  async function insert({ kind, userId = null, guestId = null, displayName, ttlMs }) {
    const token = randomToken(32);
    const id = randomUUID();
    const t = now();
    await db.query(
      `INSERT INTO sessions (id, token_hash, kind, user_id, guest_id, display_name, created_at, last_seen_at, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$7,$8)`,
      [id, sha256Hex(token), kind, userId, guestId, displayName, new Date(t), new Date(t + ttlMs)],
    );
    return { token, maxAgeMs: ttlMs, principal: { id: userId ?? guestId, kind, displayName, sessionId: id, expiresAt: t + ttlMs } };
  }

  return {
    createUserSession: (user) =>
      insert({ kind: "user", userId: user.id, displayName: user.display_name, ttlMs: config.session.userTtlMs }),

    createGuestSession: (displayName) =>
      insert({ kind: "guest", guestId: randomUUID(), displayName, ttlMs: config.session.guestTtlMs }),

    /** Cookie token -> principal, or null when unknown / revoked / expired. */
    async authenticate(token) {
      if (typeof token !== "string" || token.length < 20 || token.length > 128) return null;
      const t = now();
      const { rows } = await db.query(
        `${SELECT} WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > $2`,
        [sha256Hex(token), new Date(t)],
      );
      if (!rows[0]) return null;
      if (t - new Date(rows[0].last_seen_at).getTime() > TOUCH_INTERVAL_MS) {
        db.query("UPDATE sessions SET last_seen_at = $2 WHERE id = $1", [rows[0].id, new Date(t)]).catch(() => {});
      }
      return toPrincipal(rows[0]);
    },

    /** Re-checks a session by id (socket handshake): still present, not revoked, not expired. */
    async validateSessionId(sessionId) {
      const { rows } = await db.query(
        `${SELECT} WHERE s.id = $1 AND s.revoked_at IS NULL AND s.expires_at > $2`,
        [sessionId, new Date(now())],
      );
      return rows[0] ? toPrincipal(rows[0]) : null;
    },

    /** `reason` is forwarded to the socket layer: "logout" | "revoked" | "rotated" (re-login). */
    async revoke(sessionId, reason = "revoked") {
      await db.query("UPDATE sessions SET revoked_at = $2 WHERE id = $1 AND revoked_at IS NULL", [sessionId, new Date(now())]);
      for (const fn of revokeListeners) fn([sessionId], reason);
    },

    async revokeAllForUser(userId, reason = "revoked") {
      const { rows } = await db.query(
        "UPDATE sessions SET revoked_at = $2 WHERE user_id = $1 AND revoked_at IS NULL RETURNING id",
        [userId, new Date(now())],
      );
      if (rows.length) for (const fn of revokeListeners) fn(rows.map((r) => r.id), reason);
    },

    /** Sockets bound to a revoked session are disconnected through this hook. */
    onRevoked(fn) {
      revokeListeners.add(fn);
      return () => revokeListeners.delete(fn);
    },

    async setDisplayName(principal, displayName) {
      if (principal.kind === "user") {
        await db.query("UPDATE users SET display_name = $2 WHERE id = $1", [principal.id, displayName]);
      }
      await db.query("UPDATE sessions SET display_name = $2 WHERE id = $1", [principal.sessionId, displayName]);
      return { ...principal, displayName };
    },

    async cleanupExpired() {
      const cutoff = new Date(now() - 24 * 3_600_000);
      const s = await db.query("DELETE FROM sessions WHERE expires_at < $1 OR revoked_at < $1", [cutoff]);
      const o = await db.query("DELETE FROM otp_challenges WHERE expires_at < $1", [cutoff]);
      return { sessions: s.rowCount, otp: o.rowCount };
    },
  };
}
