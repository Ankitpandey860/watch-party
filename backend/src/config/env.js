import dotenv from "dotenv";
import { randomBytes } from "node:crypto";

dotenv.config();

const num = (v, fallback) => {
  const n = Number(v);
  return v !== undefined && v !== "" && Number.isFinite(n) ? n : fallback;
};
const bool = (v, fallback) => (v === undefined || v === "" ? fallback : /^(1|true|yes)$/i.test(v));
const list = (raw, fallback) => {
  if (!raw) return fallback;
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
};
const stripSlash = (u) => (u ? u.replace(/\/+$/, "") : u);

/**
 * Builds the validated, frozen runtime configuration from an env map.
 * Pure (takes `env` as an argument) so tests can build configs without touching process.env.
 * Seconds-based variables accept fractions (used by tests to make timers fast).
 */
export function loadConfig(env = process.env) {
  const nodeEnv = env.NODE_ENV || "development";
  const isProduction = nodeEnv === "production";
  const isTest = nodeEnv === "test";

  let sessionSecret = env.SESSION_SECRET || "";
  const problems = [];
  if (isProduction) {
    if (sessionSecret.length < 32) problems.push("SESSION_SECRET must be set to a random string of at least 32 characters");
    if (!env.DATABASE_URL) problems.push("DATABASE_URL is required");
    if (!env.FRONTEND_URL) problems.push("FRONTEND_URL is required");
  } else if (sessionSecret.length < 32) {
    // Dev/test only: an ephemeral secret. Sessions will not survive a restart (OTP/oauth cookies too).
    sessionSecret = randomBytes(32).toString("hex");
  }
  if (problems.length) {
    throw new Error(`Invalid configuration:\n - ${problems.join("\n - ")}`);
  }

  const frontendUrl = stripSlash(env.FRONTEND_URL) || "http://localhost:5173";
  const backendUrl = stripSlash(env.BACKEND_URL) || `http://localhost:${num(env.PORT, 4000)}`;
  const corsOrigins = list(env.ALLOWED_ORIGINS || env.CORS_ORIGIN, [
    frontendUrl,
    "http://localhost:3000",
    "http://localhost:5173",
  ]).map(stripSlash);
  const uniqueOrigins = [...new Set(corsOrigins)];

  const cookieSecure = bool(env.COOKIE_SECURE, isProduction);
  const cookieDomain = env.COOKIE_DOMAIN || "";

  return Object.freeze({
    nodeEnv,
    isProduction,
    isTest,
    port: num(env.PORT, 4000),
    frontendUrl,
    backendUrl,
    corsOrigins: uniqueOrigins,
    databaseUrl: env.DATABASE_URL || "",
    // Embedded dev databases (pglite://) start empty, so they migrate automatically; real servers
    // are migrated explicitly with `npm run migrate` (or AUTO_MIGRATE=true).
    autoMigrate: bool(env.AUTO_MIGRATE, (env.DATABASE_URL || "").startsWith("pglite://")),
    sessionSecret,
    cookie: Object.freeze({
      secure: cookieSecure,
      domain: cookieDomain,
      // "__Host-" cookies must be Secure, Path=/ and have NO Domain attribute.
      name: cookieSecure && !cookieDomain ? "__Host-wp_session" : "wp_session",
    }),
    // How many reverse proxies sit in front of the app (Render's load balancer = 1).
    // Used for client-IP detection; wrong values weaken IP-based rate limits.
    trustProxyHops: num(env.TRUST_PROXY_HOPS, 1),
    google: Object.freeze({
      clientId: env.GOOGLE_CLIENT_ID || "",
      clientSecret: env.GOOGLE_CLIENT_SECRET || "",
      redirectUri: env.GOOGLE_REDIRECT_URI || `${backendUrl}/api/auth/google/callback`,
      enabled: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
    }),
    smtp: Object.freeze({
      host: env.SMTP_HOST || "",
      port: num(env.SMTP_PORT, 587),
      secure: bool(env.SMTP_SECURE, num(env.SMTP_PORT, 587) === 465),
      user: env.SMTP_USER || "",
      pass: env.SMTP_PASS || "",
      from: env.SMTP_FROM || "",
      enabled: Boolean(env.SMTP_HOST && env.SMTP_FROM),
    }),
    session: Object.freeze({
      userTtlMs: num(env.SESSION_TTL_DAYS, 30) * 86_400_000,
      guestTtlMs: num(env.GUEST_SESSION_TTL_HOURS, 12) * 3_600_000,
    }),
    otp: Object.freeze({
      ttlMs: num(env.OTP_TTL_MINUTES, 10) * 60_000,
      resendCooldownMs: num(env.OTP_RESEND_COOLDOWN_SECONDS, 60) * 1000,
      maxAttempts: num(env.OTP_MAX_ATTEMPTS, 5),
    }),
    socket: Object.freeze({
      ticketTtlMs: num(env.SOCKET_TICKET_TTL_SECONDS, 30) * 1000,
      maxPayloadBytes: 16 * 1024,
    }),
    extension: Object.freeze({
      // Empty = any chrome-extension:// / moz-extension:// origin may pair (pairing still needs a one-time
      // code a signed-in user typed in). Production should pin the published extension's origin(s).
      origins: list(env.EXTENSION_ORIGINS, []).map(stripSlash),
      pairingTtlMs: num(env.EXTENSION_PAIRING_TTL_SECONDS, 120) * 1000,
      credentialTtlMs: num(env.EXTENSION_CREDENTIAL_TTL_HOURS, 12) * 3_600_000,
    }),
    rooms: Object.freeze({
      maxRooms: num(env.MAX_ROOMS, 200),
      maxPerUser: num(env.MAX_ROOMS_PER_USER, 5),
      maxParticipants: num(env.MAX_PARTICIPANTS_PER_ROOM, 30),
      maxModerators: Math.max(0, Math.min(10, Math.floor(num(env.MAX_MODERATORS_PER_ROOM, 3)))), // excludes the host
      disconnectGraceMs: num(env.DISCONNECT_GRACE_SECONDS, 60) * 1000,
      hostGraceMs: num(env.HOST_GRACE_SECONDS, 20) * 1000,
      emptyRoomTtlMs: num(env.EMPTY_ROOM_TTL_SECONDS, 30) * 1000,
      idleTtlMs: num(env.ROOM_IDLE_TTL_SECONDS, 600) * 1000,
      sweepIntervalMs: num(env.SWEEP_INTERVAL_SECONDS, 30) * 1000,
    }),
    // Rate-limit knobs (all windows in ms). Defaults are deliberately generous for real
    // watch-party use; tests tighten them through env vars.
    limits: Object.freeze({
      disabled: bool(env.RATE_LIMIT_DISABLED, false),
      otpRequestPerIp: num(env.RL_OTP_REQUEST_PER_IP, 10),
      otpRequestPerEmail: num(env.RL_OTP_REQUEST_PER_EMAIL, 3),
      otpVerifyPerIp: num(env.RL_OTP_VERIFY_PER_IP, 30),
      otpVerifyPerEmail: num(env.RL_OTP_VERIFY_PER_EMAIL, 10),
      guestPerIp: num(env.RL_GUEST_PER_IP, 30),
      roomCreatePerUser: num(env.RL_ROOM_CREATE_PER_USER, 10),
      roomCreatePerIp: num(env.RL_ROOM_CREATE_PER_IP, 20),
      roomLookupPerIp: num(env.RL_ROOM_LOOKUP_PER_IP, 120),
      ticketPerSession: num(env.RL_TICKET_PER_SESSION, 30),
      oauthStartPerIp: num(env.RL_OAUTH_START_PER_IP, 30),
      apiPerIp: num(env.RL_API_PER_IP, 600),
      extPairCreatePerSession: num(env.RL_EXT_PAIR_CREATE_PER_SESSION, 20),
      extPairRedeemPerIp: num(env.RL_EXT_PAIR_REDEEM_PER_IP, 20),
      extPairRedeemGlobal: num(env.RL_EXT_PAIR_REDEEM_GLOBAL, 300),
      extTicketPerCredential: num(env.RL_EXT_TICKET_PER_CREDENTIAL, 30),
      windowMs: num(env.RL_WINDOW_SECONDS, 600) * 1000,
    }),
  });
}

export const config = loadConfig();
