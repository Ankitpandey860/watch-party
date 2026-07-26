import { roomManager } from "../../services/roomManager.js";
import { assertCanControlPlayback } from "../../services/permissionService.js";
import { CLIENT_EVENTS, SERVER_EVENTS } from "../../constants/events.js";
import { AppError, ERROR_CODES } from "../../constants/errors.js";
import { resolveVideoId } from "../../utils/youtube.js";
import { emitError, playbackSnapshot } from "../socketUtils.js";

function getRoomAndActor(socket) {
  const { roomId, userId } = socket.data;
  if (!roomId || !userId) {
    throw new AppError(ERROR_CODES.NOT_IN_ROOM, "Join a room before controlling playback.", 400);
  }
  const room = roomManager.getRoom(roomId);
  if (!room) throw new AppError(ERROR_CODES.ROOM_NOT_FOUND, "This room no longer exists.", 404);
  const actor = room.getParticipant(userId);
  if (!actor) throw new AppError(ERROR_CODES.PARTICIPANT_NOT_FOUND, "You're not in this room.", 403);
  return { room, actor };
}

function broadcastSync(io, room, reason) {
  io.to(room.roomId).emit(SERVER_EVENTS.SYNC_STATE, { ...playbackSnapshot(room), reason });
}

export function registerPlaybackHandlers(io, socket) {
  socket.on("play", () => {
    try {
      const { room, actor } = getRoomAndActor(socket);
      assertCanControlPlayback(actor);
      room.updatePlayback({ playing: true });
      broadcastSync(io, room, "play");
    } catch (err) {
      emitError(socket, err);
    }
  });

  socket.on("pause", () => {
    try {
      const { room, actor } = getRoomAndActor(socket);
      assertCanControlPlayback(actor);
      room.updatePlayback({ playing: false });
      broadcastSync(io, room, "pause");
    } catch (err) {
      emitError(socket, err);
    }
  });

  socket.on("seek", ({ time } = {}) => {
    try {
      const { room, actor } = getRoomAndActor(socket);
      assertCanControlPlayback(actor);
      const t = Number(time);
      if (!Number.isFinite(t) || t < 0) {
        throw new AppError(ERROR_CODES.INVALID_PAYLOAD, "seek requires a valid `time`.", 400);
      }
      room.updatePlayback({ currentTime: t });
      broadcastSync(io, room, "seek");
    } catch (err) {
      emitError(socket, err);
    }
  });

  socket.on("change_video", ({ videoId, url } = {}) => {
    try {
      const { room, actor } = getRoomAndActor(socket);
      assertCanControlPlayback(actor);
      const resolved = resolveVideoId(videoId || url);
      if (!resolved) {
        throw new AppError(
          ERROR_CODES.INVALID_PAYLOAD,
          "That doesn't look like a valid YouTube URL or video ID.",
          400,
        );
      }
      room.updatePlayback({ videoId: resolved, playing: false, currentTime: 0 });
      broadcastSync(io, room, "change_video");
    } catch (err) {
      emitError(socket, err);
    }
  });

  // Periodic "where are we" ping sent by whoever is currently playing (see
  // Player.jsx). Unlike play/pause/seek this never toggles playing state and
  // clients only ever use it for small drift correction (a few hundred ms),
  // never a hard seek/play/pause — so it can run every few seconds without
  // causing jitter or a feedback loop. It also keeps the server's stored
  // currentTime fresh so a client that rejoins mid-playback (Bug 2) lands on
  // the right timestamp instead of wherever the last discrete command left it.
  socket.on(CLIENT_EVENTS.TIME_SYNC, ({ time } = {}) => {
    try {
      const { room, actor } = getRoomAndActor(socket);
      assertCanControlPlayback(actor);
      const t = Number(time);
      if (!Number.isFinite(t) || t < 0) return; // malformed periodic ping — ignore, not worth an error round-trip
      room.updatePlayback({ currentTime: t });
      broadcastSync(io, room, "periodic");
    } catch (err) {
      emitError(socket, err);
    }
  });
}
