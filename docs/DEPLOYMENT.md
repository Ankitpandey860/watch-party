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

**Why `GOOGLE_REDIRECT_URI` matters with the Vercel rewrite.** Sign-in starts at `/api/auth/google/start` on the *Vercel*
origin, so the short-lived flow cookie (`wp_oauth`) is stored for the Vercel host. Google then sends the browser back to
`GOOGLE_REDIRECT_URI`. If that points at the Render host (the default when the variable is unset), the browser does not
send the cookie there, and the login fails after the Google step with `/auth?error=oauth_failed`.

Reading the backend log (each failed sign-in prints one line with the failing stage; no secrets, codes or tokens):

| Log line | Meaning / fix |
|---|---|
| `stage=flow-cookie-missing … callbackHost=A redirectUriHost=B` | The callback arrived without the flow cookie. Make `GOOGLE_REDIRECT_URI` use the same host that serves `/api/auth/google/start` (your Vercel URL) and register that exact URI in Google Cloud Console. Also happens if the callback is opened in another browser. |
| `stage=flow-cookie-invalid` | Cookie present but cannot be opened: `SESSION_SECRET` changed between start and callback (or the cookie was tampered with). |
| `stage=flow-expired` | The user took longer than 10 minutes. |
| `stage=state-mismatch` | State differs from the one we issued (CSRF attempt or two tabs racing). |
| `stage=token-exchange status=400 oauth_error=invalid_grant` | Code already used/expired, or PKCE/redirect URI mismatch between start and callback. |
| `stage=token-exchange status=401 oauth_error=invalid_client` | `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` wrong or from a different OAuth client. |
| `stage=token-exchange … oauth_error=redirect_uri_mismatch` | `GOOGLE_REDIRECT_URI` differs from the registered URI by even one character. |
| `stage=discovery` / `stage=token-exchange code=ETIMEDOUT` | The backend cannot reach Google (network). |
| `stage=id-token-verify code=ERR_JWT_CLAIM_VALIDATION_FAILED claim=aud` | The ID token is for a different client id. `claim=iss`/`ERR_JWT_EXPIRED` are issuer/expiry failures. |
| `stage=nonce-mismatch`, `stage=claims` | Replayed token / token without `sub` or `email`. |
| `stage=post-auth code=…` | Google was fine; looking up/creating the user or the session failed (database). |

At startup the backend logs `Google redirect URI in use: …`; at the first sign-in it warns
(`Google sign-in misconfiguration …`) if `/google/start` is served for a different host than the redirect URI.
`node scripts/verify-deployment.mjs <vercel-url> <render-url>` checks this against the real deployment.

## 5. E-mail OTP delivery
**Render free web services block outbound SMTP on ports 25, 465 and 587** (since 26 Sep 2025; paid instances are not
affected; see Render's changelog "Free web services will no longer allow outbound traffic to SMTP ports"). On a free
instance an SMTP connection therefore ends in `ETIMEDOUT` regardless of credentials. Choose one:

1. **HTTPS e-mail API (recommended on the free tier).** Set `EMAIL_PROVIDER=resend` (or `brevo`), `EMAIL_API_KEY`
   (secret, Render environment only) and `EMAIL_FROM` (a sender/domain you verified with the provider). Traffic uses
   port 443, which Render does not block. No extra dependency.
   * Resend: create an API key and verify a sending domain; use an `EMAIL_FROM` on that domain.
   * Brevo: create an API (v3) key, and add/verify the sender address you use in `EMAIL_FROM`.
   * Check the provider's current free-tier and sender-verification rules before relying on either.
2. **SMTP** on a paid Render instance or another host: `SMTP_HOST/PORT/USER/PASS/FROM`
   (587 + `SMTP_SECURE=false` for STARTTLS, 465 + `SMTP_SECURE=true` for implicit TLS).

If `EMAIL_PROVIDER` is `resend`/`brevo` and both key and sender are set, the API is used and SMTP is ignored.
The startup log says which is active (`Email delivery: HTTPS API (resend)` or `Email delivery: SMTP host:port …`).
Free-tier limits change (Brevo ~300 mails/day, Resend ~100/day when last checked); a personal Gmail account is unsuitable.
Codes, API keys and SMTP passwords are never logged.

Failure lines (`SMTP send failed: class=…` / `Email API send failed: class=…`):

| class | Meaning |
|---|---|
| `connect-timeout` (`ETIMEDOUT`, `command=CONN`) | The TCP connection never opened: blocked port (Render free tier) or wrong host/port. |
| `timeout` | Connected, then the server stopped answering. |
| `connection` | Refused / DNS failure / network unreachable. |
| `auth` (`EAUTH`, 535 / HTTP 401, 403) | Wrong SMTP user/password or API key. |
| `tls` | Wrong `SMTP_SECURE` for the port (465 needs `true`; 587/2525 need `false`). |
| `rejected` (HTTP 4xx, SMTP 5xx) | Sender not verified, or recipient refused. |
| `rate-limited` (HTTP 429) | Provider quota reached. |

When sending fails the user sees "We couldn't send the email" (503) and the code that was generated is invalidated.

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
