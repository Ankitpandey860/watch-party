import { createRemoteJWKSet, jwtVerify } from "jose";
import { AppError, ERROR_CODES } from "../constants/errors.js";
import { deriveKey, open, randomToken, safeEqual, seal, sha256Base64Url } from "../infra/crypto.js";
import { safeReturnTo } from "../utils/validators.js";

// Verified against Google's OpenID Connect reference (developers.google.com/identity/openid-connect/reference):
// the authorization endpoint is fixed; token_endpoint and jwks_uri come from the discovery document.
const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const DISCOVERY_URL = "https://accounts.google.com/.well-known/openid-configuration";
const ISSUERS = ["https://accounts.google.com", "accounts.google.com"];
const FLOW_TTL_MS = 10 * 60_000;

export const OAUTH_COOKIE = "wp_oauth";

/**
 * Every failure is the same AppError to the browser (OAUTH_UNAVAILABLE), but carries a `diag` object for
 * the server log: which stage failed and a few non-sensitive facts. Nothing in `diag` is ever a secret:
 * only a stage name, an error code, an HTTP status, Google's documented `error` code and a sanitised,
 * length-limited description. Tokens, codes, the client secret and the PKCE verifier are never included.
 */
export const OAUTH_STAGES = Object.freeze([
  "not-configured", "flow-cookie-missing", "flow-cookie-invalid", "flow-expired", "code-missing", "state-missing",
  "state-mismatch", "discovery", "token-exchange", "token-response", "id-token-verify", "nonce-mismatch", "claims",
]);

const SAFE_CODE = /^[A-Za-z0-9_.:-]{1,64}$/;
/** Keep only short printable text and mask anything that looks like a token/secret, just in case. */
export function sanitizeDetail(value) {
  if (typeof value !== "string") return undefined;
  const t = value.replace(/[^\x20-\x7E]/g, " ").replace(/[A-Za-z0-9_-]{24,}/g, "[redacted]").trim().slice(0, 120);
  return t || undefined;
}
const pickCode = (v) => (typeof v === "string" && SAFE_CODE.test(v) ? v : undefined);

/** A flat, log-safe description of an error thrown by fetch / jose / our own code. */
function describeError(err) {
  const code = pickCode(err?.code) || pickCode(err?.cause?.code) || pickCode(err?.name);
  return { code, claim: pickCode(err?.claim), reason: pickCode(err?.reason), detail: sanitizeDetail(err?.message) };
}

/**
 * Google sign-in: OAuth 2.0 authorization-code flow + PKCE (S256), confidential client.
 *  - `state` (CSRF) and `nonce` (replay) are random and stored, together with the PKCE verifier,
 *    in a short-lived AES-GCM-sealed HttpOnly cookie; nothing about the flow lives in the frontend.
 *  - The code is exchanged server-side with the client secret.
 *  - The ID token signature is verified against Google's JWKS and iss / aud / exp / nonce /
 *    email_verified are all checked. A profile object from the browser is never trusted.
 * `fetchImpl` and `jwks` are injectable so tests run with no network.
 */
