import { config } from "./env.js";

/** True if `origin` is on the allowlist. A missing Origin (curl, server-to-server, same-origin GET) is handled by callers. */
export function isAllowedOrigin(origin, allowed = config.corsOrigins) {
  return Boolean(origin) && allowed.includes(origin);
}

// Credentialed CORS needs an explicit origin (never "*"). Unknown origins get no CORS headers
// at all, so the browser blocks the response; state-changing routes also reject them server-side.
export const expressCorsOptions = {
  origin(origin, callback) {
    if (!origin || isAllowedOrigin(origin)) return callback(null, true);
    return callback(null, false);
  },
  credentials: true,
  methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "X-Requested-With"],
  maxAge: 600,
};

export const socketCorsOptions = {
  origin(origin, callback) {
    if (!origin || isAllowedOrigin(origin)) return callback(null, true);
    return callback(null, false);
  },
  credentials: false, // sockets authenticate with a one-time ticket, not cookies
};
