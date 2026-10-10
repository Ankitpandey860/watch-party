import { Router } from "express";
import { AppError, ERROR_CODES } from "../constants/errors.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { createRateLimitMiddleware } from "../infra/rateLimiter.js";
import { requireUser } from "../middlewares/auth.js";
import { roomService } from "../services/roomService.js";
import { setSessionCookie } from "../http/cookies.js";
import { isDisplayNameTooLong, normalizeDisplayName } from "../utils/validators.js";
import { publicPrincipal } from "./authRoutes.js";

export function createRoomRoutes(ctx) {
  const { config, sessions, limiters } = ctx;
  const router = Router();
  const disabled = config.limits.disabled;
  const rl = (name, limiter, keyFn) => createRateLimitMiddleware({ name, limiter, keyFn, disabled });

  // Create a room: signed-in accounts only. The creator becomes the owner/host.
  router.post(
    "/",
    requireUser,
    rl("room-create-user", limiters.roomCreateUser, (req) => req.principal?.id),
    rl("room-create-ip", limiters.roomCreateIp, (req) => req.ip),
    asyncHandler(async (req, res) => {
      res.status(201).json(roomService.createRoom({ principal: req.principal }));
    }),
  );

  // Public facts for the invite page (does it exist, how full is it).
  router.get("/:roomId", rl("room-lookup", limiters.roomLookupIp, (req) => req.ip), asyncHandler(async (req, res) => {
    res.json(roomService.getRoomInfo(req.params.roomId));
  }));

  // Admission check + (for people with no account) the guest identity, in ONE step so joining
  // via an invite link needs only a display name. Real membership is created when the socket joins.
  router.post(
    "/:roomId/join",
    rl("room-join", limiters.roomLookupIp, (req) => req.ip),
    asyncHandler(async (req, res) => {
      let principal = req.principal;
      const room = roomService.requireRoom(req.params.roomId);

      if (!principal) {
        const raw = req.body?.displayName;
        const name = normalizeDisplayName(raw);
        if (!name) throw new AppError(ERROR_CODES.USERNAME_REQUIRED, "Please enter a display name.", 400);
        if (isDisplayNameTooLong(raw)) throw new AppError(ERROR_CODES.INVALID_PAYLOAD, "Display name must be 20 characters or fewer.", 400);
        roomService.assertCanEnter(room.roomId, { id: "pending-guest" }); // full-room check before issuing an identity
        if (!disabled) {
          // Guest identities are cheap to mint, so creating them through an invite link is limited per IP too.
          const hit = limiters.guestIp.hit(`guest:${req.ip}`);
          if (!hit.allowed) {
            const retryAfterSeconds = Math.max(1, Math.ceil(hit.retryAfterMs / 1000));
            res.set("Retry-After", String(retryAfterSeconds));
            throw new AppError(ERROR_CODES.RATE_LIMITED, "Too many requests. Please slow down.", 429, { retryAfterSeconds });
          }
        }
        const created = await sessions.createGuestSession(name);
        setSessionCookie(res, config, created.token, created.maxAgeMs);
        principal = created.principal;
      } else {
        roomService.assertCanEnter(room.roomId, principal);
        const raw = req.body?.displayName;
        if (principal.kind === "guest" && typeof raw === "string" && raw.trim()) {
          const name = normalizeDisplayName(raw);
          if (name && name !== principal.displayName) principal = await sessions.setDisplayName(principal, name);
        }
      }
      res.json({ roomId: room.roomId, principal: publicPrincipal(principal) });
    }),
  );

  return router;
}
