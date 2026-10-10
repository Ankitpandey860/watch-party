# Deployment guide (Vercel + Render + Neon)

> Status of verification: everything below is covered by automated tests with mocks/simulations (including a local
> simulation of the Vercel rewrite and tests against real PostgreSQL 16). **Nothing has been run against a live Vercel,
> Render, Neon, Google or SMTP account.** Run `scripts/verify-deployment.mjs` after you deploy (see step 7).

## 1. Database (Neon free)
1. Create a Neon project, copy the connection string (it contains the password: keep it only in env vars).
2. Free-tier facts to plan around (verify on neon.com/pricing, they change): about 0.5 GB storage and 100 compute-hours
   per project per month; the compute suspends after ~5 minutes idle and **the first query after that takes a few
   seconds** (cold start). `/api/ready` touches the DB; `/api/health` does not, so health checks do not keep Neon awake.
3. Apply migrations: `cd backend && DATABASE_URL='<your string>' npm run migrate`.

## 2. Backend on Render
* Root directory `backend`, build `npm ci`, start `npm start`, health check path `/api/health`.
* Free web services spin down after ~15 minutes idle and take about a minute to wake; the frontend shows a "waking up"
  state and retries reads. All rooms are lost on restart.
* Environment (see `backend/.env.example`): `NODE_ENV=production`, `DATABASE_URL`, `SESSION_SECRET` (`openssl rand -hex 32`),
  `FRONTEND_URL=https://YOUR-APP.vercel.app`, `BACKEND_URL=https://YOUR-BACKEND.onrender.com`, `ALLOWED_ORIGINS`,
  `TRUST_PROXY_HOPS=1`, plus Google and SMTP variables. The server refuses to start in production without
  `SESSION_SECRET`, `DATABASE_URL`, `FRONTEND_URL`.
* Keep a **single instance** (rooms and rate-limit counters are in memory).

## 3. Frontend on Vercel
* Root directory `frontend`. **Install command: not decided.** The repo contains both `package-lock.json` and `bun.lock`;
  tell us which one Vercel actually uses. `frontend/package-lock.json` was updated (patched dependencies + `three`);
  `bun.lock` was NOT touched and is therefore out of date relative to `package.json` if Vercel runs Bun.
* Edit `frontend/vercel.json`: replace `YOUR-BACKEND.onrender.com` with your Render host.
* Env vars: `VITE_SOCKET_URL=https://YOUR-BACKEND.onrender.com`. Leave `VITE_API_BASE_URL` unset (the app uses `/api`).
* Why the rewrite: the browser only talks to your Vercel origin for REST, so the session cookie is first-party and
  survives browsers that block third-party cookies. WebSockets are *not* proxied (Socket.IO connects directly to Render
  using a one-time ticket, so no cookie is needed there).
* Fallback if the rewrite misbehaves: put frontend and backend on subdomains of one domain (e.g. `app.` and `api.`),
  set `COOKIE_DOMAIN`, `VITE_API_BASE_URL=https://api.example.com/api`.

## 4. Google OAuth
Google Cloud Console → APIs & Services → Credentials → OAuth client (Web). Authorized redirect URI:
`https://YOUR-APP.vercel.app/api/auth/google/callback` (rewrite setup) and `http://localhost:4000/api/auth/google/callback`
for local. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REDIRECT_URI` to the exact same URI. The secret
lives only on the backend.

## 5. SMTP (e-mail OTP)
Any SMTP provider. Free tiers are limited and not a production guarantee: Brevo ~300 mails/day, Resend ~100/day
(check current terms); a personal Gmail account is unsuitable. Set `SMTP_HOST/PORT/USER/PASS/FROM`. Codes are never logged.

## 6. Rollback
Vercel: promote the previous deployment. Render: redeploy the previous commit. Migrations are forward-only SQL files
in `backend/migrations`; write a new migration to undo a change.

## 7. Verify a real deployment
```
node scripts/verify-deployment.mjs https://YOUR-APP.vercel.app https://YOUR-BACKEND.onrender.com
```
Checks cookie issuance through the rewrite, persistence, credentialed requests, logout/revocation, CORS and the
Socket.IO endpoint (prints cookie attributes only). Exit code 0 means all passed.

## 8. Scaling limits
One instance only. More instances need shared room state (Socket.IO Redis adapter + room store) and shared rate
limiting. Not needed at current scale; do not add Redis until then.
