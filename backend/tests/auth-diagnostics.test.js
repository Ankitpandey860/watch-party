// Production-failure diagnostics for Google sign-in and e-mail delivery, plus the HTTPS e-mail API path.
// Everything here is local: a fake Google, fake SMTP servers and fake provider APIs. NOTHING touches a real
// Google, SMTP or e-mail-API service, so these prove the code's behaviour, not that the live deployment works.
import { test, describe, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { startServer, uniqueEmail, GOOGLE_CLIENT_ID } from "./_helpers/harness.js";
import { classifySmtpError, classifyApiFailure, createMailer } from "../src/infra/mailer.js";
import { loadConfig } from "../src/config/env.js";
import { sanitizeDetail } from "../src/services/googleAuthService.js";

/** Captures everything the logger prints (it uses console.*), so tests can assert on and scan the log. */
function captureLogs() {
  const lines = [];
  const orig = { log: console.log, warn: console.warn, error: console.error };
  for (const k of Object.keys(orig)) console[k] = (...a) => lines.push(a.join(" "));
  return { lines, text: () => lines.join("\n"), restore: () => Object.assign(console, orig) };
}

let server;
before(async () => (server = await startServer()));
after(async () => server.close());
beforeEach(() => {
  const g = server.google.state;
  g.profile = { sub: `sub-${Math.random().toString(36).slice(2)}`, email: uniqueEmail("g"), email_verified: true, name: "Gina" };
  Object.assign(g, { badSignature: false, overrides: {}, issuer: "https://accounts.google.com", audience: GOOGLE_CLIENT_ID, tokenStatus: 200, expectedChallenge: null, tokenCalls: 0 });
});

async function start(actor) {
  const r = await actor.rest("GET", "/auth/google/start", undefined, { raw: true });
  const params = Object.fromEntries(new URL(r.location).searchParams);
  server.google.state.nonce = params.nonce;
  server.google.state.expectedChallenge = params.code_challenge;
  return { r, params };
}
const callback = (actor, state, code = "good-code") =>
  actor.rest("GET", `/auth/google/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`, undefined, { raw: true });

/** Runs `fn` while capturing logs and returns the single "Google sign-in failed" line. */
async function failureLine(fn) {
  const cap = captureLogs();
  try { await fn(); } finally { cap.restore(); }
  const line = cap.lines.find((l) => l.includes("Google sign-in failed"));
  assert.ok(line, `expected a failure log line, got:\n${cap.text()}`);
  return { line, all: cap.text() };
}

describe("Google: the log says WHICH stage failed (the browser still only sees oauth_failed)", () => {
  test("no flow cookie => stage=flow-cookie-missing with the hosts and a hint (the observed OAUTH_UNAVAILABLE case)", async () => {
    const a = server.actor();
    const { params } = await start(a);
    const other = server.actor(); // a browser that never received the flow cookie
    const { line } = await failureLine(async () => {
      const r = await callback(other, params.state);
      assert.equal(r.location, "http://localhost:5173/auth?error=oauth_failed");
    });
    assert.match(line, /stage=flow-cookie-missing/);
    assert.match(line, /callbackHost=\S+ redirectUriHost=localhost flowCookie=absent/);
    assert.match(line, /hint=.*GOOGLE_REDIRECT_URI/);
    assert.doesNotMatch(line, /OAUTH_UNAVAILABLE/, "no longer the opaque error code");
  });

  test("tampered flow cookie => stage=flow-cookie-invalid", async () => {
    const a = server.actor();
    const { params } = await start(a);
    const cookie = a.jar.header().replace(/wp_oauth=([^;]+)/, (_, v) => `wp_oauth=${v.slice(0, -4)}AAAA`);
    const { line } = await failureLine(() => a.rest("GET", `/auth/google/callback?code=good-code&state=${params.state}`, undefined, { raw: true, headers: { cookie } }));
    assert.match(line, /stage=flow-cookie-invalid/);
    assert.match(line, /flowCookie=present/);
  });

  test("wrong state => stage=state-mismatch (Google is never called)", async () => {
    const a = server.actor();
    await start(a);
    const { line } = await failureLine(() => callback(a, "attacker-chosen-state"));
    assert.match(line, /stage=state-mismatch/);
    assert.equal(server.google.state.tokenCalls, 0);
  });

  test("Google's token endpoint refusing the exchange => stage=token-exchange with status and Google's error code", async () => {
    const a = server.actor();
    const { params } = await start(a);
    const { line } = await failureLine(() => callback(a, params.state, "wrong-code")); // fake answers 400 {"error":"invalid_grant"}
    assert.match(line, /stage=token-exchange status=400 oauth_error=invalid_grant/);
  });

  test("a 500 from the token endpoint => stage=token-exchange status=500", async () => {
    const a = server.actor();
    const { params } = await start(a);
    server.google.state.tokenStatus = 500;
    const { line } = await failureLine(() => callback(a, params.state));
    assert.match(line, /stage=token-exchange status=500/);
  });

  test("ID token problems => stage=id-token-verify with the jose error code and failing claim", async () => {
    for (const [tweak, expected] of [
      [(g) => { g.audience = "someone-elses-client"; }, /code=ERR_JWT_CLAIM_VALIDATION_FAILED claim=aud/],
      [(g) => { g.issuer = "https://evil.example"; }, /code=ERR_JWT_CLAIM_VALIDATION_FAILED claim=iss/],
      [(g) => { g.overrides = { exp: Math.floor(Date.now() / 1000) - 3600 }; }, /code=ERR_JWT_EXPIRED/],
      [(g) => { g.badSignature = true; }, /code=ERR_JWS_SIGNATURE_VERIFICATION_FAILED/],
    ]) {
      const a = server.actor();
      const { params } = await start(a);
      tweak(server.google.state);
      const { line } = await failureLine(() => callback(a, params.state));
      assert.match(line, /stage=id-token-verify/);
      assert.match(line, expected);
      beforeEachReset();
    }
  });

  test("nonce mismatch => stage=nonce-mismatch", async () => {
    const a = server.actor();
    const { params } = await start(a);
    server.google.state.nonce = "a-different-nonce";
    const { line } = await failureLine(() => callback(a, params.state));
    assert.match(line, /stage=nonce-mismatch/);
  });

  test("a failure AFTER Google authenticated (account step) is tagged stage=post-auth", async () => {
    const a = server.actor();
    const { params } = await start(a);
    const orig = server.ctx.users.resolveIdentity;
    server.ctx.users.resolveIdentity = async () => { throw Object.assign(new Error("db down"), { code: "ECONNREFUSED" }); };
    try {
      const { line } = await failureLine(() => callback(a, params.state));
      assert.match(line, /stage=post-auth code=ECONNREFUSED/);
    } finally { server.ctx.users.resolveIdentity = orig; }
  });

  test("the log never contains the client secret, the auth code, state, nonce, the PKCE verifier or any token", async () => {
    const a = server.actor();
    const { params } = await start(a);
    server.google.state.audience = "someone-elses-client";
    const cap = captureLogs();
    let r;
    try { r = await callback(a, params.state, "good-code"); } finally { cap.restore(); }
    const text = cap.text();
    assert.ok(text.includes("Google sign-in failed"));
    for (const secret of ["test-client-secret", "good-code", params.state, params.nonce, server.google.state.lastTokenRequest.code_verifier, "eyJ"]) {
      assert.ok(!text.includes(secret), `log leaked ${secret.slice(0, 8)}…`);
    }
    assert.equal(r.location, "http://localhost:5173/auth?error=oauth_failed");
  });

  test("a successful sign-in logs no failure", async () => {
    const a = server.actor();
    const { params } = await start(a);
    const cap = captureLogs();
    let r;
    try { r = await callback(a, params.state); } finally { cap.restore(); }
    assert.equal(r.location, "http://localhost:5173/");
    assert.doesNotMatch(cap.text(), /Google sign-in failed/);
  });

  test("sanitizeDetail strips long token-like strings and control characters", () => {
    assert.equal(sanitizeDetail("Bad Request\n token=abcdefghijklmnopqrstuvwxyz0123456789"), "Bad Request  token=[redacted]");
    assert.equal(sanitizeDetail(42), undefined);
    assert.ok(sanitizeDetail("x ".repeat(200)).length <= 120);
  });
});

function beforeEachReset() {
  Object.assign(server.google.state, { badSignature: false, overrides: {}, issuer: "https://accounts.google.com", audience: GOOGLE_CLIENT_ID });
}

describe("Google: redirect-host misconfiguration is called out at /google/start", () => {
  test("start served for 127.0.0.1 while GOOGLE_REDIRECT_URI is on localhost => one clear warning (and it says what to set)", async () => {
    const s = await startServer(); // fresh process-level state: the warning fires once per server
    const cap = captureLogs();
    try {
      await s.actor().rest("GET", "/auth/google/start", undefined, { raw: true });
      await s.actor().rest("GET", "/auth/google/start", undefined, { raw: true });
    } finally { cap.restore(); await s.close(); }
    const warns = cap.lines.filter((l) => l.includes("Google sign-in misconfiguration"));
    assert.equal(warns.length, 1, "logged once, not on every click");
    assert.match(warns[0], /served for host "127\.0\.0\.1" but GOOGLE_REDIRECT_URI is on "localhost"/);
    assert.match(warns[0], /Set GOOGLE_REDIRECT_URI to https:\/\/127\.0\.0\.1\/api\/auth\/google\/callback/);
  });

  test("no warning when the redirect URI is on the same host that serves /google/start", async () => {
    const s = await startServer({ env: { GOOGLE_REDIRECT_URI: "http://127.0.0.1:4000/api/auth/google/callback" } });
    const cap = captureLogs();
    try { await s.actor().rest("GET", "/auth/google/start", undefined, { raw: true }); } finally { cap.restore(); await s.close(); }
    assert.doesNotMatch(cap.text(), /misconfiguration/);
  });
});

describe("SMTP: error classification (codes only)", () => {
  const cases = [
    [{ code: "ETIMEDOUT", command: "CONN", message: "Connection timeout" }, "connect-timeout"],   // what a blocked port looks like
    [{ code: "ETIMEDOUT", command: "EHLO" }, "timeout"],
    [{ code: "ESOCKETTIMEDOUT" }, "timeout"],
    [{ code: "ECONNREFUSED", command: "CONN" }, "connection"],
    [{ code: "ENOTFOUND", command: "CONN" }, "connection"],
    [{ code: "EAUTH", command: "AUTH PLAIN", responseCode: 535 }, "auth"],
    [{ code: "ESOCKET", message: "error:0A00010B:SSL routines::wrong version number" }, "tls"],
    [{ code: "ETLS" }, "tls"],
    [{ code: "EENVELOPE", responseCode: 550 }, "rejected"],
    [{ code: "EMESSAGE", responseCode: 554 }, "rejected"],
    [{ message: "who knows" }, "other"],
  ];
  for (const [err, kind] of cases) test(`${JSON.stringify(err)} => ${kind}`, () => assert.equal(classifySmtpError(err).kind, kind));
  test("hostile error fields are not echoed (only short code-like strings survive)", () => {
    const c = classifySmtpError({ code: "x".repeat(200), command: "AUTH user=bob pass=hunter2" });
    assert.equal(c.command, undefined);
    assert.notEqual(c.code, "x".repeat(200));
  });
});

describe("SMTP: delivery failures through the real nodemailer transport", () => {
  const smtpCfg = (port, extra = {}) => ({ enabled: true, host: "127.0.0.1", port, secure: false, user: "mailuser", pass: "s3cret-smtp-pass", from: "Watch Party <no-reply@example.test>", ...extra });

  async function failure(mailer) {
    const cap = captureLogs();
    let err;
    try { await mailer.sendOtp({ to: "x@example.test", code: "482915", ttlMinutes: 10 }); } catch (e) { err = e; } finally { cap.restore(); }
    return { err, text: cap.text() };
  }

  test("closed port => class=connection (nodemailer reports ESOCKET); the user gets a clean EMAIL_UNAVAILABLE 503", async () => {
    const free = await new Promise((r) => { const s = net.createServer().listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => r(p)); }); });
    const { err, text } = await failure(createMailer({ smtp: smtpCfg(free) }));
    assert.equal(err.code, "EMAIL_UNAVAILABLE");
    assert.equal(err.statusCode, 503);
    assert.match(text, /SMTP send failed: class=connection code=(ESOCKET|ECONNREFUSED) command=CONN target=127\.0\.0\.1:\d+/);
  });

  test("a server that accepts TCP but never greets => a timeout class, not a hang", async () => {
    const hole = net.createServer((s) => s.on("error", () => {})); // black hole: no 220 banner
    await new Promise((r) => hole.listen(0, "127.0.0.1", r));
    try {
      const mailer = createMailer({ smtp: smtpCfg(hole.address().port) });
      const t0 = Date.now();
      const { err, text } = await failure(mailer);
      assert.equal(err.code, "EMAIL_UNAVAILABLE");
      assert.match(text, /SMTP send failed: class=(timeout|connect-timeout) code=ETIMEDOUT/);
      assert.ok(Date.now() - t0 < 20_000, "bounded by the configured timeouts");
    } finally { hole.close(); }
  });

  test("a blocked-port style ETIMEDOUT/CONN failure logs the Render hint and nothing sensitive", async () => {
    const transport = { sendMail: async () => { throw Object.assign(new Error("Connection timeout to smtp.example.test:587 as mailuser"), { code: "ETIMEDOUT", command: "CONN" }); } };
    const { err, text } = await failure(createMailer({ smtp: smtpCfg(587, { host: "smtp.example.test" }), transport }));
    assert.equal(err.code, "EMAIL_UNAVAILABLE");
    assert.match(text, /class=connect-timeout code=ETIMEDOUT command=CONN/);
    assert.match(text, /Render free web services block outbound ports 25\/465\/587/);
    for (const secret of ["s3cret-smtp-pass", "mailuser", "482915"]) assert.ok(!text.includes(secret), `leaked ${secret}`);
  });

  test("auth failure is reported as class=auth with the SMTP response code (no password, no server text)", async () => {
    const transport = { sendMail: async () => { throw Object.assign(new Error("535 5.7.8 Authentication failed for mailuser"), { code: "EAUTH", command: "AUTH PLAIN", responseCode: 535 }); } };
    const { text } = await failure(createMailer({ smtp: smtpCfg(587), transport }));
    assert.match(text, /class=auth code=EAUTH command=AUTH_PLAIN|class=auth code=EAUTH/);
    assert.match(text, /responseCode=535/);
    assert.ok(!text.includes("s3cret-smtp-pass") && !text.includes("Authentication failed for mailuser"));
  });
});

