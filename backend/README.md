# Watchly Backend

Express + Socket.IO backend for **Watchly**, a YouTube watch-party app. Fully
in-memory — no database, no auth, no Redis, no Docker — built to sit behind
the existing `watch-party-hq-main` React/TanStack Start frontend without
requiring any UI changes.

## Stack

- Node.js (ES Modules)
- Express (REST: create/join room)
- Socket.IO (real-time: playback sync, roles, presence)
- `uuid` for stable participant IDs

No TypeScript, no NestJS, no Next.js, no Firebase/Supabase, no Prisma, no
GraphQL, no database — per spec, everything lives in memory for the process
lifetime.

## Getting started

```bash
cd backend
cp .env.example .env      # adjust CORS_ORIGIN if your frontend runs elsewhere
npm install
npm run dev                # or `npm start`
```

The server listens on `PORT` (default `4000`) and exposes:
- REST API under `http://localhost:4000/api`
- Socket.IO under `http://localhost:4000` (default namespace)

## Architecture

```
backend/src/
  config/         env loading, CORS options shared by Express + Socket.IO
  constants/      roles, socket event names, error codes — single source of truth
  models/         Room and Participant classes (plain OOP, no ORM)
  services/       roomManager (in-memory store), roomService (REST business
                  logic), permissionService (role checks — never trusts the client)
  controllers/    REST controllers, thin wrappers around roomService
  routes/         Express routers
  middlewares/    errorHandler, notFound
  socket/         Socket.IO server + one handler module per concern
    handlers/
      roomHandlers.js      join_room, leave_room, disconnect (+ grace period)
      playbackHandlers.js  play, pause, seek, change_video
      roleHandlers.js      assign_role, remove_participant, transfer_host
  app.js          Express app factory
  server.js       entry point — HTTP server + Socket.IO
```

### Room state (in-memory)

```js
Room {
  roomId,
  hostId,
  participants: Map<userId, Participant>,
  currentVideo: { videoId, playing, currentTime, updatedAt },
}

Participant {
  id, username, role, online, socketId, joinedAt,
}
```

Nothing is persisted — restarting the server clears all rooms.

### Roles & permission enforcement

Three roles: `host`, `moderator`, `participant` (the assignment's MVP
simplification — `participant`/`viewer` are treated as the same role, matching
the frontend's `RoleBadge`, which only renders these three).

| Action                                   | Who              |
|-------------------------------------------|------------------|
| play / pause / seek / change_video        | host, moderator  |
| assign_role, remove_participant, transfer_host | host only   |

Every socket handler re-derives the acting participant's role **from the
server's own room state**, keyed by a server-issued `userId` — it never trusts
a role sent by the client. See `services/permissionService.js`.

### Presence & disconnect handling

The frontend's `ParticipantCard`/`Avatar` already render an `online` dot, so
the backend treats disconnects as "went offline", not "left":

- On socket disconnect, the participant is marked `online: false` but **stays**
  in the room (keeping their role/seat) for `DISCONNECT_GRACE_SECONDS` (default
  60s), in case it's just a refresh or a network blip.
- If the disconnecting user was the **host**, control is handed to the next
  online moderator (or longest-tenured online participant) immediately — no
  one is stuck waiting 60s for control of playback.
- If they don't reconnect before the grace period elapses, they're fully
  removed and the room roster updates.
- An empty room (zero participants, including offline ones) is deleted after
  `EMPTY_ROOM_TTL_SECONDS` (default 30s).

### YouTube integration

Per spec, the backend never talks to the YouTube API. It only stores and
relays `videoId` + `playing` + `currentTime`. `change_video` accepts either a
raw video ID or a full YouTube URL and re-validates/re-extracts the ID
server-side (`utils/youtube.js`) — it never trusts a client-supplied ID as-is.

## REST API

| Method | Path                    | Body                | Response                                          |
|--------|--------------------------|----------------------|----------------------------------------------------|
| POST   | `/api/rooms`             | `{ username }`       | `{ roomId, userId, username, role: "host" }`       |
| POST   | `/api/rooms/:roomId/join`| `{ username }`       | `{ roomId, userId, username, role: "participant" }`|
| GET    | `/api/rooms/:roomId`     | –                     | `{ roomId, participantCount, onlineCount, currentVideo }` |
| GET    | `/api/health`            | –                     | `{ status, uptime, roomCount, totalParticipants }` |

Errors are always `{ "error": { "code": "...", "message": "..." } }` with an
appropriate HTTP status (400/403/404/409).

These REST calls run **before** the socket ever connects — they let the
Create/Join Room forms show a real error ("room not found", "username taken")
without navigating to `/room/:roomId` first. The socket then reuses the
`userId` they mint.

## Socket.IO events

**Client → Server**

| Event                | Payload                        | Notes                          |
|-----------------------|----------------------------------|---------------------------------|
| `join_room`           | `{ roomId, userId, username }`  | idempotent; reconnect-safe      |
| `leave_room`          | –                                | explicit leave                  |
| `play` / `pause`      | –                                | host/moderator only             |
| `seek`                | `{ time }`                      | host/moderator only             |
| `change_video`        | `{ url }` or `{ videoId }`      | host/moderator only             |
| `assign_role`         | `{ userId, role }`              | host only; role: moderator\|participant |
| `remove_participant`  | `{ userId }`                    | host only                       |
| `transfer_host`       | `{ userId }`                    | host only; target must be online|

**Server → Client**

| Event                 | Sent to      | Payload                                       |
|------------------------|--------------|-------------------------------------------------|
| `room_state`           | joiner only  | `{ roomId, hostId, currentVideo, participants, you }` |
| `sync_state`           | room         | `{ videoId, playing, currentTime, updatedAt }` |
| `user_joined`          | room         | `{ participant, participants }`                |
| `user_left`            | room         | `{ userId, username, participants }`           |
| `participants_updated` | room         | `{ participants, hostId }` (presence-only changes) |
| `role_assigned`        | room         | `{ userId, username, role, participants }`     |
| `participant_removed`  | room         | `{ userId, username, participants }`           |
| `removed_from_room`    | removed user | `{ roomId }`                                   |
| `host_changed`         | room         | `{ hostId, participants }`                     |
| `error_event`          | sender only  | `{ code, message }`                            |

(`error` is reserved by Socket.IO for transport-level errors, so app-level
errors use `error_event` instead.)

## Frontend integration

The frontend (`watch-party-hq-main/`) was a UI-only scaffold — its
`services/api.js`, `roomService.js`, `socketService.js`, and
`context/RoomContext.jsx` were all `// TODO` stubs with no real logic. Those
were filled in to call this backend; no visual component was changed. See the
root `README.md` for the full list of frontend touch points.

## Environment variables

See `.env.example`:

- `PORT` — HTTP/Socket.IO port (default `4000`)
- `CORS_ORIGIN` — comma-separated allowed origins
- `DISCONNECT_GRACE_SECONDS` — how long an offline participant keeps their seat
- `EMPTY_ROOM_TTL_SECONDS` — how long an empty room lives before GC

## Deployment

Any Node host works (Render, Railway, Fly.io, etc.) since there's no database:

1. Set `CORS_ORIGIN` to your deployed frontend's URL.
2. `npm install && npm start`.
3. Point the frontend's `VITE_API_BASE_URL` / `VITE_SOCKET_URL` at this
   service's public URL.
