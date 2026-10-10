// SIMULATION of the Vercel "rewrite" topology (Option A): the browser only ever talks to the
// frontend origin; /api/* is proxied to the backend. This runs the whole cookie / CSRF / OAuth /
// rate-limit flow through a local reverse proxy. It does NOT prove Vercel itself behaves the same:
// run `node scripts/verify-deployment.mjs <frontend-url> <backend-url>` against the real deployment.
import http from "node:http";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, Jar, uniqueEmail } from "./_helpers/harness.js";

let backend, proxy, proxyUrl;
const FRONT = "http://localhost:5173"; // the allowed frontend origin the proxy pretends to be

before(async () => {
  backend = await startServer({ env: { RL_GUEST_PER_IP: "2" } });
  const target = new URL(backend.url);
  proxy = http.createServer((req, res) => {
    const upstream = http.request(
      { host: target.hostname, port: target.port, method: req.method, path: req.url,
        headers: { ...req.headers, host: target.host, "x-forwarded-for": req.headers["x-test-client-ip"] || "203.0.113.7", "x-forwarded-proto": "https" } },
      (up) => { res.writeHead(up.statusCode, up.headers); up.pipe(res); },
    );
    req.pipe(upstream);
  });
  await new Promise((r) => proxy.listen(0, "127.0.0.1", r));
  proxyUrl = `http://127.0.0.1:${proxy.address().port}`;
});
after(async () => {
  await new Promise((r) => proxy.close(r));
  await backend.close();
});

// A "browser": talks ONLY to the proxy, sends the frontend's Origin on every request, keeps cookies.
function browser(clientIp) {
  const jar = new Jar();
  const call = async (method, path, body, { redirect = "manual" } = {}) => {
    const res = await fetch(`${proxyUrl}${path}`, {
      method, redirect,
      headers: {
        origin: FRONT, "x-requested-with": "watchparty",
        ...(body ? { "content-type": "application/json" } : {}),
        ...(clientIp ? { "x-test-client-ip": clientIp } : {}),
        ...(jar.header() ? { cookie: jar.header() } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    jar.absorb(res.headers);
    let json = null; try { json = await res.clone().json(); } catch { /* redirect/none */ }
    return { status: res.status, json, location: res.headers.get("location"), setCookies: res.headers.getSetCookie() };
  };
  return { jar, call };
}

test("cookie issuance through the proxy: host-only (no Domain), HttpOnly, SameSite=Lax; persists; credentialed requests work", async () => {
  const b = browser("198.51.100.1");
  const r = await b.call("POST", "/api/auth/guest", { displayName: "Proxy" });
  assert.equal(r.status, 201);
  const cookie = r.setCookies.find((c) => c.startsWith("wp_session="));
  assert.ok(cookie, "Set-Cookie survived the proxy");
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=Lax/i);
  assert.doesNotMatch(cookie, /Domain=/i, "host-only: it binds to whichever origin the browser used (the frontend's)");
  const me = await b.call("GET", "/api/auth/me");
  assert.equal(me.json.principal.displayName, "Proxy");
  const rename = await b.call("PATCH", "/api/auth/me", { displayName: "Renamed" });
  assert.equal(rename.json.principal.displayName, "Renamed");
});

test("logout through the proxy revokes the session; the old cookie is dead", async () => {
  const b = browser("198.51.100.2");
  await b.call("POST", "/api/auth/guest", { displayName: "Bye" });
  const stolen = b.jar.header();
  assert.equal((await b.call("POST", "/api/auth/logout")).status, 200);
  assert.equal((await b.call("GET", "/api/auth/me")).json.principal, null);
  const thief = await fetch(`${proxyUrl}/api/auth/me`, { headers: { cookie: stolen } });
  assert.equal((await thief.json()).principal, null);
});

test("Google flow through the proxy: the sealed OAuth cookie round-trips and the callback redirect lands on the frontend", async () => {
  const b = browser("198.51.100.3");
  const start = await b.call("GET", "/api/auth/google/start?returnTo=/create");
  assert.equal(start.status, 302);
  assert.match(start.location, /^https:\/\/accounts\.google\.com\//);
  assert.ok(b.jar.get("wp_oauth"), "flow cookie was set via the proxy");
  const p = Object.fromEntries(new URL(start.location).searchParams);
  backend.google.state.nonce = p.nonce;
  backend.google.state.expectedChallenge = p.code_challenge;
  backend.google.state.profile = { sub: "proxy-sub", email: uniqueEmail("proxy"), email_verified: true, name: "Via Proxy" };
  const cb = await b.call("GET", `/api/auth/google/callback?code=good-code&state=${encodeURIComponent(p.state)}`);
  assert.equal(cb.status, 302);
  assert.equal(cb.location, `${FRONT}/create`);
  assert.equal((await b.call("GET", "/api/auth/me")).json.principal.displayName, "Via Proxy");
});

test("CSRF still holds behind the proxy: a foreign Origin is refused even with a valid cookie", async () => {
  const b = browser("198.51.100.4");
  await b.call("POST", "/api/auth/guest", { displayName: "Csrf" });
  const evil = await fetch(`${proxyUrl}/api/auth/logout`, {
    method: "POST", headers: { origin: "https://evil.example", "x-requested-with": "watchparty", cookie: b.jar.header() },
  });
  assert.equal(evil.status, 403);
  assert.equal((await b.call("GET", "/api/auth/me")).json.principal.displayName, "Csrf", "session untouched");
});

test("client-IP rate limiting works behind ONE proxy hop (TRUST_PROXY_HOPS=1): per real client, not per proxy", async () => {
  const a = browser("192.0.2.10"), c = browser("192.0.2.11");
  const statuses = [];
  for (let i = 0; i < 4; i++) statuses.push((await browser("192.0.2.10").call("POST", "/api/auth/guest", { displayName: `a${i}` })).status);
  assert.deepEqual(statuses, [201, 201, 429, 429], "client .10 is limited after 2");
  assert.equal((await c.call("POST", "/api/auth/guest", { displayName: "other" })).status, 201, "client .11 is unaffected");
  assert.ok(a);
});
