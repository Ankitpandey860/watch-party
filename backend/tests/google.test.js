// Google sign-in (authorization code + PKCE). A fake Google issues real RS256-signed ID tokens
// and enforces PKCE / client secret / redirect URI like the real token endpoint. NO live Google.
import { test, describe, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { SignJWT } from "jose";
import { startServer, uniqueEmail, sleep, GOOGLE_CLIENT_ID } from "./_helpers/harness.js";

let server;
before(async () => (server = await startServer()));
after(async () => server.close());
beforeEach(() => {
  const g = server.google.state;
  g.profile = { sub: `sub-${Math.random().toString(36).slice(2)}`, email: uniqueEmail("g"), email_verified: true, name: "Gina Google" };
  Object.assign(g, { badSignature: false, overrides: {}, issuer: "https://accounts.google.com", audience: GOOGLE_CLIENT_ID, tokenStatus: 200, expectedChallenge: null, tokenCalls: 0 });
});

/** Begins a flow as `actor` and returns what Google would see. */
async function start(actor, returnTo) {
  const q = returnTo === undefined ? "" : `?returnTo=${encodeURIComponent(returnTo)}`;
  const r = await actor.rest("GET", `/auth/google/start${q}`, undefined, { raw: true });
  assert.equal(r.status, 302, "start redirects to Google");
  const url = new URL(r.location);
  const params = Object.fromEntries(url.searchParams);
  server.google.state.nonce = params.nonce;
  server.google.state.expectedChallenge = params.code_challenge;
  return { r, url, params };
}
const callback = (actor, { code = "good-code", state, extra = "" } = {}) =>
  actor.rest("GET", `/auth/google/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}${extra}`, undefined, { raw: true });

describe("start", () => {
  test("redirects to Google with state, nonce, PKCE S256 challenge, scope and the configured client/redirect", async () => {
    const { url, params } = await start(server.actor(), "/room/ABC234");
    assert.equal(url.origin + url.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
    assert.equal(params.response_type, "code");
    assert.equal(params.client_id, GOOGLE_CLIENT_ID);
    assert.equal(params.redirect_uri, "http://localhost:4000/api/auth/google/callback");
    assert.equal(params.scope, "openid email profile");
    assert.equal(params.code_challenge_method, "S256");
    assert.match(params.code_challenge, /^[A-Za-z0-9_-]{43}$/);
    assert.ok(params.state.length >= 24 && params.nonce.length >= 24);
    assert.ok(!url.search.includes("client_secret"), "the client secret never goes to the browser");
    assert.ok(!("code_verifier" in params), "the PKCE verifier never goes to the browser URL");
  });

  test("the flow cookie is HttpOnly, scoped to the callback path, opaque, and short-lived", async () => {
    const a = server.actor();
    const { r } = await start(a);
    const c = r.setCookies.find((x) => x.startsWith("wp_oauth="));
    assert.match(c, /HttpOnly/i);
    assert.match(c, /Path=\/api\/auth\/google/i);
    assert.match(c, /SameSite=Lax/i);
    assert.ok(Number(c.match(/Max-Age=(\d+)/i)[1]) <= 600);
    const value = decodeURIComponent(c.split(";")[0].split("=")[1]);
    assert.doesNotMatch(value, /state|nonce|verifier/i, "sealed (encrypted), not readable JSON");
  });

  test("every start uses a fresh state, nonce and verifier", async () => {
    const a = (await start(server.actor())).params, b = (await start(server.actor())).params;
    assert.notEqual(a.state, b.state);
    assert.notEqual(a.nonce, b.nonce);
    assert.notEqual(a.code_challenge, b.code_challenge);
  });
});

describe("callback: success", () => {
  test("a valid flow signs the user in, creates the account and redirects to the (relative) returnTo", async () => {
    const a = server.actor();
    const { params } = await start(a, "/room/ABC234");
    const r = await callback(a, { state: params.state });
    assert.equal(r.status, 302);
    assert.equal(r.location, "http://localhost:5173/room/ABC234");
    assert.match(r.setCookies.find((c) => c.startsWith("wp_session=")), /HttpOnly/i);
    const me = await a.rest("GET", "/auth/me");
    assert.equal(me.body.principal.kind, "user");
    assert.equal(me.body.principal.displayName, "Gina Google");
    const u = (await server.db.query("SELECT * FROM users WHERE email = $1", [server.google.state.profile.email])).rows[0];
    assert.equal(u.id, me.body.principal.id);
  });

  test("the token exchange carried the PKCE verifier, secret and redirect URI (server-side only)", async () => {
    const a = server.actor();
    const { params } = await start(a);
    await callback(a, { state: params.state });
    const req = server.google.state.lastTokenRequest;
    assert.equal(req.grant_type, "authorization_code");
    assert.equal(req.client_secret, "test-client-secret");
    assert.ok(req.code_verifier.length >= 43);
  });

  test("the same Google account always maps to the same user", async () => {
    const profile = { ...server.google.state.profile };
    const first = server.actor();
    await callback(first, { state: (await start(first)).params.state });
    const second = server.actor();
    server.google.state.profile = profile;
    await callback(second, { state: (await start(second)).params.state });
    assert.equal((await first.rest("GET", "/auth/me")).body.principal.id, (await second.rest("GET", "/auth/me")).body.principal.id);
  });

  test("returnTo is restricted to same-site paths (no open redirect)", async () => {
    for (const evil of ["https://evil.example/", "//evil.example", "/\\evil.example", "javascript:alert(1)"]) {
      const a = server.actor();
      const { params } = await start(a, evil);
      const r = await callback(a, { state: params.state });
      assert.equal(r.location, "http://localhost:5173/", evil);
    }
  });
});

describe("callback: rejection", () => {
  const assertRejected = async (actor, r, errorCode = "oauth_failed") => {
    assert.equal(r.status, 302);
    assert.equal(r.location, `http://localhost:5173/auth?error=${errorCode}`);
    assert.equal(r.setCookies.find((c) => c.startsWith("wp_session=")), undefined, "no session cookie issued");
    assert.equal((await actor.rest("GET", "/auth/me")).body.principal, null);
  };

  test("wrong state (CSRF / login-fixation attempt)", async () => {
    const a = server.actor();
    await start(a);
    await assertRejected(a, await callback(a, { state: "attacker-chosen-state" }));
    assert.equal(server.google.state.tokenCalls, 0, "Google was never even asked");
  });

  test("no flow cookie (callback opened in a different browser)", async () => {
    const a = server.actor();
    const { params } = await start(a);
    const other = server.actor();
    await assertRejected(other, await callback(other, { state: params.state }));
  });

  test("tampered flow cookie", async () => {
    const a = server.actor();
    const { params } = await start(a);
    const v = a.jar.get("wp_oauth");
    a.jar.cookies.set("wp_oauth", v.slice(0, -4) + (v.endsWith("AAAA") ? "BBBB" : "AAAA"));
    await assertRejected(a, await callback(a, { state: params.state }));
  });

  test("replay: the same callback cannot be completed twice (the flow cookie is consumed)", async () => {
    const a = server.actor();
    const { params } = await start(a);
    const first = await callback(a, { state: params.state });
    assert.equal(first.location, "http://localhost:5173/");
    assert.equal(a.jar.get("wp_oauth"), undefined, "browser's flow cookie was cleared");
    await a.rest("POST", "/auth/logout");
    server.google.state.tokenCalls = 0;
    const replay = await callback(a, { state: params.state }); // same URL, same browser, flow already used
    await assertRejected(a, replay);
    assert.equal(server.google.state.tokenCalls, 0, "no second token exchange was attempted");
  });

  test("the flow cookie is cleared on callback, success or failure", async () => {
    const a = server.actor();
    const { params } = await start(a);
    const r = await callback(a, { state: params.state, code: "bad" });
    assert.match(r.setCookies.find((c) => c.startsWith("wp_oauth=")), /Expires=|Max-Age=0/i);
  });

  test("ID token with the wrong audience is rejected (token minted for another app)", async () => {
    const a = server.actor();
    server.google.state.audience = "someone-elses-client-id";
    await assertRejected(a, await callback(a, { state: (await start(a)).params.state }));
  });

  test("ID token with the wrong issuer is rejected", async () => {
    const a = server.actor();
    server.google.state.issuer = "https://evil.example";
    await assertRejected(a, await callback(a, { state: (await start(a)).params.state }));
  });

  test("an expired ID token is rejected", async () => {
    const a = server.actor();
    server.google.state.overrides = { exp: Math.floor(Date.now() / 1000) - 600 };
    await assertRejected(a, await callback(a, { state: (await start(a)).params.state }));
  });

  test("a wrong nonce (token replayed from another flow) is rejected", async () => {
    const a = server.actor();
    const { params } = await start(a);
    server.google.state.nonce = "some-other-flow-nonce";
    await assertRejected(a, await callback(a, { state: params.state }));
  });

  test("an ID token signed with a key Google never published is rejected (signature really is checked)", async () => {
    const a = server.actor();
    server.google.state.badSignature = true;
    await assertRejected(a, await callback(a, { state: (await start(a)).params.state }));
    // Control: the identical flow with the genuine key succeeds, so the rejection was about the signature.
    server.google.state.badSignature = false;
    const b = server.actor();
    assert.equal((await callback(b, { state: (await start(b)).params.state })).location, "http://localhost:5173/");
  });

  test("an unverified Google email never creates or links an account", async () => {
    const a = server.actor();
    server.google.state.profile.email_verified = false;
    const r = await callback(a, { state: (await start(a)).params.state });
    assert.equal(r.location, "http://localhost:5173/auth?error=email_unverified");
    assert.equal((await server.db.query("SELECT count(*)::int AS n FROM users WHERE email = $1", [server.google.state.profile.email])).rows[0].n, 0);
    assert.equal((await a.rest("GET", "/auth/me")).body.principal, null);
  });

  test("a failing token endpoint is a clean redirect with no details", async () => {
    const a = server.actor();
    server.google.state.tokenStatus = 500;
    const r = await callback(a, { state: (await start(a)).params.state });
    assert.equal(r.location, "http://localhost:5173/auth?error=oauth_failed");
  });

  test("the user cancelling at Google redirects with error=cancelled", async () => {
    const a = server.actor();
    await start(a);
    const r = await a.rest("GET", "/auth/google/callback?error=access_denied&state=x", undefined, { raw: true });
    assert.equal(r.location, "http://localhost:5173/auth?error=cancelled");
  });

  test("a wrong PKCE verifier is refused by Google (our fake enforces S256 like the real endpoint)", async () => {
    const a = server.actor();
    const { params } = await start(a);
    server.google.state.expectedChallenge = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"; // not the challenge we sent
    const r = await callback(a, { state: params.state });
    assert.equal(r.location, "http://localhost:5173/auth?error=oauth_failed");
  });

  test("no profile object from the browser is ever trusted: extra callback params are ignored", async () => {
    const a = server.actor();
    const { params } = await start(a);
    const r = await callback(a, { state: params.state, extra: "&email=admin@example.test&name=Admin&sub=1" });
    assert.equal(r.status, 302);
    const me = await a.rest("GET", "/auth/me");
    assert.equal(me.body.principal.displayName, "Gina Google");
    assert.equal((await server.db.query("SELECT count(*)::int AS n FROM users WHERE email = 'admin@example.test'")).rows[0].n, 0);
  });
});

describe("account linking (Google + email)", () => {
  async function otpLogin(email) {
    const a = server.actor();
    await a.rest("POST", "/auth/otp/request", { email });
    const code = server.outbox.at(-1).text.match(/\b(\d{6})\b/)[1];
    const r = await a.rest("POST", "/auth/otp/verify", { email, code });
    return { actor: a, id: r.body.principal.id };
  }
  const googleLogin = async (profile) => {
    const a = server.actor();
    server.google.state.profile = { name: "Linked", email_verified: true, ...profile };
    const { params } = await start(a);
    await callback(a, { state: params.state });
    return { actor: a, id: (await a.rest("GET", "/auth/me")).body.principal?.id };
  };

  test("email-OTP account, then Google with the SAME verified email: one user, two identities", async () => {
    const email = uniqueEmail("link1");
    const viaEmail = await otpLogin(email);
    const viaGoogle = await googleLogin({ sub: "link-sub-1", email });
    assert.equal(viaGoogle.id, viaEmail.id, "no duplicate account");
    const ids = (await server.db.query("SELECT provider FROM auth_identities WHERE user_id = $1 ORDER BY provider", [viaEmail.id])).rows.map((r) => r.provider);
    assert.deepEqual(ids, ["email", "google"]);
    assert.equal((await server.db.query("SELECT count(*)::int AS n FROM users WHERE email = $1", [email])).rows[0].n, 1);
  });

  test("Google first, then email OTP with the same address: same user", async () => {
    const email = uniqueEmail("link2");
    const viaGoogle = await googleLogin({ sub: "link-sub-2", email });
    await sleep(10);
    const viaEmail = await otpLogin(email);
    assert.equal(viaEmail.id, viaGoogle.id);
  });

  test("different verified emails are different users, and a Google sub cannot be hijacked by a new email", async () => {
    const a = await googleLogin({ sub: "link-sub-3", email: uniqueEmail("a") });
    const b = await googleLogin({ sub: "link-sub-4", email: uniqueEmail("b") });
    assert.notEqual(a.id, b.id);
    // Same Google sub arriving with a different email still resolves to its ORIGINAL account:
    const again = await googleLogin({ sub: "link-sub-3", email: uniqueEmail("changed") });
    assert.equal(again.id, a.id);
  });

  test("the identity table enforces uniqueness at the database level", async () => {
    const { actor } = await googleLogin({ sub: "link-sub-5", email: uniqueEmail("uniq") });
    const uid = (await actor.rest("GET", "/auth/me")).body.principal.id;
    await assert.rejects(() => server.db.query(
      "INSERT INTO auth_identities (id, user_id, provider, subject, email, email_verified_at) VALUES (gen_random_uuid(), $1, 'google', 'link-sub-5', 'x@y.zz', now())", [uid]));
  });

  test("userService refuses unverified or malformed identities outright", async () => {
    const { users } = server.ctx;
    for (const bad of [
      { provider: "google", subject: "s", email: "a@b.co", emailVerified: false },
      { provider: "google", subject: "s", email: "a@b.co", emailVerified: "true" },
      { provider: "google", subject: "s", email: "not-an-email", emailVerified: true },
      { provider: "google", subject: "", email: "a@b.co", emailVerified: true },
    ]) {
      await assert.rejects(() => users.resolveIdentity(bad), (e) => e.code === "FORBIDDEN");
    }
  });
});

describe("when Google is not configured", () => {
  test("start redirects to a clear error instead of a broken Google URL", async () => {
    const { loadConfig } = await import("../src/config/env.js");
    const { createGoogleAuthService } = await import("../src/services/googleAuthService.js");
    const svc = createGoogleAuthService({ config: loadConfig({ NODE_ENV: "test" }) });
    assert.equal(svc.enabled, false);
    assert.throws(() => svc.start("/"), (e) => e.code === "OAUTH_UNAVAILABLE");
  });
});