describe("OTP request when delivery fails", () => {
  test("503 EMAIL_UNAVAILABLE, the just-created challenge is invalidated (cannot be redeemed), and no code reaches the log", async () => {
    let sentCode = null;
    const s = await startServer({
      mailerTransport: { sendMail: async (m) => { sentCode = m.text.match(/\b(\d{6})\b/)[1]; throw Object.assign(new Error("Connection timeout"), { code: "ETIMEDOUT", command: "CONN" }); } },
    });
    const cap = captureLogs();
    try {
      const email = uniqueEmail("otp");
      const a = s.actor();
      const r = await a.rest("POST", "/auth/otp/request", { email });
      assert.equal(r.status, 503);
      assert.equal(r.body.error.code, "EMAIL_UNAVAILABLE");
      const v = await a.rest("POST", "/auth/otp/verify", { email, code: sentCode });
      assert.equal(v.status, 400, "a code that was never delivered cannot be used");
      assert.ok(!cap.text().includes(sentCode), "OTP never logged");
      assert.match(cap.text(), /SMTP send failed: class=connect-timeout/);
    } finally { cap.restore(); await s.close(); }
  });
});

describe("HTTPS e-mail API (works where outbound SMTP is blocked)", () => {
  const ok = (body = {}) => new Response(JSON.stringify(body), { status: 200 });
  const run = (emailApi, fetchImpl) => createMailer({ smtp: { enabled: false }, emailApi: { enabled: true, ...emailApi }, fetchImpl });
  const msg = { to: "viewer@example.test", code: "482915", ttlMinutes: 10 };

  test("Resend: POST /emails with a Bearer key, from/to/subject/text/html; port 443 only", async () => {
    let seen;
    const m = run({ provider: "resend", apiKey: "re_test_key", from: "Watch Party <no-reply@example.test>" }, async (url, init) => { seen = { url, init, body: JSON.parse(init.body) }; return ok({ id: "abc" }); });
    assert.equal(m.enabled, true);
    assert.match(m.describe, /HTTPS API \(resend\)/);
    await m.sendOtp(msg);
    assert.equal(seen.url, "https://api.resend.com/emails");
    assert.equal(seen.init.method, "POST");
    assert.equal(seen.init.headers.authorization, "Bearer re_test_key");
    assert.deepEqual([seen.body.from, seen.body.to], ["Watch Party <no-reply@example.test>", ["viewer@example.test"]]);
    assert.match(seen.body.subject, /482915 is your Watch Party code/);
    assert.match(seen.body.text, /482915/);
    assert.ok(seen.body.html.includes("482915"));
  });

  test("Brevo: POST /v3/smtp/email with the api-key header, sender split into name+email, htmlContent/textContent", async () => {
    let seen;
    const m = run({ provider: "brevo", apiKey: "xkeysib-test", from: "Watch Party <no-reply@example.test>" }, async (url, init) => { seen = { url, init, body: JSON.parse(init.body) }; return new Response("{}", { status: 201 }); });
    await m.sendOtp(msg);
    assert.equal(seen.url, "https://api.brevo.com/v3/smtp/email");
    assert.equal(seen.init.headers["api-key"], "xkeysib-test");
    assert.deepEqual(seen.body.sender, { name: "Watch Party", email: "no-reply@example.test" });
    assert.deepEqual(seen.body.to, [{ email: "viewer@example.test" }]);
    assert.ok(seen.body.htmlContent.includes("482915") && seen.body.textContent.includes("482915"));
  });

  test("a bare address (no display name) is accepted as the sender", async () => {
    let body;
    await run({ provider: "brevo", apiKey: "k", from: "no-reply@example.test" }, async (_u, init) => { body = JSON.parse(init.body); return ok(); }).sendOtp(msg);
    assert.deepEqual(body.sender, { email: "no-reply@example.test" });
  });

  const failures = [
    [401, { name: "restricted_api_key" }, /class=auth status=401 error=restricted_api_key/],
    [403, { code: "unauthorized" }, /class=auth status=403/],
    [422, { name: "validation_error" }, /class=rejected status=422 error=validation_error.*verified sender/],
    [429, {}, /class=rate-limited status=429/],
    [503, {}, /class=provider-error status=503/],
  ];
  for (const [status, body, expected] of failures) {
    test(`HTTP ${status} => clean 503 to the user, classified log, no key/code/address in the log`, async () => {
      const m = run({ provider: "resend", apiKey: "re_SECRET_KEY_123", from: "a@example.test" }, async () => new Response(JSON.stringify({ ...body, message: "bad for viewer@example.test with re_SECRET_KEY_123" }), { status }));
      const cap = captureLogs();
      let err;
      try { await m.sendOtp(msg); } catch (e) { err = e; } finally { cap.restore(); }
      assert.equal(err.code, "EMAIL_UNAVAILABLE");
      assert.equal(err.statusCode, 503);
      assert.match(cap.text(), expected);
      for (const secret of ["re_SECRET_KEY_123", "482915", "viewer@example.test"]) assert.ok(!cap.text().includes(secret), `leaked ${secret}`);
    });
  }

  test("network failure and timeout are classified, not thrown raw", async () => {
    const cap = captureLogs();
    const errs = [];
    try {
      for (const e of [Object.assign(new TypeError("fetch failed"), { cause: { code: "ENOTFOUND" } }), Object.assign(new Error("t"), { name: "TimeoutError" })]) {
        try { await run({ provider: "resend", apiKey: "k", from: "a@b.test" }, async () => { throw e; }).sendOtp(msg); } catch (x) { errs.push(x.code); }
      }
    } finally { cap.restore(); }
    assert.deepEqual(errs, ["EMAIL_UNAVAILABLE", "EMAIL_UNAVAILABLE"]);
    assert.match(cap.text(), /class=connection code=ENOTFOUND/);
    assert.match(cap.text(), /class=timeout code=TimeoutError/);
  });

  test("classifyApiFailure covers the status families", () => {
    assert.equal(classifyApiFailure({ status: 400 }).kind, "rejected");
    assert.equal(classifyApiFailure({ status: 500 }).kind, "provider-error");
    assert.equal(classifyApiFailure({ networkCode: "ECONNRESET" }).kind, "connection");
  });
});

