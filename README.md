# Watchly — YouTube Watch Party

A full-stack real-time watch-party app: React/TanStack Start frontend
(pre-existing) + a new Node/Express/Socket.IO backend (this deliverable).

```
project/
  frontend/watch-party-hq-main/   # pre-existing UI (unchanged design/components)
  backend/                        # new — Express + Socket.IO, in-memory
```

## Running locally

**Backend**
```bash
cd backend
cp .env.example .env
npm install
npm run dev        # http://localhost:4000
```

**Frontend**
```bash
cd frontend/watch-party-hq-main
cp .env.example .env      # already points at http://localhost:4000 by default
npm install --legacy-peer-deps   # see note below
npm run dev         # http://localhost:3000 (TanStack Start dev server)
```

> **Note on `--legacy-peer-deps`**: the frontend's own `package.json` (as
> provided, untouched) has a pre-existing peer-dependency conflict between
> `@hookform/resolvers@5.x` and `valibot` — unrelated to this integration.
> `npm install --legacy-peer-deps` resolves it; a plain `npm install` fails
> the same way with or without the backend changes.

Then open `http://localhost:3000`, create a room, and open the room URL in a
second tab/browser to test multi-user sync.

## Backend architecture

See `backend/README.md` for the full write-up (folder structure, room model,
role enforcement, presence/disconnect handling, REST + Socket.IO event
reference, deployment notes).

In short: everything is in-memory (`RoomManager` singleton holding `Room` →
`Participant` objects), REST is used only to mint a room/seat before the
socket connects, and Socket.IO carries all real-time state (playback sync,
roster, roles). The server is the single source of truth for role
permissions — it never trusts a role claimed by the client.

## Frontend ↔ backend mapping

The frontend (`watch-party-hq-main`) arrived as a **UI-only scaffold** from
Lovable: every component was fully built, but the entire data layer was
placeholder. Specifically, before this integration:

- `src/services/api.js`, `roomService.js`, `socketService.js` — all
  `// TODO`, no real HTTP or socket calls.
- `src/context/RoomContext.jsx` — held hardcoded fake participants and never
  changed except via local `setState`.
- `src/pages/Room/RoomPage.jsx` — every handler (`handlePlay`, `handleSeek`,
  `handleAssignRole`, etc.) just mutated local React state with a `// TODO:
  emit socket ...` comment; nothing ever reached a server.

**No visual component (`Player`, `Controls`, `ParticipantCard`, `RoleBadge`,
`RoomInfo`, `VideoInput`, `Card`, `Button`, etc.) was modified.** The only
files touched are the integration layer:

| Frontend file | Change |
|---|---|
| `src/services/api.js` | Implemented: axios instance pointed at the backend, `VITE_API_BASE_URL`/`VITE_SOCKET_URL`, normalizes backend error shape |
| `src/services/roomService.js` | Implemented: `createRoom`, `joinRoom`, `getRoom` — call the REST endpoints below |
| `src/services/socketService.js` | Implemented: `socket.io-client` wiring (`connect`, `disconnect`, `emit`, `on`) |
| `src/context/RoomContext.jsx` | Rewritten: real state driven by REST results + socket events, session persistence (see below), all room actions (`play`, `pause`, `seek`, `changeVideo`, `assignRole`, `removeParticipant`, `transferHost`, `leaveRoom`) |
| `src/pages/Room/RoomPage.jsx` | Handlers now call the context actions above instead of mutating local state; connects the socket on mount, disconnects on unmount, restores identity from session storage on refresh |
| `src/pages/Home/CreateRoomCard.jsx`, `JoinRoomCard.jsx` | Call `roomService`-backed context methods (`createRoomAndEnter`/`joinRoomAndEnter`) instead of faking a room code client-side; show real errors via `sonner` toasts |
| `src/routes/__root.tsx` | `RoomProvider` moved here (was previously re-instantiated separately in both `routes/index.tsx` and `routes/room.$roomId.tsx`, which silently dropped username/role state on navigation from `/` to `/room/:id` — see below); mounted `<Toaster />` for error/connection feedback |
| `src/routes/index.tsx`, `routes/room.$roomId.tsx` | Removed their now-duplicate local `<RoomProvider>` wrapper |
| `package.json` | Added `socket.io-client` dependency (was missing entirely) |

### The one structural fix that was "unavoidable"

Both routes wrapped their page in their own `<RoomProvider>` instance:

```jsx
// routes/index.tsx (before)
<RoomProvider><HomePage /></RoomProvider>
// routes/room.$roomId.tsx (before)
<RoomProvider><RoomPage /></RoomProvider>
```

Since `RoomProvider` holds `useState`, and each route mounts a *new* instance
on navigation, any state `CreateRoomCard`/`JoinRoomCard` set on the home
page's provider (username, roomId, role) was thrown away the instant
`navigate()` moved to `/room/:roomId` — the room page's fresh provider was
back to defaults (`username: ""`, `role: "host"`). This wasn't reachable with
the old fake/local-only data because nothing depended on it surviving
navigation, but it breaks the moment real identity from the backend has to
survive the trip. The fix was to lift `RoomProvider` to `routes/__root.tsx`
(mounted once for the whole app) and remove the two duplicate wrappers — a
one-line change in three files, no component logic touched.

### Session persistence (refresh survival)

`RoomContext` also persists `{ userId, username, role }` to
`sessionStorage` (keyed per room) after create/join. If someone hard-refreshes
`/room/:roomId`, `RoomPage` restores identity from that instead of losing the
socket connection entirely; if there's no session for that room (e.g. a cold
link with no prior create/join), it redirects home with a toast rather than
silently joining as an empty username.

### Endpoint / event contract

REST (frontend → backend, before the socket connects):

```
POST /api/rooms                  { username } -> { roomId, userId, username, role: "host" }
POST /api/rooms/:roomId/join     { username } -> { roomId, userId, username, role: "participant" }
GET  /api/rooms/:roomId          -> { roomId, participantCount, onlineCount, currentVideo }
```

Socket.IO events match 1:1 with what `RoomPage`'s original TODO comments
named (`play`, `pause`, `seek`, `change_video`, `assign_role`,
`remove_participant`) plus `transfer_host`, `join_room`, `leave_room`, and the
server broadcasts (`room_state`, `sync_state`, `user_joined`, `user_left`,
`role_assigned`, `participant_removed`, `host_changed`). Full table in
`backend/README.md`.

## Deployment

Deploy `backend/` and `frontend/watch-party-hq-main/` as two separate
services (e.g. both on Render, or backend on Render + frontend on Vercel).
Set the frontend's `VITE_API_BASE_URL` / `VITE_SOCKET_URL` to the deployed
backend URL, and the backend's `CORS_ORIGIN` to the deployed frontend URL.
