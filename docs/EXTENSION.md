# Netflix extension: install and pair

Chrome/Chromium 116+ only (Firefox is not implemented or tested).

```bash
cd extension && npm ci && npm run build      # -> extension/dist
```
1. Open `chrome://extensions`, enable Developer mode, **Load unpacked**, choose `extension/dist`.
2. Copy the extension's id from that page. In production set `EXTENSION_ORIGINS=chrome-extension://<id>` on the backend (the id of an unpacked build depends on its folder path unless you add a manifest `key`).
3. Join a room in the Watch Party site, open the Netflix panel and click **Pair extension** to get a code.
4. Open the extension popup, enter your Watch Party site URL (Chrome asks permission for that one origin) and the code.
5. Open the same `netflix.com/watch/<id>` title in your Netflix account. The popup shows paired / on title / controlled state.

Revoke from the web app ("Revoke") or the popup ("Disconnect"); the credential stops working immediately. `npm run package` zips `dist/`. `npm run build:test` makes a **test-only** build that also trusts a local mock origin; never ship it.

Troubleshooting: "wrong title" = open the room's title; "limited mode" = Netflix's player API wasn't found (play/pause only); "Not paired" = code expired/used or revoked, pair again.
