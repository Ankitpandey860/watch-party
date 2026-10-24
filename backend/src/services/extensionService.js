import { randomUUID, randomInt } from "node:crypto";
import { randomToken, sha256Hex } from "../infra/crypto.js";

// No 0/O/1/I/L so a code read aloud or off a screen is hard to mistype. 31 symbols x 8 = ~39.6 bits.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LEN = 8;
const MAX_PENDING = 5_000;
export const TOKEN_PREFIX = "wpx_";

export const normalizeCode = (raw) =>
  typeof raw === "string" ? raw.toUpperCase().replace(/[\s-]/g, "") : "";
export const isWellFormedCode = (c) => c.length === CODE_LEN && [...c].every((ch) => ALPHABET.includes(ch));
const formatCode = (c) => `${c.slice(0, 4)}-${c.slice(4)}`;

/**
 * Pairing codes (in-memory, single use, short lived, only a hash is kept) and revocable extension
 * credentials (database, only a hash is kept). The credential is scoped to ONE room and ONE session
 * and can only ever (a) mint companion socket tickets and (b) read its own status.
 */
export function createExtensionService({ db, config, sessions, now = Date.now }) {
  const pending = new Map(); // codeHash -> { sessionId, principalId, roomId, expiresAt }
  const revokeListeners = new Set();
  const ttl = config.extension;

  function sweepPending() {
    const t = now();
    for (const [k, v] of pending) if (v.expiresAt <= t) pending.delete(k);
  }

  const notifyRevoked = (ids, reason) => { if (ids.length) for (const fn of revokeListeners) fn(ids, reason); };

  return {
    pairingTtlSeconds: Math.round(ttl.pairingTtlMs / 1000),

    /** Issues a fresh one-time code for (session, room); any earlier pending code of the same pair is voided. */
    createPairingCode({ principal, roomId }) {
      if (pending.size >= MAX_PENDING) sweepPending();
      if (pending.size >= MAX_PENDING) pending.delete(pending.keys().next().value);
      for (const [k, v] of pending) if (v.sessionId === principal.sessionId && v.roomId === roomId) pending.delete(k);
      let code = "";
      for (let i = 0; i < CODE_LEN; i++) code += ALPHABET[randomInt(ALPHABET.length)];
      pending.set(sha256Hex(code), {
        sessionId: principal.sessionId, principalId: principal.id, roomId, expiresAt: now() + ttl.pairingTtlMs,
      });
      return { code: formatCode(code), expiresInSeconds: Math.round(ttl.pairingTtlMs / 1000) };
    },

    /**
     * Exchanges a pairing code for a credential. The code is consumed on the FIRST lookup whether or
     * not it was still valid (replay protection). Re-pairing replaces the previous credential.
     */
    async redeem(rawCode, { label = "" } = {}) {
      const code = normalizeCode(rawCode);
      if (!isWellFormedCode(code)) return null;
      const key = sha256Hex(code);
      const entry = pending.get(key);
      if (!entry) return null;
      pending.delete(key);
      const t = now();
      if (entry.expiresAt <= t) return null;
      const principal = await sessions.validateSessionId(entry.sessionId);
      if (!principal) return null; // the pairing session ended meanwhile

      const replaced = await db.query(
        "UPDATE extension_credentials SET revoked_at = $3 WHERE session_id = $1 AND room_id = $2 AND revoked_at IS NULL RETURNING id",
        [entry.sessionId, entry.roomId, new Date(t)],
      );
      notifyRevoked(replaced.rows.map((r) => r.id), "replaced");

      const token = TOKEN_PREFIX + randomToken(32);
      const id = randomUUID();
      const expiresAt = Math.min(t + ttl.credentialTtlMs, principal.expiresAt);
      await db.query(
        `INSERT INTO extension_credentials (id, token_hash, session_id, principal_id, room_id, label, created_at, expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [id, sha256Hex(token), entry.sessionId, entry.principalId, entry.roomId, String(label).slice(0, 60), new Date(t), new Date(expiresAt)],
      );
      return { token, credentialId: id, roomId: entry.roomId, expiresAt };
    },

    /** Bearer token -> credential info, or null (unknown, revoked, expired, or its session ended). */
    async authenticate(token) {
      if (typeof token !== "string" || !token.startsWith(TOKEN_PREFIX) || token.length > 128) return null;
      const t = now();
      const { rows } = await db.query(
        `SELECT id, session_id, principal_id, room_id, label, expires_at FROM extension_credentials
         WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > $2`,
        [sha256Hex(token), new Date(t)],
      );
      return this._hydrate(rows[0]);
    },

    /** Same checks as authenticate, by id (used at socket handshake, after the ticket is consumed). */
    async validateCredentialId(id) {
      const { rows } = await db.query(
        `SELECT id, session_id, principal_id, room_id, label, expires_at FROM extension_credentials
         WHERE id = $1 AND revoked_at IS NULL AND expires_at > $2`,
        [id, new Date(now())],
      );
      return this._hydrate(rows[0]);
    },

    async _hydrate(row) {
      if (!row) return null;
      const principal = await sessions.validateSessionId(row.session_id);
      if (!principal || principal.id !== row.principal_id) return null;
      return {
        credentialId: row.id, sessionId: row.session_id, principalId: row.principal_id, roomId: row.room_id,
        label: row.label, expiresAt: new Date(row.expires_at).getTime(), principal,
      };
    },

    touch(id) {
      db.query("UPDATE extension_credentials SET last_seen_at = $2 WHERE id = $1", [id, new Date(now())]).catch(() => {});
    },

    /** Active credential for a (session, room) pair, for the web app's status panel. */
    async findActive({ sessionId, roomId }) {
      const { rows } = await db.query(
        `SELECT id, label, created_at, last_seen_at, expires_at FROM extension_credentials
         WHERE session_id = $1 AND room_id = $2 AND revoked_at IS NULL AND expires_at > $3`,
        [sessionId, roomId, new Date(now())],
      );
      return rows[0] || null;
    },

    async revokeById(id, reason = "revoked") {
      const { rows } = await db.query(
        "UPDATE extension_credentials SET revoked_at = $2 WHERE id = $1 AND revoked_at IS NULL RETURNING id", [id, new Date(now())],
      );
      notifyRevoked(rows.map((r) => r.id), reason);
      return rows.length > 0;
    },

    async revokeForSessionRoom({ sessionId, roomId }, reason = "revoked") {
      const { rows } = await db.query(
        "UPDATE extension_credentials SET revoked_at = $3 WHERE session_id = $1 AND room_id = $2 AND revoked_at IS NULL RETURNING id",
        [sessionId, roomId, new Date(now())],
      );
      notifyRevoked(rows.map((r) => r.id), reason);
      return rows.length;
    },

    async revokeForRoom(roomId, reason = "room_ended") {
      const { rows } = await db.query(
        "UPDATE extension_credentials SET revoked_at = $2 WHERE room_id = $1 AND revoked_at IS NULL RETURNING id", [roomId, new Date(now())],
      );
      notifyRevoked(rows.map((r) => r.id), reason);
    },

    onRevoked(fn) { revokeListeners.add(fn); return () => revokeListeners.delete(fn); },

    async cleanupExpired() {
      sweepPending();
      const cutoff = new Date(now() - 24 * 3_600_000);
      const r = await db.query("DELETE FROM extension_credentials WHERE expires_at < $1 OR revoked_at < $1", [cutoff]);
      return r.rowCount;
    },
    sweepPending,
    get pendingCount() { return pending.size; },
  };
}
