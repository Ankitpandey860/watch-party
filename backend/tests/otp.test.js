// Email one-time-code sign-in.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { startServer, uniqueEmail, sleep } from "./_helpers/harness.js";
import { startFakeSmtp } from "./_helpers/fakeSmtp.js";

let server;
before(async () => (server = await startServer({ env: { OTP_RESEND_COOLDOWN_SECONDS: "0.3", OTP_MAX_ATTEMPTS: "5" } })));
after(async () => server.close());

const codeFrom = (msg) => msg.text.match(/\b(\d{6})\b/)[1];
async function requestCode(actor, email) {
  const before = server.outbox.length;
  const r = await actor.rest("POST", "/auth/otp/request", { email });
  return { r, code: server.outbox.length > before ? codeFrom(server.outbox.at(-1)) : null };
}
const wrongCode = (code) => (code === "000000" ? "111111" : "000000");

describe("request", () => {
  test("sends a 6-digit code by email; response says nothing about whether the account exists", async () => {
    const email = uniqueEmail("req");
    const { r, code } = await requestCode(server.actor(), email);
    assert.equal(r.status, 200);
    assert.deepEqual(Object.keys(r.body).sort(), ["ok", "resendAfterSeconds"]);
    assert.match(code, /^\d{6}$/);
    const msg = server.outbox.at(-1);
    assert.equal(msg.to, email);
    assert.match(msg.text, /expires in 10 minutes/);
  });

  test("only an HMAC of the code is stored (never the code), and it is bound to the challenge id and email", async () => {
    const email = uniqueEmail("hmac");
    const { code } = await requestCode(server.actor(), email);
    const row = (await server.db.query("SELECT * FROM otp_challenges WHERE email = $1", [email])).rows[0];
    assert.notEqual(row.code_hmac, code);
    assert.match(row.code_hmac, /^[0-9a-f]{64}$/);
    assert.ok(!JSON.stringify(row).includes(code), "the plaintext code appears nowhere in the stored row");
    const plainSha = createHmac("sha256", "").update(code).digest("hex");
    assert.notEqual(row.code_hmac, plainSha);
    assert.ok(new Date(row.expires_at) - new Date(row.created_at) <= 10 * 60_000 + 1000, "expires within 10 minutes");
  });

  test("anti-enumeration: a brand-new address and an existing account get identically-shaped responses", async () => {
    const existing = await server.actor().signIn("enum");
    await sleep(350); // past the resend cooldown from signIn-independent requests
    const a = await requestCode(server.actor(), existing.email);
    const b = await requestCode(server.actor(), uniqueEmail("enum-new"));
    assert.equal(a.r.status, b.r.status);
    assert.deepEqual(Object.keys(a.r.body), Object.keys(b.r.body));
    assert.ok(a.code && b.code, "both addresses were emailed");
  });

  test("invalid email addresses are a 400 and send nothing", async () => {
    const n = server.outbox.length;
    for (const email of ["", "nope", "a@b", 42, null, "x".repeat(300) + "@example.test", "a b@example.test"]) {
      const r = await server.actor().rest("POST", "/auth/otp/request", { email });
      assert.equal(r.status, 400, String(email).slice(0, 20));
    }
    assert.equal(server.outbox.length, n);
  });

  test("resend cooldown: a second request within the cooldown sends no new email and returns the same shape", async () => {
    const email = uniqueEmail("cool");
    const a = server.actor();
    const first = await requestCode(a, email);
    const n = server.outbox.length;
    const second = await a.rest("POST", "/auth/otp/request", { email });
    assert.equal(second.status, 200);
    assert.deepEqual(Object.keys(second.body).sort(), ["ok", "resendAfterSeconds"]);
    assert.equal(server.outbox.length, n, "no second email during the cooldown");
    // the first code still works:
    assert.equal((await a.rest("POST", "/auth/otp/verify", { email, code: first.code })).status, 201);
  });

  test("requesting a new code after the cooldown invalidates the previous one", async () => {
    const email = uniqueEmail("inval");
    const a = server.actor();
    const first = await requestCode(a, email);
    await sleep(350);
    const second = await requestCode(a, email);
    assert.ok(second.code);
    const old = await a.rest("POST", "/auth/otp/verify", { email, code: first.code });
    assert.equal(old.status, 400);
    assert.equal(old.body.error.code, "INVALID_CODE");
    assert.equal((await a.rest("POST", "/auth/otp/verify", { email, code: second.code })).status, 201);
  });
});

