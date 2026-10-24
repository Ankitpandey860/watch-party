# Testing guide

| What | Command | Notes |
|---|---|---|
| Backend | `cd backend && npm ci && npm test` | node:test, embedded Postgres |
| Frontend | `cd frontend && npm ci && npm test && npm run lint && npm run build` | Vitest, ESLint |
| Extension unit | `cd extension && npm ci && npm test && npm run lint` | fake chrome/player |
| Mock e2e | `cd extension && npm run build:test && xvfb-run -a node e2e/run.mjs` | needs Chromium (`PLAYWRIGHT_BROWSERS_PATH`); writes `e2e/last-run.json`. Uses a MOCK Netflix page. |

Results are recorded in the release report, not hard-coded here.

## Real-Netflix checklist (manual; two profiles, two Netflix accounts)
1. Build/load the extension in two separate Chrome profiles; sign each into its own Netflix.
2. Host creates a room; viewer joins (second profile). Both pair the extension.
3. Host loads one `netflix.com/watch/<id>` and both open it. Both popups: on title.
4. Play, pause, seek by host: viewer follows within ~2.5 s. Viewer pauses locally: reverted.
5. Third profile joins late: starts at the projected position.
6. Disable network for the viewer 20 s, restore: it reconnects and re-syncs.
7. Open a different title in the viewer: popup says wrong title and it is not controlled.
8. Revoke the viewer's pairing in the web app: its popup drops to Not paired.
Record browser version, date and pass/fail for each step; report any step where the popup shows "limited mode".
