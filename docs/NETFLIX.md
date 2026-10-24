# Netflix integration notes

## How it works
Every viewer plays Netflix in **their own tab with their own account**. Nothing is restreamed, downloaded or decrypted. The Watch Party server only relays room state (provider, title id, playing, position, rate, seq).

1. The signed-in user clicks "Pair extension" in the room: the server issues a one-time code (default 120 s).
2. The extension exchanges the code for a revocable, scoped credential bound to that user, room and participant, then mints short-lived socket tickets for a *companion socket* attached to the participant.
3. A MAIN-world content script talks to Netflix's player through an isolated adapter (`extension/src/content/adapters/netflixCadmium.js`). If that API is missing it falls back to a limited DOM adapter (play/pause only, never seeks, never writes `video.currentTime`) and tells the user.
4. The extension never sends Netflix cookies or tokens; the server tables hold none.

## Sync rules
Server state is canonical with a monotonic `seq`. Commands carry a media `ref`; mismatches are refused (`MEDIA_MISMATCH`). The extension only controls a tab on the room's title (wrong-title tabs are reported, not controlled), picks one tab if several match, suppresses echoes of its own actions, never fights buffering, and re-syncs after reconnect. Only host (and moderators, if the host allows) can issue commands; viewers' local pauses are reverted.

## Terms-of-service risk
Netflix's terms restrict circumventing technical protections and automated access; the earlier review quoted 1.8(iii)-(vi). The extension does not touch DRM or streams, but it **uses an undocumented internal player interface**, which Netflix may treat as unauthorised and can change any time. Use at your own risk; this is not legal advice.

## Verification status (be precise)
| Category | Result |
|---|---|
| Unit tests (extension, fake chrome/player) | 106 pass |
| Backend pairing/permission integration tests | in the backend suite (see TESTING.md) |
| Mock-Netflix-page e2e (2 real Chromium profiles, real extension, real backend) | 39/39 pass - **a mock page, not netflix.com** |
| Actual netflix.com page tests | **NOT RUN** - no Netflix account/session available here |
| Real multi-account sync | **NOT RUN** |

The private API shape (`netflix.appContext.state.playerApp.getAPI().videoPlayer`, millisecond units) comes from public descriptions and is unverified against the live site. Follow the checklist in TESTING.md to verify.

## Security and correctness review (code review, not a real-site test)
* **Page bridge** (`netflixMain.js`): the only code touching Netflix's player object. Allow-list of six operations, input ranges re-validated, fails closed. Handshake uses a nonce and a private MessageChannel. Any script already running on netflix.com could also request a channel, but it can then do nothing it could not already do to the player; no cookie, token or media data is reachable through it. Reviewed fix: channels are now capped (4) and released when the isolated side closes, instead of leaking.
* **Content script**: validates every message from the worker (`parseTarget`) and checks `sender.id`. Reviewed fix: after an extension reload the orphaned script now stops its timers instead of erroring every second.
* **Service worker**: accepts reports only from netflix.com tabs and control messages only from the extension's own pages; diagnostics redact tokens/cookies. The pairing credential lives in `chrome.storage.local` (revocable, 12 h default TTL).
* **Tab targeting**: only tabs on the room's title qualify; among several, the active, then playing, then most recent one wins.
* **Manifest**: fixed host permission is only `https://www.netflix.com/*`; the Watch Party server origin is an *optional* permission the user grants when pairing. No `externally_connectable`, no web-accessible resources.
* Not verifiable without a real session: that the internal API still exists, that `seek` behaves on all title types, and ad-tier behaviour.

## Known limitations
Desktop Chromium only; ads pause sync; speed sync unsupported; a Netflix update can degrade seek support (the extension reports "limited mode").
