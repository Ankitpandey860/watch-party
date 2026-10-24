import { Router } from "express";
import { AppError, ERROR_CODES } from "../constants/errors.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { createRateLimitMiddleware } from "../infra/rateLimiter.js";
import { requireAuth } from "../middlewares/auth.js";
import { normalizeRoomId } from "../utils/idGenerator.js";
import { roomManager } from "../services/roomManager.js";

function bearer(req) {
  const h = req.headers.authorization;
  return typeof h === "string" && h.startsWith("Bearer ") ? h.slice(7).trim() : "";
}

/**
 * Two audiences, deliberately separated:
 *  - the WEB APP (cookie session + CSRF header): create a pairing code, see status, revoke;
 *  - the EXTENSION (no cookies, `Authorization: Bearer wpx_...`): redeem a code, mint a socket ticket.
 * An extension credential can do nothing else: it cannot create rooms, chat, or change roles.
 */
export function createExtensionRoutes(ctx) {
  const { config, extensions, tickets, limiters, companions } = ctx;
  const router = Router();
  const disabled = config.limits.disabled;
  const rl = (name, limiter, keyFn) => createRateLimitMiddleware({ name, limiter, keyFn, disabled });

  const requireCredential = asyncHandler(async (req, _res, next) => {
    const cred = await extensions.authenticate(bearer(req));
    if (!cred) throw new AppError(ERROR_CODES.PAIRING_INVALID, "This extension is not paired (or its pairing was revoked). Pair it again from the room.", 401);
    req.credential = cred;
    next();
  });

  // ---------------- web app ----------------
  router.post("/pairing", requireAuth,
    rl("ext-pair-create", limiters.extPairCreate, (req) => req.principal?.sessionId),
    asyncHandler(async (req, res) => {
      const roomId = normalizeRoomId(req.body?.roomId);
      const room = roomId && roomManager.getRoom(roomId);
      if (!room) throw new AppError(ERROR_CODES.ROOM_NOT_FOUND, "This room doesn't exist or has ended.", 404);
      if (!room.getParticipant(req.principal.id)) throw new AppError(ERROR_CODES.NOT_IN_ROOM, "Join the room first, then pair your extension.", 403);
      res.status(201).json(extensions.createPairingCode({ principal: req.principal, roomId }));
    }));

  router.get("/status", requireAuth, asyncHandler(async (req, res) => {
    const roomId = normalizeRoomId(req.query?.roomId);
    if (!roomId) throw new AppError(ERROR_CODES.INVALID_ROOM_ID, "roomId is required.", 400);
    const active = await extensions.findActive({ sessionId: req.principal.sessionId, roomId });
    res.json({
      paired: Boolean(active),
      connected: Boolean(active && companions.has(active.id)),
      label: active?.label || null,
      expiresAt: active ? new Date(active.expires_at).toISOString() : null,
    });
  }));

  router.post("/revoke", requireAuth, asyncHandler(async (req, res) => {
    const roomId = normalizeRoomId(req.body?.roomId);
    if (!roomId) throw new AppError(ERROR_CODES.INVALID_ROOM_ID, "roomId is required.", 400);
    const revoked = await extensions.revokeForSessionRoom({ sessionId: req.principal.sessionId, roomId }, "revoked");
    res.json({ revoked });
  }));

  // ---------------- extension ----------------
  router.post("/pair",
    rl("ext-pair-ip", limiters.extPairRedeemIp, (req) => req.ip),
    rl("ext-pair-global", limiters.extPairRedeemGlobal, () => "all"),
    asyncHandler(async (req, res) => {
      const label = typeof req.body?.label === "string" ? req.body.label.replace(/[^\w .()-]/g, "").trim() : "";
      const out = await extensions.redeem(req.body?.code, { label });
      // One answer for unknown / expired / already used / malformed: nothing to learn by probing.
      if (!out) throw new AppError(ERROR_CODES.PAIRING_INVALID, "That pairing code is invalid or has expired. Generate a new one in the room.", 400);
      res.status(201).json({ token: out.token, roomId: out.roomId, expiresAt: new Date(out.expiresAt).toISOString() });
    }));

  router.get("/me", requireCredential, (req, res) => {
    const room = roomManager.getRoom(req.credential.roomId);
    const me = room?.getParticipant(req.credential.principalId);
    extensions.touch(req.credential.credentialId);
    res.json({
      roomId: req.credential.roomId,
      roomActive: Boolean(room),
      inRoom: Boolean(me),
      expiresAt: new Date(req.credential.expiresAt).toISOString(),
    });
  });

  router.post("/socket-ticket", requireCredential,
    rl("ext-ticket", limiters.extTicket, (req) => req.credential.credentialId),
    asyncHandler(async (req, res) => {
      const { roomId, principalId, sessionId, credentialId } = req.credential;
      const room = roomManager.getRoom(roomId);
      if (!room) throw new AppError(ERROR_CODES.ROOM_NOT_FOUND, "This room doesn't exist or has ended.", 404);
      if (room.isBanned(principalId)) throw new AppError(ERROR_CODES.BANNED, "You were removed from this room.", 403);
      if (!room.getParticipant(principalId)) throw new AppError(ERROR_CODES.NOT_IN_ROOM, "Open the room in Watch Party first; the extension attaches to your seat there.", 409);
      extensions.touch(credentialId);
      res.json({ ticket: tickets.issue({ sessionId, roomId, credentialId }), expiresInSeconds: tickets.ttlSeconds });
    }));

  router.post("/disconnect", requireCredential, asyncHandler(async (req, res) => {
    await extensions.revokeById(req.credential.credentialId, "extension_disconnected");
    res.json({ revoked: true });
  }));

  return router;
}
