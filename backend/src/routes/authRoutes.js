import { Router } from "express";
import { AppError, ERROR_CODES } from "../constants/errors.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { createRateLimitMiddleware } from "../infra/rateLimiter.js";
import { requireAuth } from "../middlewares/auth.js";
import { clearSessionCookie, parseCookies, sessionCookieOptions, setSessionCookie } from "../http/cookies.js";
import { OAUTH_COOKIE } from "../services/googleAuthService.js";
import { isDisplayNameTooLong, normalizeDisplayName, normalizeEmail, safeReturnTo } from "../utils/validators.js";
import { normalizeRoomId } from "../utils/idGenerator.js";
import { roomManager } from "../services/roomManager.js";
import { logger } from "../utils/logger.js";

export const publicPrincipal = (p) => (p ? { id: p.id, kind: p.kind, displayName: p.displayName } : null);

export function createAuthRoutes(ctx) {
  const { config, sessions, users, otp, google, tickets, limiters, mailer } = ctx;
  const router = Router();
  const disabled = config.limits.disabled;
  const rl = (name, limiter, keyFn) => createRateLimitMiddleware({ name, limiter, keyFn, disabled });

  /** Signs `user` in: new session (rotation), old session revoked, cookie set. */
  async function startUserSession(req, res, user) {
    const { token, maxAgeMs, principal } = await sessions.createUserSession(user);
    if (req.principal) await sessions.revoke(req.principal.sessionId, "rotated"); // no session fixation
    setSessionCookie(res, config, token, maxAgeMs);
    return principal;
  }

  function cleanName(raw) {
    const name = normalizeDisplayName(raw);
    if (!name) throw new AppError(ERROR_CODES.USERNAME_REQUIRED, "Please enter a display name.", 400);
    if (isDisplayNameTooLong(raw)) throw new AppError(ERROR_CODES.INVALID_PAYLOAD, "Display name must be 20 characters or fewer.", 400);
    return name;
  }

  // Who am I, and which sign-in methods does this deployment actually offer?
  router.get("/me", (req, res) => {
    res.json({
      principal: publicPrincipal(req.principal),
      providers: { google: google.enabled, email: mailer.enabled },
    });
  });

  router.patch("/me", requireAuth, asyncHandler(async (req, res) => {
    const updated = await sessions.setDisplayName(req.principal, cleanName(req.body?.displayName));
    res.json({ principal: publicPrincipal(updated) });
  }));

  // Guest identity (invite-link flow): short-lived, can watch and chat, can never host or moderate.
  router.post("/guest", rl("guest", limiters.guestIp, (req) => req.ip), asyncHandler(async (req, res) => {
    const name = cleanName(req.body?.displayName);
    if (req.principal) {
      const principal = req.principal.kind === "guest" ? await sessions.setDisplayName(req.principal, name) : req.principal;
      return res.json({ principal: publicPrincipal(principal) });
    }
    const { token, maxAgeMs, principal } = await sessions.createGuestSession(name);
    setSessionCookie(res, config, token, maxAgeMs);
    return res.status(201).json({ principal: publicPrincipal(principal) });
  }));

  router.post("/logout", asyncHandler(async (req, res) => {
    if (req.principal) await sessions.revoke(req.principal.sessionId, "logout");
    clearSessionCookie(res, config);
    res.json({ ok: true });
  }));

  // ---- Email one-time code ----------------------------------------------------------------
  router.post(
    "/otp/request",
    rl("otp-req-ip", limiters.otpRequestIp, (req) => req.ip),
    rl("otp-req-email", limiters.otpRequestEmail, (req) => normalizeEmail(req.body?.email)),
    asyncHandler(async (req, res) => {
      res.json(await otp.request(req.body?.email));
    }),
  );

  router.post(
    "/otp/verify",
    rl("otp-ver-ip", limiters.otpVerifyIp, (req) => req.ip),
    rl("otp-ver-email", limiters.otpVerifyEmail, (req) => normalizeEmail(req.body?.email)),
    asyncHandler(async (req, res) => {
      const email = await otp.verify(req.body?.email, req.body?.code);
      const { user, created } = await users.resolveIdentity({ provider: "email", subject: email, email, emailVerified: true });
      const principal = await startUserSession(req, res, user);
      res.status(created ? 201 : 200).json({ principal: publicPrincipal(principal), created });
    }),
  );

  // ---- Google (authorization code + PKCE) ------------------------------------------------
  const authPage = (error) => `${config.frontendUrl}/auth?error=${error}`;
  const hostOf = (u) => { try { return new URL(u).hostname; } catch { return ""; } };
  const redirectHost = hostOf(config.google.redirectUri);
  let warnedHostMismatch = false;

  /** One log line that says WHICH stage failed. Only stage names, codes, statuses and sanitised text: never tokens/codes/secrets. */
  const describeFailure = (err, req, cookiePresent) => {
    const d = err?.diag;
    if (!d) return `stage=post-auth code=${err?.code || err?.name || "error"}`; // e.g. the account lookup or session creation failed
    const parts = [`stage=${d.stage}`];
    if (d.status) parts.push(`status=${d.status}`);
    if (d.oauthError) parts.push(`oauth_error=${d.oauthError}`);
    if (d.code) parts.push(`code=${d.code}`);
    if (d.claim) parts.push(`claim=${d.claim}`);
    if (d.reason) parts.push(`reason=${d.reason}`);
    if (d.detail) parts.push(`detail="${d.detail}"`);
    if (d.stage === "flow-cookie-missing" || d.stage === "flow-cookie-invalid") {
      // The sign-in was started on one origin and Google sent the browser back to another (or the secret changed).
      parts.push(`callbackHost=${req.hostname} redirectUriHost=${redirectHost} flowCookie=${cookiePresent ? "present" : "absent"}`);
      parts.push("hint=the flow cookie is set on the host that served /google/start; GOOGLE_REDIRECT_URI must be on that same host (with the Vercel rewrite: your Vercel URL)");
    }
    return parts.join(" ");
  };

  router.get("/google/start", rl("oauth-start", limiters.oauthIp, (req) => req.ip), (req, res) => {
    if (!google.enabled) return res.redirect(302, authPage("google_unavailable"));
    // Misconfiguration check (log only): the flow cookie is stored for the host that serves this request, but Google
    // will send the browser back to GOOGLE_REDIRECT_URI. If those hosts differ the callback never sees the cookie.
    if (!warnedHostMismatch && redirectHost && req.hostname && req.hostname !== redirectHost) {
      warnedHostMismatch = true;
      logger.warn(`Google sign-in misconfiguration: /google/start was served for host "${req.hostname}" but GOOGLE_REDIRECT_URI is on "${redirectHost}". The flow cookie will not reach the callback. Set GOOGLE_REDIRECT_URI to https://${req.hostname}/api/auth/google/callback and register that exact URI in Google Cloud Console.`);
    }
    const { url, cookie, maxAgeMs } = google.start(safeReturnTo(req.query.returnTo));
    res.cookie(OAUTH_COOKIE, cookie, { ...sessionCookieOptions(config, maxAgeMs), path: "/api/auth/google" });
    return res.redirect(302, url);
  });

  router.get("/google/callback", asyncHandler(async (req, res) => {
    const clearFlow = () => res.clearCookie(OAUTH_COOKIE, { ...sessionCookieOptions(config), path: "/api/auth/google" });
    const sealed = parseCookies(req.headers.cookie)[OAUTH_COOKIE];
    clearFlow(); // single use, whatever happens next
    if (req.query.error) return res.redirect(302, authPage(req.query.error === "access_denied" ? "cancelled" : "oauth_failed"));
    try {
      const { profile, returnTo } = await google.complete({ code: req.query.code, state: req.query.state, cookie: sealed });
      if (!profile.emailVerified) return res.redirect(302, authPage("email_unverified"));
      const { user } = await users.resolveIdentity({
        provider: "google", subject: profile.sub, email: profile.email, emailVerified: true, displayName: profile.name,
      });
      await startUserSession(req, res, user);
      return res.redirect(302, `${config.frontendUrl}${safeReturnTo(returnTo)}`);
    } catch (err) {
      logger.warn(`Google sign-in failed: ${describeFailure(err, req, Boolean(sealed))}`); // never log tokens/codes
      return res.redirect(302, authPage("oauth_failed"));
    }
  }));

  // ---- Socket handshake ticket -------------------------------------------------------------
  router.post(
    "/socket-ticket",
    requireAuth,
    rl("ticket", limiters.ticketSession, (req) => req.principal?.sessionId),
    asyncHandler(async (req, res) => {
      const roomId = normalizeRoomId(req.body?.roomId);
      const room = roomManager.getRoom(roomId);
      if (!room) throw new AppError(ERROR_CODES.ROOM_NOT_FOUND, "This room doesn't exist or has ended.", 404);
      if (room.isBanned(req.principal.id)) throw new AppError(ERROR_CODES.BANNED, "You were removed from this room.", 403);
      const ticket = tickets.issue({ sessionId: req.principal.sessionId, roomId });
      res.json({ ticket, expiresInSeconds: tickets.ttlSeconds });
    }),
  );

  return router;
}
