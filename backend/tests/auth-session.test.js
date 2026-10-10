// Sessions, guest identity, cookies, CSRF and CORS.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { startServer, createRoomWithHost } from "./_helpers/harness.js";

let server;
before(async () => (server = await startServer()));
after(async () => server.close());

const setCookieOf = (r, name) => r.setCookies.find((c) => c.startsWith(`${name}=`)) || "";

describe("guest identity", () => {
  test("a guest session is created with a display name; the cookie is HttpOnly, SameSite=Lax, Path=/ and bounded", async () => {
    const a = server.actor();
    const r = await a.rest("POST", "/auth/guest", { displayName: "  Sam  " });
    assert.equal(r.status, 201);
    assert.deepEqual(Object.keys(r.body.principal).sort(), ["displayName", "id", "kind"]);
    assert.equal(r.body.principal.kind, "guest");
    assert.equal(r.body.principal.displayName, "Sam");
    const cookie = setCookieOf(r, "wp_session");
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /SameSite=Lax/i);
    assert.match(cookie, /Path=\//i);
    assert.match(cookie, /Max-Age=\d+/i);
    assert.doesNotMatch(cookie, /Domain=/i);
    assert.ok(Number(cookie.match(/Max-Age=(\d+)/i)[1]) <= 12 * 3600, "guest sessions are short-lived (<= 12h)");
  });

  test("display names are validated and sanitised (empty, too long, control/bidi characters)", async () => {
    const a = server.actor();
    assert.equal((await a.rest("POST", "/auth/guest", { displayName: "   " })).body.error.code, "USERNAME_REQUIRED");
    assert.equal((await a.rest("POST", "/auth/guest", {})).body.error.code, "USERNAME_REQUIRED");
    assert.equal((await a.rest("POST", "/auth/guest", { displayName: "x".repeat(21) })).body.error.code, "INVALID_PAYLOAD");
    assert.equal((await a.rest("POST", "/auth/guest", { displayName: 42 })).body.error.code, "USERNAME_REQUIRED");
    const ok = await server.actor().rest("POST", "/auth/guest", { displayName: "Al\u202eice\u200b" });
    assert.equal(ok.body.principal.displayName, "Alice");
  });

  test("the session token is stored only as a SHA-256 hash", async () => {
    const a = server.actor();
    await a.rest("POST", "/auth/guest", { displayName: "Hashy" });
    const token = a.jar.get("wp_session");
    const rows = (await server.db.query("SELECT token_hash FROM sessions")).rows.map((r) => r.token_hash);
    assert.ok(!rows.includes(token), "the raw token is never stored");
    assert.ok(rows.includes(createHash("sha256").update(token).digest("hex")));
  });

  test("GET /auth/me reflects the session and advertises which sign-in methods exist", async () => {
    const anon = await server.actor().rest("GET", "/auth/me");
    assert.equal(anon.body.principal, null);
    assert.deepEqual(anon.body.providers, { google: true, email: true });
    const a = server.actor();
    await a.rest("POST", "/auth/guest", { displayName: "Me" });
    const me = await a.rest("GET", "/auth/me");
    assert.equal(me.body.principal.displayName, "Me");
  });

  test("a guest can rename themselves; rename is sanitised", async () => {
    const a = server.actor();
    await a.rest("POST", "/auth/guest", { displayName: "Before" });
    const r = await a.rest("PATCH", "/auth/me", { displayName: " After " });
    assert.equal(r.body.principal.displayName, "After");
    assert.equal((await a.rest("PATCH", "/auth/me", { displayName: "" })).status, 400);
  });
});

describe("session lifecycle", () => {
  test("logout revokes the session server-side and clears the cookie", async () => {
    const a = await server.actor().signIn("logout");
    const token = a.jar.get("wp_session");
    const out = await a.rest("POST", "/auth/logout");
    assert.equal(out.status, 200);
    assert.match(setCookieOf(out, "wp_session"), /Expires=|Max-Age=0/i);
    // Replaying the OLD token (as a thief would) no longer works:
    const replay = server.actor();
    replay.jar.cookies.set("wp_session", token);
    assert.equal((await replay.rest("GET", "/auth/me")).body.principal, null);
    assert.equal((await replay.rest("POST", "/rooms")).status, 401);
  });

  test("an expired session is rejected", async () => {
    const a = await server.actor().signIn("expiry");
    await server.db.query("UPDATE sessions SET expires_at = now() - interval '1 minute' WHERE id = $1", [a.principal.sessionId]);
    assert.equal((await a.rest("GET", "/auth/me")).body.principal, null);
  });

  test("unknown / malformed / oversized cookies are treated as signed out", async () => {
    for (const value of ["nope", "x".repeat(200), "a".repeat(43)]) {
      const a = server.actor();
      a.jar.cookies.set("wp_session", value);
      assert.equal((await a.rest("GET", "/auth/me")).body.principal, null);
    }
  });

  test("signing in again rotates the session: the previous session is revoked", async () => {
    const a = await server.actor().signIn("rotate");
    const old = a.principal.sessionId;
    const otpEmail = a.email; // same user signs in again via OTP
    await a.rest("POST", "/auth/otp/request", { email: otpEmail });
    const code = server.outbox.at(-1).text.match(/\b(\d{6})\b/)[1];
    const r = await a.rest("POST", "/auth/otp/verify", { email: otpEmail, code });
    assert.equal(r.status, 200);
    const row = (await server.db.query("SELECT revoked_at FROM sessions WHERE id = $1", [old])).rows[0];
    assert.ok(row.revoked_at, "old session revoked");
    assert.notEqual(r.body.principal.id, undefined);
  });

  test("a guest who signs in is upgraded to a new user session and the guest session is revoked", async () => {
    const a = server.actor();
    await a.rest("POST", "/auth/guest", { displayName: "Upgrader" });
    const guestSession = (await a.rest("GET", "/auth/me")).body.principal.id;
    const email = "upgrader@example.test";
    await a.rest("POST", "/auth/otp/request", { email });
    const code = server.outbox.at(-1).text.match(/\b(\d{6})\b/)[1];
    const r = await a.rest("POST", "/auth/otp/verify", { email, code });
    assert.equal(r.body.principal.kind, "user");
    assert.notEqual(r.body.principal.id, guestSession);
  });
});

