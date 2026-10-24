import { randomToken, sha256Hex } from "../infra/crypto.js";

const MAX_TICKETS = 10_000;

/**
 * One-time Socket.IO handshake tickets. REST authenticates the user (cookie) and mints a ticket
 * bound to ONE room; the socket presents it once. Only the SHA-256 is kept, so a memory dump does
 * not yield usable tickets, and a ticket cannot be replayed or used for another room.
 * In-memory: valid for a single backend instance (a ticket is consumed within seconds of issue).
 */
export function createTicketService({ ttlMs, now = Date.now }) {
  const tickets = new Map(); // hash -> { sessionId, roomId, expiresAt }

  function sweep() {
    const t = now();
    for (const [k, v] of tickets) if (v.expiresAt <= t) tickets.delete(k);
  }

  return {
    ttlSeconds: Math.round(ttlMs / 1000),
    issue({ sessionId, roomId, credentialId = null }) {
      if (tickets.size >= MAX_TICKETS) sweep();
      if (tickets.size >= MAX_TICKETS) tickets.delete(tickets.keys().next().value); // oldest
      const ticket = randomToken(32);
      tickets.set(sha256Hex(ticket), { sessionId, roomId, credentialId, expiresAt: now() + ttlMs });
      return ticket;
    },
    /** Returns { sessionId, roomId, credentialId } the first time only, and only before expiry. */
    consume(ticket) {
      if (typeof ticket !== "string" || ticket.length < 20 || ticket.length > 128) return null;
      const key = sha256Hex(ticket);
      const entry = tickets.get(key);
      if (!entry) return null;
      tickets.delete(key); // single use, even if expired
      return entry.expiresAt > now() ? { sessionId: entry.sessionId, roomId: entry.roomId, credentialId: entry.credentialId } : null;
    },
    sweep,
    get size() { return tickets.size; },
  };
}
