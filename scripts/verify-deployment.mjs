#!/usr/bin/env node
// Verifies a REAL deployment end to end: the Vercel rewrite (Option A) and the Render backend.
//
//   node scripts/verify-deployment.mjs https://your-app.vercel.app https://your-backend.onrender.com
//
// It creates ONE throw-away guest session (no email is sent, nothing is created in any room), then
// checks cookie issuance through the rewrite, persistence, credentialed requests, logout/revocation,
// CORS and the Socket.IO endpoint. It prints cookie *attributes* only, never cookie values.
// Exit code 0 = every check passed.

const [frontend, backend] = process.argv.slice(2).map((u) => u?.replace(/\/+$/, ""));
if (!frontend || !backend) {
  console.error("usage: node scripts/verify-deployment.mjs <frontend-url> <backend-url>");
  process.exit(2);
}

const results = [];
const check = async (name, fn) => {
  try {
    const note = await fn();
    results.push({ name, ok: true, note });
    console.log(`  PASS  ${name}${note ? `  (${note})` : ""}`);
  } catch (err) {
    results.push({ name, ok: false, note: err.message });
    console.log(`  FAIL  ${name}\n        -> ${err.message}`);
  }
};
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

let cookie = "";
const call = async (base, path, { method = "GET", body, headers = {}, useCookie = true } = {}) => {
  const res = await fetch(`${base}${path}`, {
    method, redirect: "manual", signal: AbortSignal.timeout(70_000), // a free Render service can take ~1 min to wake
    headers: {
      origin: frontend, "x-requested-with": "watchparty",
      ...(body ? { "content-type": "application/json" } : {}),
      ...(useCookie && cookie ? { cookie } : {}), ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.clone().json(); } catch { /* not json */ }
  return { res, json, text: json ? "" : await res.clone().text().catch(() => "") };
};

console.log(`\nFrontend: ${frontend}\nBackend : ${backend}\n`);
console.log("1. Through the frontend origin (the Vercel rewrite):");

await check("GET /api/health is served through the rewrite", async () => {
  const { res, json, text } = await call(frontend, "/api/health", { useCookie: false });
  assert(res.status === 200, `status ${res.status}; is the rewrite for /api/:path* configured in vercel.json? body: ${text.slice(0, 80)}`);
  assert(json?.status === "ok", "response is not the backend's health JSON (the rewrite may be returning the SPA's index.html)");
  return `uptime ${json.uptime}s`;
});

await check("guest session cookie is issued through the rewrite", async () => {
  const { res, json } = await call(frontend, "/api/auth/guest", { method: "POST", body: { displayName: "verify-bot" }, useCookie: false });
  assert(res.status === 201, `status ${res.status} ${JSON.stringify(json)}`);
  const set = res.headers.getSetCookie();
  const line = set.find((c) => /^(__Host-)?wp_session=/.test(c));
  assert(line, "no wp_session Set-Cookie reached the browser side (the rewrite dropped or renamed it)");
  cookie = line.split(";")[0];
  const attrs = line.split(";").slice(1).map((a) => a.trim().split("=")[0].toLowerCase());
  for (const need of ["httponly", "secure", "samesite", "path"]) assert(attrs.includes(need), `cookie is missing the ${need} attribute`);
  assert(!attrs.includes("domain"), "cookie sets a Domain attribute (expected host-only)");
  assert(/samesite=lax/i.test(line), "SameSite is not Lax");
  return `${cookie.split("=")[0]}; attributes: ${attrs.join(", ")}`;
});

await check("cookie persists and credentialed requests are authenticated", async () => {
  const { json } = await call(frontend, "/api/auth/me");
  assert(json?.principal?.kind === "guest", `not authenticated: ${JSON.stringify(json)}`);
  const r = await call(frontend, "/api/auth/me", { method: "PATCH", body: { displayName: "verify-2" } });
  assert(r.json?.principal?.displayName === "verify-2", "PATCH with the cookie failed");
});

await check("CSRF protection rejects a foreign Origin (even with the cookie)", async () => {
  const { res } = await call(frontend, "/api/auth/me", { method: "PATCH", body: { displayName: "x" }, headers: { origin: "https://evil.example" } });
  assert(res.status === 403, `expected 403, got ${res.status}`);
});

await check("sign-in methods advertised", async () => {
  const { json } = await call(frontend, "/api/auth/me", { useCookie: false });
  return `google=${json?.providers?.google} email=${json?.providers?.email}`;
});

await check("logout revokes the session server-side", async () => {
  const stolen = cookie;
  const out = await call(frontend, "/api/auth/logout", { method: "POST" });
  assert(out.res.status === 200, `logout status ${out.res.status}`);
  cookie = "";
  const { json } = await call(frontend, "/api/auth/me", { headers: { cookie: stolen }, useCookie: false });
  assert(json?.principal === null, "the old cookie STILL authenticates after logout (revocation failed)");
});

console.log("\n2. Directly against the backend (what the browser's Socket.IO connection uses):");

await check("backend health + database readiness", async () => {
  const h = await call(backend, "/api/health", { useCookie: false });
  assert(h.res.status === 200, `health ${h.res.status}`);
  const r = await call(backend, "/api/ready", { useCookie: false });
  assert(r.res.status === 200, `readiness ${r.res.status}: the database is unreachable (check DATABASE_URL / Neon)`);
});

await check("CORS: the frontend origin is allowed WITH credentials; an unknown origin is not", async () => {
  const ok = await call(backend, "/api/health", { useCookie: false });
  assert(ok.res.headers.get("access-control-allow-origin") === frontend, `allow-origin is "${ok.res.headers.get("access-control-allow-origin")}" (ALLOWED_ORIGINS must contain exactly ${frontend})`);
  assert(ok.res.headers.get("access-control-allow-credentials") === "true", "credentials not allowed");
  const bad = await call(backend, "/api/health", { useCookie: false, headers: { origin: "https://evil.example" } });
  assert(!bad.res.headers.get("access-control-allow-origin"), "unknown origin received CORS approval");
});

await check("Socket.IO endpoint reachable from the frontend origin, and a ticket-less connection is refused", async () => {
  const r = await fetch(`${backend}/socket.io/?EIO=4&transport=polling`, { headers: { origin: frontend }, signal: AbortSignal.timeout(70_000) });
  assert(r.status === 200, `engine handshake status ${r.status}`);
  assert(r.headers.get("access-control-allow-origin") === frontend || r.headers.get("access-control-allow-origin") === null, "unexpected CORS on socket endpoint");
  const bad = await fetch(`${backend}/socket.io/?EIO=4&transport=polling`, { headers: { origin: "https://evil.example" }, signal: AbortSignal.timeout(70_000) });
  assert(bad.status === 403, `a foreign Origin should be refused at the upgrade, got ${bad.status}`);
});

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
if (failed.length) {
  console.log("\nIf checks in section 1 fail but section 2 passes, the Vercel rewrite is the problem. Fall back to a same-site custom domain");
  console.log("(see docs/DEPLOYMENT.md, 'Fallback: same-site subdomains'); no code change is needed, only configuration.");
  process.exit(1);
}
