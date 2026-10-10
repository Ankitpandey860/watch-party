# Phase 0 baseline

Everything here was measured on 2026-10-04 (Node 22.22.2, npm 10.9.7) against the code
exactly as uploaded, before any behaviour change. Nothing is estimated.

## Running the checks

| | Command (from the folder) | What it does |
|---|---|---|
| Backend | `npm test` | Node's built-in test runner (`tests/*.test.js`), real Express + Socket.IO on an ephemeral port |
| Frontend | `npm run lint` · `npm test` · `npm run build` | ESLint+Prettier · Vitest (jsdom) · production build |

## Baseline (before Phase 0 changes)

| Check | Result |
|---|---|
| Backend boots | OK (`node src/server.js`) |
| Backend tests | none existed |
| Frontend `npm run build` | OK |
| Frontend `npm run lint` | **FAIL**: 16 errors (all Prettier formatting), 6 warnings (shadcn `react-refresh`) |
| Frontend tests | none existed |
| `npm audit` | backend: 5 (1 high: engine.io); frontend prod deps: high findings in axios and fast-uri. **Not fixed in Phase 0.** |

## Characterization tests

Tests assert what the code does **today**. Tests prefixed `KNOWN ISSUE (batch N)` pin
current *defective* behaviour on purpose; the batch named in the title flips that assertion
when it fixes the defect, so each batch's diff shows exactly which behaviour changed.

| Batch | Known issues pinned |
|---|---|
| 1a | one `null` socket payload crashes the whole process (`crash.char.test.js`) |
| 1 | `userId` is the only credential and is public, so host takeover is possible |
| 2 | no rate limits; rooms/seats created over REST are never garbage-collected |
| 3 | kick is not a ban |
| 4 | the original host is not restored after reconnecting |
| 5 | pause discards elapsed play time; stale `time_sync` overwrites a newer seek |
| 6 | frontend ignores `disconnect`/`connect_error` |
| 7 | unlimited playback/chat events; seek slider emits per change |
| 8 | CORS reflects any origin; malformed JSON returns 500; unvalidated video ids |

## Lockfile decision (frontend)

`frontend/` contains both `package-lock.json` (npm) and `bun.lock`. Evidence gathered:

- `package-lock.json` is the current one. `bun.lock` lacks `socket.io-client`,
  `engine.io-client` and `react-youtube`, which the app imports, and differs from the npm
  lock in 214 of 469 shared package versions (e.g. vite 8.0.16 vs 8.1.5).
- Vercel infers the package manager from the lockfile (`bun.lock` -> `bun install`,
  `package-lock.json` -> `npm install`) unless the dashboard sets an Install Command. Its docs
  do not say what happens when both exist. The repo has no `vercel.json`, so which one
  your deployment uses can only be read from your Vercel build log.
- **Therefore neither lockfile was deleted in Phase 0.** CI uses `npm ci` against
  `package-lock.json`, which fails if it drifts from `package.json`.

To settle it: open the latest Vercel deployment's build log and look at the line after
"Installing dependencies" / "Running install command". If it says `npm install`, delete
`bun.lock` and `bunfig.toml`. If it says `bun install`, tell us before we change anything.
