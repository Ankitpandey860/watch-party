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

  const unavailable = () => new AppError(ERROR_CODES.OAUTH_UNAVAILABLE, "Google sign-in is not available.", 503);

  return {
    enabled: g.enabled,

    /** Starts a flow: returns the Google URL and the sealed cookie value to set. */
    start(returnTo) {
      if (!g.enabled) throw unavailable();
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
      if (!g.enabled) throw unavailable();
      const flow = open(key, cookie);
      if (!flow || flow.exp < now() || typeof state !== "string" || typeof code !== "string" || !code) throw unavailable();
      if (!safeEqual(state, flow.state)) throw unavailable(); // constant-time state check

      try {
        const doc = await getDiscovery();
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
        if (!res.ok) throw new Error(`token endpoint ${res.status}`);
        const tokens = await res.json();
        if (typeof tokens.id_token !== "string") throw new Error("no id_token");

        remoteJwks ||= createRemoteJWKSet(new URL(doc.jwks_uri));
        const { payload } = await jwtVerify(tokens.id_token, remoteJwks, {
          issuer: ISSUERS,
          audience: g.clientId,
          clockTolerance: 5,
          algorithms: ["RS256"],
          currentDate: new Date(now()),
        });
        if (payload.nonce !== flow.nonce) throw new Error("nonce mismatch");
        const emailVerified = payload.email_verified === true || payload.email_verified === "true";
        if (!payload.sub || typeof payload.email !== "string") throw new Error("missing claims");

        return {
          profile: { sub: String(payload.sub), email: payload.email, emailVerified, name: typeof payload.name === "string" ? payload.name : "" },
          returnTo: flow.returnTo,
        };
      } catch (err) {
        if (err instanceof AppError) throw err;
        throw Object.assign(unavailable(), { cause: err.message }); // `cause` is for server logs only
      }
    },
  };
}
