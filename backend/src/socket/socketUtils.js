import { SERVER_EVENTS } from "../constants/events.js";
import { AppError, ERROR_CODES } from "../constants/errors.js";

/** Sends a structured, user-facing error to a single socket. Never throws, never leaks internals. */
export function emitError(socket, err) {
  if (err instanceof AppError) {
    socket.emit(SERVER_EVENTS.ERROR, { code: err.code, message: err.message, ...(err.extra || {}) });
  } else {
    socket.emit(SERVER_EVENTS.ERROR, { code: ERROR_CODES.INTERNAL_ERROR, message: "Something went wrong." });
  }
}

/** Broadcasts the current participants list to everyone in the room (including sender). */
export function broadcastParticipants(io, room) {
  io.to(room.roomId).emit(SERVER_EVENTS.PARTICIPANTS_UPDATED, {
    participants: room.publicRoster(),
    hostId: room.hostId,
  });
}

export function playbackSnapshot(room) {
  const cv = room.getEffectivePlayback();
  return {
    provider: cv.provider,
    videoId: cv.videoId,
    playing: cv.playing,
    currentTime: cv.currentTime,
    updatedAt: cv.updatedAt,
    seq: cv.seq,
  };
}