describe("authorisation boundaries", () => {
  test("room creation requires a signed-in account: anonymous 401, guest 403, user 201", async () => {
    assert.equal((await server.actor().rest("POST", "/rooms")).status, 401);
    const { roomId } = await createRoomWithHost(server, "Owner");
    const guest = server.actor();
    await guest.joinAsGuest(roomId, "G");
    const denied = await guest.rest("POST", "/rooms");
    assert.equal(denied.status, 403);
    assert.equal(denied.body.error.code, "FORBIDDEN");
    const user = await server.actor().signIn("maker");
    assert.equal((await user.rest("POST", "/rooms")).status, 201);
  });
});

describe("CSRF and CORS", () => {
  test("state-changing requests without the custom header are rejected", async () => {
    const a = await server.actor().signIn("csrf");
    const r = await a.rest("POST", "/rooms", undefined, { csrf: false });
    assert.equal(r.status, 403);
    assert.equal(r.body.error.code, "CSRF_REJECTED");
  });

  test("a cross-site Origin is rejected even with the header and a valid cookie", async () => {
    const a = await server.actor().signIn("csrf2");
    const r = await a.rest("POST", "/rooms", undefined, { headers: { origin: "https://evil.example" } });
    assert.equal(r.status, 403);
    assert.equal(r.body.error.code, "CSRF_REJECTED");
    assert.equal((await a.rest("POST", "/rooms", undefined, { headers: { origin: "http://localhost:5173" } })).status, 201);
  });

  test("CORS: allowlisted origin gets credentialed CORS; unknown origins get no CORS headers", async () => {
    const ok = await server.rest("GET", "/health", undefined, { headers: { origin: "http://localhost:5173" } });
    assert.equal(ok.headers.get("access-control-allow-origin"), "http://localhost:5173");
    assert.equal(ok.headers.get("access-control-allow-credentials"), "true");
    const evil = await server.rest("GET", "/health", undefined, { headers: { origin: "https://evil.example" } });
    assert.equal(evil.headers.get("access-control-allow-origin"), null);
  });

  test("CORS preflight from an unknown origin is not approved", async () => {
    const r = await fetch(`${server.url}/api/rooms`, {
      method: "OPTIONS",
      headers: { origin: "https://evil.example", "access-control-request-method": "POST", "access-control-request-headers": "x-requested-with" },
    });
    assert.equal(r.headers.get("access-control-allow-origin"), null);
  });
});

describe("error handling", () => {
  test("malformed JSON is a 400 (not a 500) and oversized bodies a 413; neither leaks internals", async () => {
    const bad = await server.rest("POST", "/auth/guest", "{not json");
    assert.equal(bad.status, 400);
    assert.equal(bad.body.error.code, "INVALID_JSON");
    const big = await server.rest("POST", "/auth/guest", { displayName: "x".repeat(50_000) });
    assert.equal(big.status, 413);
    assert.equal(big.body.error.code, "PAYLOAD_TOO_LARGE");
    assert.doesNotMatch(JSON.stringify([bad.body, big.body]), /stack|at .*\.js|SyntaxError/);
  });

  test("security headers are set and the API is not cacheable", async () => {
    const r = await server.rest("GET", "/health");
    assert.equal(r.headers.get("x-content-type-options"), "nosniff");
    assert.equal(r.headers.get("cache-control"), "no-store");
    assert.equal(r.headers.get("x-powered-by"), null);
  });

  test("health is minimal and public; readiness reports the database", async () => {
    const h = await server.rest("GET", "/health");
    assert.deepEqual(Object.keys(h.body).sort(), ["status", "uptime"]);
    assert.equal((await server.rest("GET", "/ready")).body.status, "ready");
  });

  test("unknown routes are a generic 404", async () => {
    const r = await server.rest("GET", "/nope");
    assert.equal(r.status, 404);
  });
});
