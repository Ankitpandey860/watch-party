/** Minimal cookie-header parser (we only need to read two cookies; avoids an extra dependency). */
export function parseCookies(header) {
  const out = {};
  if (typeof header !== "string" || header.length > 4096) return out;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const name = part.slice(0, i).trim();
    if (!name || name in out) continue; // first occurrence wins
    try { out[name] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* ignore malformed */ }
  }
  return out;
}

export function sessionCookieOptions(config, maxAgeMs) {
  return {
    httpOnly: true, // not readable by page JavaScript, so XSS cannot steal the session
    secure: config.cookie.secure,
    sameSite: "lax",
    path: "/",
    ...(config.cookie.domain ? { domain: config.cookie.domain } : {}),
    ...(maxAgeMs ? { maxAge: maxAgeMs } : {}),
  };
}

export const setSessionCookie = (res, config, token, maxAgeMs) =>
  res.cookie(config.cookie.name, token, sessionCookieOptions(config, maxAgeMs));

export const clearSessionCookie = (res, config) =>
  res.clearCookie(config.cookie.name, sessionCookieOptions(config));