export function createGoogleAuthService({ config, fetchImpl = fetch, jwks = null, now = Date.now }) {
  const g = config.google;
  const key = deriveKey(config.sessionSecret, "oauth-flow-cookie");
  let discovery = null;
  let remoteJwks = jwks;

  async function getDiscovery() {
    if (discovery && discovery.expires > now()) return discovery.doc;
    const res = await fetchImpl(DISCOVERY_URL);
    if (!res.ok) throw new Error("discovery fetch failed");
    const doc = await res.json();
    if (!doc.token_endpoint || !doc.jwks_uri) throw new Error("discovery document incomplete");
    discovery = { doc, expires: now() + 24 * 3_600_000 };
    return doc;
  }

  const unavailable = (stage, diag = {}) =>
    Object.assign(new AppError(ERROR_CODES.OAUTH_UNAVAILABLE, "Google sign-in is not available.", 503), { diag: { stage, ...diag } });

  return {
    enabled: g.enabled,

    /** Starts a flow: returns the Google URL and the sealed cookie value to set. */
    start(returnTo) {
      if (!g.enabled) throw unavailable("not-configured");
      const state = randomToken(24);
      const nonce = randomToken(24);
      const verifier = randomToken(48); // 64 chars; RFC 7636 allows 43-128
      const params = new URLSearchParams({
        client_id: g.clientId,
        redirect_uri: g.redirectUri,
        response_type: "code",
        scope: "openid email profile",
        state,
        nonce,
        code_challenge: sha256Base64Url(verifier),
        code_challenge_method: "S256",
        prompt: "select_account",
      });
      const cookie = seal(key, { state, nonce, verifier, returnTo: safeReturnTo(returnTo), exp: now() + FLOW_TTL_MS });
      return { url: `${AUTH_ENDPOINT}?${params}`, cookie, maxAgeMs: FLOW_TTL_MS };
    },

    /**
     * Completes a flow. Returns { profile: { sub, email, emailVerified, name }, returnTo }.
     * Throws AppError(OAUTH_UNAVAILABLE) for any failure (details are intentionally not exposed).
     */
    async complete({ code, state, cookie }) {
      if (!g.enabled) throw unavailable("not-configured");
      // Distinguish the failure stages: "flow-cookie-missing" means the browser did not send our flow cookie to the
      // callback (typically: the flow was started on a different origin than the one Google redirected back to).
      if (typeof cookie !== "string" || !cookie) throw unavailable("flow-cookie-missing");
      const flow = open(key, cookie);
      if (!flow) throw unavailable("flow-cookie-invalid"); // tampered, or sealed with a different SESSION_SECRET
      if (flow.exp < now()) throw unavailable("flow-expired");
      if (typeof code !== "string" || !code) throw unavailable("code-missing");
      if (typeof state !== "string" || !state) throw unavailable("state-missing");
      if (!safeEqual(state, flow.state)) throw unavailable("state-mismatch"); // constant-time state check

      let stage = "discovery";
      try {
        const doc = await getDiscovery();
        stage = "token-exchange";
        const res = await fetchImpl(doc.token_endpoint, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
          body: new URLSearchParams({
            code,
            client_id: g.clientId,
            client_secret: g.clientSecret,
            redirect_uri: g.redirectUri,
            grant_type: "authorization_code",
            code_verifier: flow.verifier,
          }),
        });
        if (!res.ok) {
          // Google's error body is {"error":"invalid_grant","error_description":"..."}: documented codes, no secrets.
          const body = await res.json().catch(() => ({}));
          throw unavailable("token-exchange", { status: res.status, oauthError: pickCode(body?.error), detail: sanitizeDetail(body?.error_description) });
        }
        const tokens = await res.json();
        if (typeof tokens.id_token !== "string") throw unavailable("token-response", { detail: "no id_token in response" });

        stage = "id-token-verify";
        remoteJwks ||= createRemoteJWKSet(new URL(doc.jwks_uri));
        const { payload } = await jwtVerify(tokens.id_token, remoteJwks, {
          issuer: ISSUERS,
          audience: g.clientId,
          clockTolerance: 5,
          algorithms: ["RS256"],
          currentDate: new Date(now()),
        });
        if (payload.nonce !== flow.nonce) throw unavailable("nonce-mismatch");
        const emailVerified = payload.email_verified === true || payload.email_verified === "true";
        if (!payload.sub || typeof payload.email !== "string") throw unavailable("claims", { detail: "missing sub or email" });

        return {
          profile: { sub: String(payload.sub), email: payload.email, emailVerified, name: typeof payload.name === "string" ? payload.name : "" },
          returnTo: flow.returnTo,
        };
      } catch (err) {
        if (err instanceof AppError) throw err;
        throw unavailable(stage, describeError(err)); // `diag` is for server logs only
      }
    },
  };
}