describe("e-mail configuration", () => {
  const base = { NODE_ENV: "test", SESSION_SECRET: "x".repeat(40) };
  test("default stays SMTP; the API is only enabled with provider + key + sender", () => {
    assert.equal(loadConfig(base).emailApi.enabled, false);
    assert.equal(loadConfig({ ...base, EMAIL_PROVIDER: "resend", EMAIL_API_KEY: "k" }).emailApi.enabled, false, "no sender");
    assert.equal(loadConfig({ ...base, EMAIL_PROVIDER: "resend", EMAIL_FROM: "a@b.test" }).emailApi.enabled, false, "no key");
    const c = loadConfig({ ...base, EMAIL_PROVIDER: "Brevo", EMAIL_API_KEY: "k", SMTP_FROM: "a@b.test" });
    assert.deepEqual([c.emailApi.provider, c.emailApi.enabled, c.emailApi.from], ["brevo", true, "a@b.test"], "SMTP_FROM is the fallback sender");
  });
  test("an unknown provider fails fast instead of silently sending nothing", () => {
    assert.throws(() => loadConfig({ ...base, EMAIL_PROVIDER: "mailgun" }), /EMAIL_PROVIDER must be one of/);
  });
  test("the API provider wins over SMTP when both are configured; injected transports still win over both (tests)", () => {
    const api = { provider: "resend", apiKey: "k", from: "a@b.test", enabled: true };
    assert.match(createMailer({ smtp: { enabled: true, host: "h", port: 587, from: "f" }, emailApi: api }).describe, /HTTPS API/);
    assert.equal(createMailer({ smtp: { enabled: true, host: "h", port: 587, from: "f" }, emailApi: api, transport: { sendMail: async () => ({}) } }).describe, "injected transport");
    assert.match(createMailer({ smtp: { enabled: true, host: "h", port: 2525, secure: false, from: "f" } }).describe, /SMTP h:2525 \(STARTTLS\)/);
  });
  test("with nothing configured the mailer is disabled and says so", async () => {
    const m = createMailer({ smtp: { enabled: false }, emailApi: { enabled: false } });
    assert.equal(m.enabled, false);
    await assert.rejects(() => m.sendOtp({ to: "a@b.test", code: "123456", ttlMinutes: 1 }), { code: "EMAIL_UNAVAILABLE" });
  });
});
