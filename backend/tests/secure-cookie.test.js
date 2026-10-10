// Production-style cookie configuration: Secure + the __Host- prefix.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./_helpers/harness.js";

let server;
before(async () => (server = await startServer({ env: { COOKIE_SECURE: "true" } })));
after(async () => server.close());

test("with COOKIE_SECURE the session cookie is Secure, HttpOnly, SameSite=Lax and uses the __Host- prefix", async () => {
  const r = await server.actor().rest("POST", "/auth/guest", { displayName: "Sec" });
  const cookie = r.setCookies.find((c) => c.startsWith("__Host-wp_session="));
  assert.ok(cookie, `expected a __Host- cookie, got: ${r.setCookies.join(" | ")}`);
  assert.match(cookie, /; Secure/i);
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=Lax/i);
  assert.match(cookie, /Path=\//i);
  assert.doesNotMatch(cookie, /Domain=/i, "__Host- cookies must not set Domain");
});

test("a cookie Domain (same-site subdomain deployment) switches off the __Host- prefix", async () => {
  const { loadConfig } = await import("../src/config/env.js");
  const c = loadConfig({ NODE_ENV: "test", COOKIE_SECURE: "true", COOKIE_DOMAIN: ".example.com" });
  assert.equal(c.cookie.name, "wp_session");
  assert.equal(c.cookie.domain, ".example.com");
});

test("production config refuses to start without a strong SESSION_SECRET / DATABASE_URL / FRONTEND_URL", async () => {
  const { loadConfig } = await import("../src/config/env.js");
  assert.throws(() => loadConfig({ NODE_ENV: "production" }), /SESSION_SECRET.*\n.*DATABASE_URL.*\n.*FRONTEND_URL/s);
  assert.throws(() => loadConfig({ NODE_ENV: "production", SESSION_SECRET: "short", DATABASE_URL: "x", FRONTEND_URL: "https://a.b" }), /SESSION_SECRET/);
  const ok = loadConfig({ NODE_ENV: "production", SESSION_SECRET: "x".repeat(40), DATABASE_URL: "postgres://x", FRONTEND_URL: "https://a.b" });
  assert.equal(ok.cookie.secure, true);
  assert.equal(ok.cookie.name, "__Host-wp_session");
});