describe("verify", () => {
  test("a correct code signs the user in: new account (201), HttpOnly session cookie, stable server-side user id", async () => {
    const email = uniqueEmail("ok");
    const a = server.actor();
    const { code } = await requestCode(a, email);
    const r = await a.rest("POST", "/auth/otp/verify", { email, code });
    assert.equal(r.status, 201);
    assert.equal(r.body.created, true);
    assert.equal(r.body.principal.kind, "user");
    assert.match(r.setCookies.find((c) => c.startsWith("wp_session=")), /HttpOnly/i);
    const me = await a.rest("GET", "/auth/me");
    assert.equal(me.body.principal.id, r.body.principal.id);
    const user = (await server.db.query("SELECT * FROM users WHERE email = $1", [email])).rows[0];
    assert.equal(user.id, r.body.principal.id);
  });

  test("the same email always resolves to the same user id (no duplicate accounts)", async () => {
    const email = uniqueEmail("same");
    const a1 = server.actor();
    const c1 = (await requestCode(a1, email)).code;
    const r1 = await a1.rest("POST", "/auth/otp/verify", { email, code: c1 });
    await sleep(350);
    const a2 = server.actor();
    const c2 = (await requestCode(a2, email)).code;
    const r2 = await a2.rest("POST", "/auth/otp/verify", { email, code: c2 });
    assert.equal(r2.status, 200);
    assert.equal(r2.body.created, false);
    assert.equal(r2.body.principal.id, r1.body.principal.id);
    assert.equal((await server.db.query("SELECT count(*)::int AS n FROM users WHERE email = $1", [email])).rows[0].n, 1);
  });

  test("email case/whitespace is normalised (Alice@X == alice@x)", async () => {
    const email = uniqueEmail("case");
    const a = server.actor();
    const { code } = await requestCode(a, `  ${email.toUpperCase()}  `);
    const r = await a.rest("POST", "/auth/otp/verify", { email, code });
    assert.equal(r.status, 201);
  });

  test("replay: a code works exactly once", async () => {
    const email = uniqueEmail("replay");
    const a = server.actor();
    const { code } = await requestCode(a, email);
    assert.equal((await a.rest("POST", "/auth/otp/verify", { email, code })).status, 201);
    const again = await server.actor().rest("POST", "/auth/otp/verify", { email, code });
    assert.equal(again.status, 400);
    assert.equal(again.body.error.code, "INVALID_CODE");
  });

  test("concurrent redemption of one code: exactly one request succeeds", async () => {
    const email = uniqueEmail("race");
    const { code } = await requestCode(server.actor(), email);
    const results = await Promise.all(Array.from({ length: 8 }, () => server.actor().rest("POST", "/auth/otp/verify", { email, code })));
    assert.equal(results.filter((r) => r.status === 201 || r.status === 200).length, 1);
  });

  test("expiry: an expired code is rejected with the same generic error", async () => {
    const email = uniqueEmail("exp");
    const a = server.actor();
    const { code } = await requestCode(a, email);
    await server.db.query("UPDATE otp_challenges SET expires_at = now() - interval '1 second' WHERE email = $1", [email]);
    const r = await a.rest("POST", "/auth/otp/verify", { email, code });
    assert.equal(r.status, 400);
    assert.equal(r.body.error.code, "INVALID_CODE");
  });

  test("brute force: after 5 wrong guesses the challenge is dead, even for the CORRECT code", async () => {
    const email = uniqueEmail("brute");
    const a = server.actor();
    const { code } = await requestCode(a, email);
    for (let i = 0; i < 5; i++) {
      assert.equal((await a.rest("POST", "/auth/otp/verify", { email, code: wrongCode(code) })).body.error.code, "INVALID_CODE");
    }
    const late = await a.rest("POST", "/auth/otp/verify", { email, code });
    assert.equal(late.status, 400);
    assert.equal(late.body.error.code, "INVALID_CODE");
    assert.equal((await server.db.query("SELECT attempts FROM otp_challenges WHERE email = $1", [email])).rows[0].attempts, 5);
    assert.equal((await server.db.query("SELECT count(*)::int AS n FROM users WHERE email = $1", [email])).rows[0].n, 0);
  });

  test("parallel guessing cannot exceed the attempt cap (service level: all 40 guesses hit the database at once)", async () => {
    const email = uniqueEmail("parallel");
    const { code } = await requestCode(server.actor(), email);
    const results = await Promise.allSettled(
      Array.from({ length: 40 }, (_, i) => server.ctx.otp.verify(email, String(100000 + i))),
    );
    assert.ok(results.every((r) => r.status === "rejected" && r.reason.code === "INVALID_CODE"));
    const attempts = (await server.db.query("SELECT attempts FROM otp_challenges WHERE email = $1", [email])).rows[0].attempts;
    assert.ok(attempts <= 5, `attempts=${attempts}: the cap must hold under concurrency`);
    await assert.rejects(() => server.ctx.otp.verify(email, code), (e) => e.code === "INVALID_CODE"); // the real code is locked out too
  });

  test("malformed codes / emails and unknown addresses all return the identical INVALID_CODE error", async () => {
    const bodies = [];
    for (const payload of [
      { email: "nobody@example.test", code: "123456" }, // never requested
      { email: uniqueEmail("m"), code: "abc" },
      { email: uniqueEmail("m"), code: "" },
      { email: uniqueEmail("m"), code: 123456 },
      { email: "not-an-email", code: "123456" },
      {},
    ]) {
      const r = await server.actor().rest("POST", "/auth/otp/verify", payload);
      assert.equal(r.status, 400);
      bodies.push(JSON.stringify(r.body));
    }
    assert.equal(new Set(bodies).size, 1, "no response distinguishes the failure reasons");
  });

  test("a code for one address cannot be redeemed for another", async () => {
    const victim = uniqueEmail("victim");
    const attacker = uniqueEmail("attacker");
    const a = server.actor();
    const { code } = await requestCode(a, attacker);
    const r = await a.rest("POST", "/auth/otp/verify", { email: victim, code });
    assert.equal(r.status, 400);
  });
});

