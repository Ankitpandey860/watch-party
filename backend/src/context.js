import { config as defaultConfig } from "./config/env.js";
import { createDb } from "./db/index.js";
import { deriveKey } from "./infra/crypto.js";
import { createMailer } from "./infra/mailer.js";
import { WindowLimiter } from "./infra/rateLimiter.js";
import { createSessionService } from "./services/sessionService.js";
import { createUserService } from "./services/userService.js";
import { createOtpService } from "./services/otpService.js";
import { createTicketService } from "./services/ticketService.js";
import { createGoogleAuthService } from "./services/googleAuthService.js";
import { providerRegistry } from "./providers/registry.js";
import { roomManager } from "./services/roomManager.js";
import { logger } from "./utils/logger.js";

/**
 * Composition root: builds every service once and wires dependencies. Anything that touches the
 * outside world (database, SMTP transport, Google fetch/JWKS, clock) can be injected, which is
 * how the test-suite runs the whole stack without network access.
 */
export async function createContext({
  config = defaultConfig,
  db = null,
  mailerTransport = null,
  googleFetch = undefined,
  googleJwks = null,
  now = Date.now,
} = {}) {
  const database = db || (await createDb(config.databaseUrl));
  const mailer = createMailer({ smtp: config.smtp, transport: mailerTransport });
  const sessions = createSessionService({ db: database, config, now });
  const users = createUserService({ db: database, now });
  const otp = createOtpService({
    db: database, config, mailer, now, hmacKey: deriveKey(config.sessionSecret, "otp-hmac"),
  });
  const tickets = createTicketService({ ttlMs: config.socket.ticketTtlMs, now });
  const google = createGoogleAuthService({ config, fetchImpl: googleFetch, jwks: googleJwks, now });

  const L = config.limits;
  const mk = (max, windowMs = L.windowMs) => new WindowLimiter({ windowMs, max });
  const limiters = {
    otpRequestIp: mk(L.otpRequestPerIp),
    otpRequestEmail: mk(L.otpRequestPerEmail),
    otpVerifyIp: mk(L.otpVerifyPerIp),
    otpVerifyEmail: mk(L.otpVerifyPerEmail),
    guestIp: mk(L.guestPerIp),
    roomCreateUser: mk(L.roomCreatePerUser),
    roomCreateIp: mk(L.roomCreatePerIp),
    roomLookupIp: mk(L.roomLookupPerIp, 60_000),
    ticketSession: mk(L.ticketPerSession, 60_000),
    oauthIp: mk(L.oauthStartPerIp),
    apiIp: mk(L.apiPerIp, 60_000),
  };

  let maintenance = null;
  return {
    config, db: database, sessions, users, otp, tickets, google, mailer, limiters,
    rooms: roomManager,
    providers: providerRegistry,
    startMaintenance() {
      roomManager.startSweeper();
      maintenance = setInterval(() => {
        tickets.sweep();
        sessions.cleanupExpired().catch((err) => logger.warn(`Session cleanup failed (${err?.code || "error"})`));
      }, 60 * 60_000);
      maintenance.unref?.();
    },
    async close() {
      roomManager.stopSweeper();
      if (maintenance) clearInterval(maintenance);
      await database.end();
    },
  };
}
