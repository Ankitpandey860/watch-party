// Test harness: boots the REAL app (Express + Socket.IO + services) in-process on an ephemeral
// port with an embedded Postgres (PGlite), a capturing mail transport and a fake Google.
// Set TEST_DATABASE_URL to run the same tests against a real PostgreSQL server instead.
import http from "node:http";
import { createHash, randomUUID } from "node:crypto";
import { io as ioClient } from "socket.io-client";
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from "jose";

// Silence the production logger's INFO/WARN lines so test output stays readable.
const LOGGER_LINE = /^\[\d{4}-\d{2}-\d{2}T[^\]]+\] \[(INFO|WARN)\]/;
for (const method of ["log", "warn"]) {
  const original = console[method].bind(console);
  console[method] = (...args) => {
    if (typeof args[0] === "string" && LOGGER_LINE.test(args[0])) return;
    original(...args);
  };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const DEFAULT_ENV = {
  NODE_ENV: "test",
  DISCONNECT_GRACE_SECONDS: "0.5",
  HOST_GRACE_SECONDS: "0.4",
  EMPTY_ROOM_TTL_SECONDS: "0.4",
  ROOM_IDLE_TTL_SECONDS: "0.6",
  SWEEP_INTERVAL_SECONDS: "0.2",
  SESSION_SECRET: "test-secret-test-secret-test-secret-0123456789",
  FRONTEND_URL: "http://localhost:5173",
  BACKEND_URL: "http://localhost:4000",
  GOOGLE_CLIENT_ID: "test-client-id.apps.googleusercontent.com",
  GOOGLE_CLIENT_SECRET: "test-client-secret",
  // generous by default; rate-limit tests pass their own tight values
  RL_API_PER_IP: "100000", RL_GUEST_PER_IP: "100000", RL_ROOM_CREATE_PER_USER: "100000",
  RL_ROOM_CREATE_PER_IP: "100000", RL_ROOM_LOOKUP_PER_IP: "100000", RL_TICKET_PER_SESSION: "100000",
  RL_OTP_REQUEST_PER_IP: "100000", RL_OTP_REQUEST_PER_EMAIL: "100000",
  RL_EXT_PAIR_CREATE_PER_SESSION: "100000", RL_EXT_PAIR_REDEEM_PER_IP: "100000", RL_EXT_PAIR_REDEEM_GLOBAL: "100000", RL_EXT_TICKET_PER_CREDENTIAL: "100000",
  RL_OTP_VERIFY_PER_IP: "100000", RL_OTP_VERIFY_PER_EMAIL: "100000", RL_OAUTH_START_PER_IP: "100000",
  MAX_ROOMS_PER_USER: "100", MAX_ROOMS: "1000",
};

export const GRACE_MS = Number(DEFAULT_ENV.DISCONNECT_GRACE_SECONDS) * 1000;
export const HOST_GRACE_MS = Number(DEFAULT_ENV.HOST_GRACE_SECONDS) * 1000;
export const EMPTY_TTL_MS = Number(DEFAULT_ENV.EMPTY_ROOM_TTL_SECONDS) * 1000;
export const IDLE_TTL_MS = Number(DEFAULT_ENV.ROOM_IDLE_TTL_SECONDS) * 1000;

export const GOOGLE_CLIENT_ID = DEFAULT_ENV.GOOGLE_CLIENT_ID;
export const GOOGLE_REDIRECT = "http://localhost:4000/api/auth/google/callback";

let emailCounter = 0;
export const uniqueEmail = (label = "user") => `${label}.${Date.now().toString(36)}${emailCounter++}@example.test`;

// ---- cookie jar ----------------------------------------------------------------------------
export class Jar {
  constructor() { this.cookies = new Map(); this.last = []; }
  absorb(headers) {
    this.last = headers.getSetCookie?.() ?? [];
    for (const line of this.last) {
      const [pair, ...attrs] = line.split(";").map((s) => s.trim());
      const eq = pair.indexOf("=");
      const name = pair.slice(0, eq), value = pair.slice(eq + 1);
      const maxAge = attrs.find((a) => /^max-age=/i.test(a));
      const expires = attrs.find((a) => /^expires=/i.test(a));
      const gone = value === "" || (maxAge && Number(maxAge.split("=")[1]) <= 0) || (expires && new Date(expires.split("=")[1]) < new Date());
      if (gone) this.cookies.delete(name); else this.cookies.set(name, value);
    }
  }
  header() { return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; "); }
  get(name) { return this.cookies.get(name); }
}

// ---- fake Google ---------------------------------------------------------------------------
async function makeFakeGoogle() {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(publicKey)), kid: "test-key", alg: "RS256", use: "sig" };
  const attackerKey = (await generateKeyPair("RS256")).privateKey; // same kid, different key
  const state = {
    profile: { sub: "g-sub-1", email: "google.user@example.test", email_verified: true, name: "Google User" },
    overrides: {}, // claims to override/omit in the next ID token
    issuer: "https://accounts.google.com",
    audience: GOOGLE_CLIENT_ID,
    tokenStatus: 200,
    lastTokenRequest: null,
    expectedChallenge: null,
    nonce: null,
    tokenCalls: 0,
    badSignature: false, // sign the next ID token with a key Google never published
  };
  const fetchImpl = async (url, init = {}) => {
    const u = String(url);
    if (u.includes("openid-configuration")) {
      return new Response(JSON.stringify({ token_endpoint: "https://fake.google/token", jwks_uri: "https://fake.google/jwks" }), { status: 200 });
    }
    if (u === "https://fake.google/token") {
      state.tokenCalls++;
      const form = Object.fromEntries(new URLSearchParams(init.body));
      state.lastTokenRequest = form;
      if (state.tokenStatus !== 200) return new Response("{}", { status: state.tokenStatus });
      // A real Google refuses a wrong PKCE verifier / client secret / redirect URI:
      const challenge = createHash("sha256").update(form.code_verifier || "").digest("base64url");
      if (form.code !== "good-code" || form.client_secret !== DEFAULT_ENV.GOOGLE_CLIENT_SECRET ||
          form.redirect_uri !== GOOGLE_REDIRECT || (state.expectedChallenge && challenge !== state.expectedChallenge)) {
        return new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 });
      }
      const claims = { ...state.profile, nonce: state.nonce, ...state.overrides };
      for (const k of Object.keys(claims)) if (claims[k] === undefined) delete claims[k];
      let jwt = new SignJWT(claims).setProtectedHeader({ alg: "RS256", kid: "test-key" })
        .setIssuer(state.issuer).setAudience(state.audience).setIssuedAt();
      jwt = jwt.setExpirationTime(state.overrides.exp ?? Math.floor(Date.now() / 1000) + 300);
      return new Response(JSON.stringify({ id_token: await jwt.sign(state.badSignature ? attackerKey : privateKey), access_token: "x" }), { status: 200 });
    }
    throw new Error(`unexpected fetch ${u}`);
  };
  return { state, fetchImpl, jwks: createLocalJWKSet({ keys: [jwk] }), sign: (claims, key = privateKey) => new SignJWT(claims), privateKey, newKey: () => generateKeyPair("RS256") };
}

