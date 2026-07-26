// Client -> Server
export const CLIENT_EVENTS = Object.freeze({
  JOIN_ROOM: "join_room",
  LEAVE_ROOM: "leave_room",
  PLAY: "play",
  PAUSE: "pause",
  SEEK: "seek",
  CHANGE_VIDEO: "change_video",
  // Lightweight periodic ping from whoever is playing, carrying just the
  // current playback position. Does NOT toggle playing/paused and does NOT
  // force a hard seek on clients — it only updates the server's authoritative
  // clock so drift-correction and rejoin snapshots stay accurate between
  // discrete play/pause/seek commands.
  TIME_SYNC: "time_sync",
  ASSIGN_ROLE: "assign_role",
  REMOVE_PARTICIPANT: "remove_participant",
  TRANSFER_HOST: "transfer_host",
  SEND_MESSAGE: "send_message",
});

// Server -> Client
export const SERVER_EVENTS = Object.freeze({
  ROOM_STATE: "room_state", // full snapshot sent right after a successful join
  SYNC_STATE: "sync_state", // playback state broadcast (play/pause/seek/change_video)
  USER_JOINED: "user_joined",
  USER_LEFT: "user_left",
  PARTICIPANTS_UPDATED: "participants_updated",
  ROLE_ASSIGNED: "role_assigned",
  PARTICIPANT_REMOVED: "participant_removed",
  HOST_CHANGED: "host_changed",
  REMOVED_FROM_ROOM: "removed_from_room", // sent only to the participant who got kicked
  NEW_MESSAGE: "new_message", // broadcast to the room whenever a chat message is sent
  ERROR: "error_event", // "error" is a reserved Socket.IO event name, so we use our own
});
