# 🎬 Watch Party

Watch YouTube together in real time: synchronized play/pause/seek, live chat, host and moderator controls, and an
interactive 3D (Three.js) interface. Accounts sign in with **Google** or an **e-mail one-time code**; friends join through
an **invite link with just a display name** (guest). Roles are decided by the server, never the client.

Docs: [ARCHITECTURE.md](ARCHITECTURE.md) · [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) · [docs/PHASE0_BASELINE.md](docs/PHASE0_BASELINE.md)

## Quick start (local, no external services)
Requires Node 20+.
```bash
# terminal 1: backend (embedded Postgres, no setup)
cd backend && npm ci && cp .env.example .env && npm run dev     # http://localhost:4000

# terminal 2: frontend
cd frontend && npm ci && npm run dev                            # http://localhost:5173
```
`backend/.env.example` defaults to `DATABASE_URL=pglite://./.data/dev` (embedded, self-migrating). Without SMTP settings
e-mail sign-in is unavailable; without Google settings Google sign-in is unavailable. Guests can always join by invite link,
but creating a room needs an account, so configure at least one sign-in method (SMTP is the quickest: e.g. a free Brevo or
Mailpit/MailHog server on localhost:1025 with `SMTP_HOST=localhost SMTP_PORT=1025 SMTP_FROM=dev@localhost`).

### Real Postgres / Neon
Set `DATABASE_URL` to a Postgres connection string, then `npm run migrate` in `backend/`.

### Google OAuth / SMTP
See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) §4–5 and `backend/.env.example` (placeholders only: never commit real values).

## Commands
| Where | Command | What |
|---|---|---|
| backend | `npm test` | 198 tests (node:test; embedded Postgres; set `TEST_DATABASE_URL` to also run against real Postgres) |
| backend | `npm run migrate` | apply SQL migrations |
| frontend | `npm test` | 260 tests (Vitest) |
| frontend | `npm run lint` / `npm run build` | ESLint / production build |
| root | `node scripts/verify-deployment.mjs <frontend> <backend>` | verify a live deployment |

## Security overview
HttpOnly opaque session cookies (hash stored), rotation and revocation; CSRF guard + CORS allow-list; one-time room-bound
socket tickets; server-authoritative roles; guests can never host/moderate; bans enforced on join; strict payload
validation and per-event rate limits; OTP codes HMAC-stored, single-use and attempt-limited; Google ID tokens verified
server-side; no secrets in the repo. Details in [ARCHITECTURE.md](ARCHITECTURE.md).

## Known limitations
* Single backend instance: rooms, socket tickets and rate limits live in memory; a restart drops rooms.
* Render/Neon free tiers cold-start (about a minute / a few seconds).
* Only YouTube is supported. Other platforms are not integrated (no permitted mechanism has been verified).
* Live Google, SMTP, Vercel-rewrite and real-device 3D performance have not been verified (tests use mocks/simulations).
* Lockfiles: see DEPLOYMENT.md §3 (Vercel's install command is still to be confirmed).