async function makeDb() {
  if (process.env.TEST_DATABASE_URL) {
    const { createDb } = await import("../../src/db/index.js");
    const db = await createDb(process.env.TEST_DATABASE_URL);
    await db.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    return db;
  }
  const { PGlite } = await import("@electric-sql/pglite");
  const { wrapPglite } = await import("../../src/db/index.js");
  return wrapPglite(new PGlite());
}

// ---- server ----------------------------------------------------------------------------------
export async function startServer({ env = {}, mailerTransport } = {}) {
  for (const [k, v] of Object.entries({ ...DEFAULT_ENV, ...env })) process.env[k] = v;

  const { createApp } = await import("../../src/app.js");
  const { createContext } = await import("../../src/context.js");
  const { initSocket } = await import("../../src/socket/index.js");
  const { runMigrations } = await import("../../src/db/migrate.js");
  const { loadConfig } = await import("../../src/config/env.js");

  const config = loadConfig(process.env);
  const db = await makeDb();
  await runMigrations(db);

  const outbox = [];
  const google = await makeFakeGoogle();
  const ctx = await createContext({
    config, db,
    mailerTransport: mailerTransport || { sendMail: async (msg) => { outbox.push(msg); return {}; } },
    googleFetch: google.fetchImpl,
    googleJwks: google.jwks,
  });
  ctx.startMaintenance();

  const httpServer = http.createServer(createApp(ctx));
  const io = initSocket(httpServer, ctx);
  await new Promise((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${httpServer.address().port}`;
  const clients = new Set();

  const server = {
    url, ctx, db, config, google, outbox, roomManager: ctx.rooms,

    /** Raw REST call with an optional jar. Returns { status, body, headers, setCookies }. */
    async rest(method, path, body, { jar, headers = {}, csrf = true, raw = false } = {}) {
      const res = await fetch(`${url}/api${path}`, {
        method,
        redirect: "manual",
        headers: {
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
          ...(csrf ? { "x-requested-with": "watchparty" } : {}),
          ...(jar?.header() ? { cookie: jar.header() } : {}),
          ...headers,
        },
        body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
      });
      jar?.absorb(res.headers);
      let parsed = null;
      if (!raw) { try { parsed = await res.clone().json(); } catch { /* not JSON */ } }
      return { status: res.status, body: parsed, headers: res.headers, setCookies: res.headers.getSetCookie?.() ?? [], location: res.headers.get("location") };
    },

    /** An actor = one browser: its own cookie jar plus helpers. */
    actor() {
      const jar = new Jar();
      const actor = {
        jar,
        rest: (m, p, b, o = {}) => server.rest(m, p, b, { jar, ...o }),
        /** Fast sign-in (directly through the services); the full OTP/Google flows have their own tests. */
        async signIn(label = "user", displayName) {
          const email = uniqueEmail(label);
          const { user } = await ctx.users.resolveIdentity({
            provider: "email", subject: email, email, emailVerified: true, displayName: displayName || label,
          });
          const { token, principal } = await ctx.sessions.createUserSession(user);
          jar.cookies.set(config.cookie.name, token);
          actor.principal = principal; actor.email = email;
          return actor;
        },
        async joinAsGuest(roomId, displayName) {
          const r = await actor.rest("POST", `/rooms/${roomId}/join`, { displayName });
          if (r.status !== 200) throw new Error(`guest join failed: ${r.status} ${JSON.stringify(r.body)}`);
          actor.principal = r.body.principal;
          return actor;
        },
        async ticket(roomId) {
          const r = await actor.rest("POST", "/auth/socket-ticket", { roomId });
          if (r.status !== 200) throw Object.assign(new Error(`ticket failed ${r.status}`), { response: r });
          return r.body.ticket;
        },
        /** Connects a socket with a fresh ticket for `roomId` (does NOT join the room). */
        async connect(roomId, { ticket } = {}) {
          const c = new TestClient(url, ticket ?? (await actor.ticket(roomId)));
          clients.add(c);
          await c.connected();
          return c;
        },
        /** connect + join_room; resolves with the client (its first room_state is in client.state). */
        async enter(roomId) {
          const c = await actor.connect(roomId);
          c.state = await c.request("join_room", { roomId }, "room_state");
          return c;
        },
      };
      return actor;
    },

    /** A raw client with an arbitrary ticket (for forged/invalid ticket tests). */
    rawClient(auth, opts) {
      const c = new TestClient(url, undefined, auth, opts);
      clients.add(c);
      return c;
    },

    async close() {
      for (const c of clients) c.close();
      await new Promise((resolve) => io.close(resolve));
      await ctx.close();
    },
  };
  return server;
}

export class TestClient {
  constructor(url, ticket, auth, { origin } = {}) {
    this.log = [];
    this.socket = ioClient(url, {
      transports: ["websocket"], forceNew: true, reconnection: false,
      auth: auth !== undefined ? auth : { ticket },
      ...(origin ? { extraHeaders: { origin } } : {}),
    });
    this.socket.onAny((event, ...args) => this.log.push({ event, payload: args[0] }));
  }

  get id() { return this.socket.id; }

  connected() {
    if (this.socket.connected) return Promise.resolve(this);
    return new Promise((resolve, reject) => {
      this.socket.once("connect", () => resolve(this));
      this.socket.once("connect_error", (err) => reject(Object.assign(new Error(err.message), { data: err.data })));
    });
  }

  emit(event, payload) { this.socket.emit(event, payload); }
  mark() { return this.log.length; }
  events(event, since = 0) { return this.log.slice(since).filter((e) => e.event === event).map((e) => e.payload); }

  async waitFor(event, { since = 0, where = () => true, timeout = 1500 } = {}) {
    const deadline = Date.now() + timeout;
    for (;;) {
      const hit = this.events(event, since).find(where);
      if (hit !== undefined) return hit;
      if (Date.now() > deadline) {
        const seen = this.log.slice(since).map((e) => e.event).join(", ") || "(nothing)";
        throw new Error(`Timed out waiting for "${event}" (received: ${seen})`);
      }
      await sleep(10);
    }
  }

  async expectNone(event, { since = this.mark(), ms = 250 } = {}) {
    await sleep(ms);
    const got = this.events(event, since);
    if (got.length) throw new Error(`Expected no "${event}" but received ${got.length}: ${JSON.stringify(got[0])}`);
  }

  async request(event, payload, expectEvent, opts = {}) {
    const since = this.mark();
    this.emit(event, payload);
    return this.waitFor(expectEvent, { since, ...opts });
  }

  waitDisconnect(timeout = 2000) {
    if (this.socket.disconnected) return Promise.resolve("already");
    return Promise.race([
      new Promise((r) => this.socket.once("disconnect", r)),
      sleep(timeout).then(() => { throw new Error("socket did not disconnect"); }),
    ]);
  }

  close() { this.socket.removeAllListeners(); this.socket.close(); }
}

// ---- scenario helpers (same names/shapes the earlier tests used) -----------------------------

/** A signed-in user creates a room and connects as its host. */
export async function createRoomWithHost(server, username = "Host") {
  const actor = await server.actor().signIn(username.toLowerCase(), username);
  const created = await actor.rest("POST", "/rooms");
  if (created.status !== 201) throw new Error(`room create failed ${created.status} ${JSON.stringify(created.body)}`);
  const roomId = created.body.roomId;
  const host = await actor.enter(roomId);
  return { roomId, host, hostUserId: actor.principal.id, hostState: host.state, hostActor: actor };
}

/** A GUEST (invite-link identity) joins and connects. */
export async function joinAsParticipant(server, roomId, username) {
  const actor = server.actor();
  await actor.joinAsGuest(roomId, username);
  const client = await actor.enter(roomId);
  return { client, userId: actor.principal.id, state: client.state, actor };
}

/** A signed-in (non-host) user joins and connects, so they can be made moderator / host. */
export async function joinAsUser(server, roomId, username) {
  const actor = await server.actor().signIn(username.toLowerCase(), username);
  const client = await actor.enter(roomId);
  return { client, userId: actor.principal.id, state: client.state, actor };
}

export { randomUUID };
