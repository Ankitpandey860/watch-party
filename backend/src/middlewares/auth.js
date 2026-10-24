import { AppError, ERROR_CODES } from "../constants/errors.js";
import { isAllowedOrigin, isExtensionOrigin } from "../config/cors.js";
import { parseCookies } from "../http/cookies.js";

/** Resolves the session cookie to req.principal (or null). Never trusts anything from the body/headers except the cookie token. */
export function attachPrincipal({ sessions, config }) {
  return async (req, _res, next) => {
    try {
      const token = parseCookies(req.headers.cookie)[config.cookie.name];
      req.principal = token ? await sessions.authenticate(token) : null;
      next();
    } catch (err) {
      next(err);
    }
  };
}

export function requireAuth(req, _res, next) {
  if (!req.principal) return next(new AppError(ERROR_CODES.UNAUTHENTICATED, "Please sign in or join as a guest.", 401));
  return next();
}

/** Signed-in accounts only (guests are rejected). */
export function requireUser(req, _res, next) {
  if (!req.principal) return next(new AppError(ERROR_CODES.UNAUTHENTICATED, "Please sign in to do that.", 401));
  if (req.principal.kind !== "user") return next(new AppError(ERROR_CODES.FORBIDDEN, "Sign in with Google or email to do that.", 403));
  return next();
}

/**
 * CSRF defence for cookie-authenticated state-changing requests, in addition to SameSite=Lax:
 *  - a browser-supplied Origin header must be on the allowlist;
 *  - the request must carry `X-Requested-With: watchparty`, a custom header that a cross-site page
 *    cannot send without a CORS preflight (which our allowlist refuses).
 */
export function csrfGuard({ config }) {
  const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);
  // Endpoints used by the browser EXTENSION. They never read the session cookie (they use a one-time
  // code or an `Authorization: Bearer` credential), so CSRF does not apply; instead the Origin must be
  // absent (non-browser), the web app itself, or an allowed extension origin. Any other website is refused.
  const EXTENSION_PATHS = new Set(["/api/extension/pair", "/api/extension/me", "/api/extension/socket-ticket", "/api/extension/disconnect"]);
  return (req, _res, next) => {
    if (SAFE.has(req.method) && !EXTENSION_PATHS.has(req.path)) return next();
    if (EXTENSION_PATHS.has(req.path)) {
      const origin = req.headers.origin;
      if (origin && !isExtensionOrigin(origin, config.extension.origins) && !isAllowedOrigin(origin, config.corsOrigins)) {
        return next(new AppError(ERROR_CODES.CSRF_REJECTED, "Request origin not allowed.", 403));
      }
      return next();
    }
    const origin = req.headers.origin;
    if (origin && !isAllowedOrigin(origin, config.corsOrigins)) {
      return next(new AppError(ERROR_CODES.CSRF_REJECTED, "Request origin not allowed.", 403));
    }
    if (req.headers["x-requested-with"] !== "watchparty") {
      return next(new AppError(ERROR_CODES.CSRF_REJECTED, "Missing required request header.", 403));
    }
    return next();
  };
}

/** Standard security headers for an API that only returns JSON/redirects. */
export function securityHeaders(_req, res, next) {
  res.set({
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Cache-Control": "no-store",
    "X-Frame-Options": "DENY",
    "Cross-Origin-Resource-Policy": "same-site",
  });
  next();
}
