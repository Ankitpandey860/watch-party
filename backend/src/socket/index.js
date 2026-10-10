import { Server } from "socket.io";
import { socketCorsOptions, isAllowedOrigin } from "../config/cors.js";
import { SERVER_EVENTS } from "../constants/events.js";
import { registerRoomHandlers } from "./handlers/roomHandlers.js";
import { registerPlaybackHandlers } from "./handlers/playbackHandlers.js";
import { registerRoleHandlers } from "./handlers/roleHandlers.js";
import { registerChatHandlers } from "./handlers/chatHandlers.js";
import { logger } from "../utils/logger.js";

// Largest single Socket.IO packet accepted. Legitimate packets are tiny (chat is capped at 500
// chars); the library default of 1 MB would let any client make the server buffer huge payloads.
export const MAX_SOCKET_PAYLOAD_BYTES = 16 * 1024;

const MAX_TIMER_MS = 2 ** 31 - 1;

function authError(code) {
  const err = new Error(code);
  err.data = { code };
  return err;
}

/**
 * Socket.IO server. Identity comes ONLY from a one-time handshake ticket that the REST API minted
 * for an authenticated session; nothing the client says (userId, role, isHost...) is trusted.
 */
export function initSocket(httpServer, ctx) {
  const { sessions, tickets, config } = ctx;
  const io = new Server(httpServer, {
    cors: socketCorsOptions,
    maxHttpBufferSize: MAX_SOCKET_PAYLOAD_BYTES,
    // Browsers from non-allowlisted origins are refused at the HTTP upgrade. Non-browser clients send
    // no Origin; they still cannot do anything without a valid ticket.
    allowRequest: (req, cb) => {
      const origin = req.headers.origin;
      cb(null, !origin || isAllowedOrigin(origin, config.corsOrigins));
    },
  });

  // sessionId -> sockets using it, so logout/revocation can cut them off immediately.
  const bySession = new Map();

  sessions.onRevoked((sessionIds, reason) => {
    for (const id of sessionIds) {
      for (const s of [...(bySession.get(id) || [])]) {
        s.emit(SERVER_EVENTS.AUTH_EXPIRED, { reason });
        s.disconnect(true);
      }
    }
  });

  // Handshake: consume the single-use ticket, then re-check the session is still valid.
  io.use(async (socket, next) => {
    try {
      const ticket = tickets.consume(socket.handshake.auth?.ticket);
      if (!ticket) return next(authError("TICKET_INVALID"));
      const principal = await sessions.validateSessionId(ticket.sessionId);
      if (!principal) return next(authError("SESSION_EXPIRED"));
      socket.data.principal = principal;
      socket.data.ticketRoomId = ticket.roomId;
      return next();
    } catch (err) {
      logger.error("Socket auth failure:", err?.code || err?.name);
      return next(authError("AUTH_FAILED"));
    }
  });

  io.on("connection", (socket) => {
    const { principal } = socket.data;
    socket.data.roomId = null; // set by a successful join_room
    socket.data.userId = principal.id; // server-derived, never client-supplied

    if (!bySession.has(principal.sessionId)) bySession.set(principal.sessionId, new Set());
    bySession.get(principal.sessionId).add(socket);

    // A session that expires while connected ends the socket at the moment of expiry.
    const msLeft = principal.expiresAt - Date.now();
    const expiryTimer = setTimeout(() => {
      socket.emit(SERVER_EVENTS.AUTH_EXPIRED, { reason: "expired" });
      socket.disconnect(true);
    }, Math.min(Math.max(msLeft, 0), MAX_TIMER_MS));
    expiryTimer.unref?.();

    socket.on("disconnect", () => {
      clearTimeout(expiryTimer);
      const set = bySession.get(principal.sessionId);
      if (set) {
        set.delete(socket);
        if (set.size === 0) bySession.delete(principal.sessionId);
      }
    });

    registerRoomHandlers(io, socket);
    registerPlaybackHandlers(io, socket);
    registerRoleHandlers(io, socket);
    registerChatHandlers(io, socket);
  });

  return io;
}

export default initSocket;
