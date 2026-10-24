# Provider compatibility matrix

A provider is listed in the app only when its integration is real. "Tested" always says *how*.

| Provider | Mode | Play/pause | Seek | Speed | Status |
|---|---|---|---|---|---|
| YouTube | embedded (IFrame API) | yes | yes | yes | Implemented. Unit/integration tested; existing behaviour preserved. |
| Vimeo | embedded (`@vimeo/player`) | yes | yes | yes (owner may disable) | Implemented. Tested against a fake SDK; **not** tested against live Vimeo. |
| Twitch VOD | embedded (official embed) | yes | yes | no | Implemented. Tested against a fake SDK; **not** tested against live Twitch. |
| Twitch clip | embedded | no | no | no | Shown only, everyone presses play. Not remote-controllable. |
| Twitch live | - | - | - | - | Refused with an explanation. |
| Netflix | companion (our extension) | yes | yes (full API adapter only) | no | Implemented. Mock-page tested only; **not verified on real Netflix**. See [NETFLIX.md](NETFLIX.md). |
| Plex | - | - | - | - | **Not implemented** (see below). |
| Jellyfin | - | - | - | - | **Not implemented** (see below). |
| Prime Video, Disney+, JioHotstar, SonyLIV, ZEE5, Crunchyroll | - | - | - | - | **Not implemented** (see below). |

## URL patterns
* YouTube: watch / youtu.be / embed / shorts links, or an 11-character id.
* Vimeo: `vimeo.com/<id>`, `vimeo.com/<id>/<hash>` (unlisted), `player.vimeo.com/video/<id>?h=<hash>`, channel/group/album paths. A bare id needs the provider chosen explicitly. Look-alike hosts and unknown path shapes (e.g. `/../etc/<id>`) are rejected.
* Twitch: `twitch.tv/videos/<id>`, `clips.twitch.tv/<slug>`, `twitch.tv/<channel>/clip/<slug>`. Channel (live) URLs are refused.
* Netflix: `https://www.netflix.com/watch/<id>` (optional locale prefix). `/title/...`, http and look-alikes are rejected.

## Requirements and restrictions
* Twitch's embed needs a `parent` equal to the site's hostname; the adapter derives it from `location.hostname`. Subscriber-only/mature VODs need a signed-in viewer.
* Vimeo private videos need the owner to allow embedding on your domain.
* Netflix needs desktop Chrome/Chromium 116+, the extension, and each viewer's own subscription.

## Investigated and NOT implemented
* **Plex** - Plex's remote-control commands target a specific Plex client and are not a documented, supported server-mediated API (users request one on the Plex forum). Playing in our page would mean proxying the user's media server stream with their token. No reliable, permission-respecting path that I could test, so nothing is listed.
* **Jellyfin** - has session remote-control commands, but they need the server URL plus a user token, and community reports show commands returning 204 without effect on some versions. Implementing it needs a reachable Jellyfin server to verify against; none was available, so it is not listed. A future implementation would keep the token only in the user's browser, never in room state.
* **Prime Video, Disney+, JioHotstar, SonyLIV, ZEE5, Crunchyroll** - DRM'd, no embeddable player or public control API. The Netflix technique would need a separate internal-API adapter per service, with its own ToS risk and no way to test here. Not advertised. (The Prime Video terms page could not be read from this environment; that remains unchecked.)