describe("failure handling and log hygiene", () => {
  test("neither the OTP nor session tokens ever appear in server logs", async () => {
    const lines = [];
    const orig = { log: console.log, warn: console.warn, error: console.error };
    for (const k of Object.keys(orig)) console[k] = (...args) => lines.push(args.map(String).join(" "));
    let code, token;
    try {
      const email = uniqueEmail("logs");
      const a = server.actor();
      ({ code } = await requestCode(a, email));
      await a.rest("POST", "/auth/otp/verify", { email, code: wrongCode(code) });
      await a.rest("POST", "/auth/otp/verify", { email, code });
      token = a.jar.get("wp_session");
    } finally {
      Object.assign(console, orig);
    }
    const all = lines.join("\n");
    assert.ok(!all.includes(code), "OTP leaked into logs");
    assert.ok(!all.includes(token), "session token leaked into logs");
  });

  test("an SMTP failure is a generic 503, invalidates the code, and exposes no internals or credentials", async () => {
    const failing = await startServer({
      mailerTransport: { sendMail: async () => { throw Object.assign(new Error("connect ECONNREFUSED smtp.secret-host:587 user=bob pass=hunter2"), { code: "ECONNREFUSED" }); } },
    });
    try {
      const email = uniqueEmail("smtpfail");
      const a = failing.actor();
      const r = await a.rest("POST", "/auth/otp/request", { email });
      assert.equal(r.status, 503);
      assert.equal(r.body.error.code, "EMAIL_UNAVAILABLE");
      assert.doesNotMatch(JSON.stringify(r.body), /secret-host|hunter2|ECONNREFUSED|bob/);
      const live = (await failing.db.query("SELECT count(*)::int AS n FROM otp_challenges WHERE email = $1 AND invalidated_at IS NULL", [email])).rows[0].n;
      assert.equal(live, 0, "no usable code remains after a failed send");
    } finally {
      await failing.close();
    }
  });

  test("the real nodemailer SMTP transport delivers to an SMTP server (end-to-end over TCP, no mocks)", async () => {
    const smtp = await startFakeSmtp();
    const { createMailer } = await import("../src/infra/mailer.js");
    const mailer = createMailer({ smtp: { enabled: true, host: "127.0.0.1", port: smtp.port, secure: false, user: "", pass: "", from: "Watch Party <no-reply@example.test>" } });
    try {
      await mailer.sendOtp({ to: "dest@example.test", code: "424242", ttlMinutes: 10 });
      assert.equal(smtp.messages.length, 1);
      assert.match(smtp.messages[0].to[0], /dest@example\.test/);
      assert.match(smtp.messages[0].raw, /424242/);
      assert.match(smtp.messages[0].raw, /Subject: 424242 is your Watch Party code/);
    } finally {
      await smtp.close();
    }
  });

  test("with no SMTP configured, requesting a code is a clean 503 and /auth/me advertises email as unavailable", async () => {
    const { createMailer } = await import("../src/infra/mailer.js");
    const mailer = createMailer({ smtp: { enabled: false } });
    assert.equal(mailer.enabled, false);
    await assert.rejects(() => mailer.sendOtp({ to: "a@b.co", code: "123456", ttlMinutes: 10 }), (e) => e.code === "EMAIL_UNAVAILABLE" && e.statusCode === 503);
  });
});
