# Architecture

```
Browser ──HTTPS /api/*──▶ Vercel (rewrite) ──▶ Render: Express  ──▶ Postgres (Neon)   users, identities,
   │                                                │                                  sessions, OTP challenges
   └────WebSocket (Socket.IO, one-time ticket)──────┘──▶ in-memory rooms (single instance)
```

## Identity and sessions
* **Principals**: `user` (account, may create rooms and own them) or `guest` (invite-link joiner, display name only).
  Both get an opaque random session token in an HttpOnly, SameSite=Lax cookie (`__Host-wp_session` in production).
  Only the SHA-256 of the token is stored (`sessions` table). Re-login rotates the session; logout/expiry revokes it and
  any live socket receives `auth_expired`.
* **Login**: Google (authorization code + PKCE S256 + `state` + `nonce`, server-side exchange, `jose` ID-token verification
  of issuer/audience/expiry/nonce/`email_verified`) and e-mail OTP (6-digit CSPRNG code, HMAC bound to challenge+email,
  10-minute TTL, single use, 5 attempts, resend cooldown, identical error for every failure, anti-enumeration responses).
* **Account linking**: only on a *verified* e-mail; `UNIQUE(provider, subject)` stops duplicates.
* **CSRF**: state-changing requests must carry `X-Requested-With: watchparty` and an allow-listed `Origin`.

## Sockets
`POST /api/rooms/:id/socket-ticket` → a 30-second, single-use, room-bound ticket (hash held in memory) → Socket.IO
handshake `auth.ticket`. The server sets `socket.data` identity from the ticket; client-supplied `userId`, `role`,
`isHost` etc. are never read. Every event goes through `socket/safeHandler.js`: payload must be a plain object, per-socket
token buckets (chat/playback/admin/join) with strike-disconnect, handler exceptions contained (this is the malformed-packet
crash fix). Max payload 16 KB, origin allow-list on the handshake.

## Rooms (in memory)
`models/Room.js` owns state: owner vs acting host, moderators, bans, participants, playback. Rules: guests can never be
host or moderator; the owner cannot be removed; kick = ban for the room's lifetime; if the host disconnects a grace
timer elapses before an acting host (a *user*) is promoted and the owner is restored when they return; pause records the
projected position; `time_sync` carries a sequence number and stale/too-frequent reports are dropped; seek is range-checked.
Caps: global rooms, rooms per user, participants per room; an idle sweeper deletes abandoned rooms.

## Playback providers
`backend/src/providers/` and `frontend/src/providers/` hold a registry; the room core only talks to `provider` + `videoId`.
Only YouTube is registered. Adding another *permitted* provider means a new adapter + registry entry. No DRM/OTT
integration is implemented or implied.

## Frontend
TanStack Start/Router + React 19. `AuthContext` (session status) and `RoomContext` (socket lifecycle, terminal states).
Landing/auth/create/room pages. The 3D layer (`src/three/`) is a procedural Three.js scene, dynamically imported, with
capability detection (WebGL, reduced motion, low power, user toggle) and a CSS fallback that is always rendered.

## Known limits
Single backend instance (rooms, socket tickets and rate-limit counters are per-process); scaling out needs shared room
state (e.g. Redis adapter) and shared rate limiting. A Render restart drops all rooms. See `docs/DEPLOYMENT.md`.
