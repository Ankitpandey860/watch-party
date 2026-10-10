import { roomManager } from "../../services/roomManager.js";
import { assertCanControlPlayback } from "../../services/permissionService.js";
import { CLIENT_EVENTS, SERVER_EVENTS } from "../../constants/events.js";
import { AppError, ERROR_CODES } from "../../constants/errors.js";
import { providerRegistry } from "../../providers/registry.js";
import { playbackSnapshot } from "../socketUtils.js";
import { onPayload, onSignal } from "../safeHandler.js";

// Longest position we accept (100 hours): rejects absurd values without limiting any real video.
const MAX_SEEK_SECONDS = 360_000;
// A host reports its position every few seconds; anything faster than this is dropped.
const MIN_TIME_SYNC_INTERVAL_MS = 800;

function getRoomAndActor(socket) {
  const { roomId, userId } = socket.data;
  if (!roomId || !userId) throw new AppError(ERROR_CODES.NOT_IN_ROOM, "Join a room before controlling playback.", 400);
  const room = roomManager.getRoom(roomId);
  if (!room) throw new AppError(ERROR_CODES.ROOM_NOT_FOUND, "This room no longer exists.", 404);
  const actor = room.getParticipant(userId); // role comes from SERVER state
  if (!actor) throw new AppError(ERROR_CODES.PARTICIPANT_NOT_FOUND, "You're not in this room.", 403);
  return { room, actor };
}

function broadcastSync(io, room, reason) {
  io.to(room.roomId).emit(SERVER_EVENTS.SYNC_STATE, { ...playbackSnapshot(room), reason });
}

function validTime(time) {
  const t = typeof time === "number" ? time : typeof time === "string" && time.trim() !== "" ? Number(time) : NaN;
  return Number.isFinite(t) && t >= 0 && t <= MAX_SEEK_SECONDS ? t : null;
}

export function registerPlaybackHandlers(io, socket) {
  onSignal(socket, "play", () => {
    const { room, actor } = getRoomAndActor(socket);
    assertCanControlPlayback(actor);
    room.updatePlayback({ playing: true });
    broadcastSync(io, room, "play");
  }, { bucket: "playback" });

  onSignal(socket, "pause", () => {
    const { room, actor } = getRoomAndActor(socket);
    assertCanControlPlayback(actor);
    room.updatePlayback({ playing: false }); // freezes the REAL position (see Room.updatePlayback)
    broadcastSync(io, room, "pause");
  }, { bucket: "playback" });

  onPayload(socket, "seek", ({ time }) => {
    const { room, actor } = getRoomAndActor(socket);
    assertCanControlPlayback(actor);
    const t = validTime(time);
    if (t === null) throw new AppError(ERROR_CODES.INVALID_PAYLOAD, "seek requires a valid `time`.", 400);
    room.updatePlayback({ currentTime: t });
    broadcastSync(io, room, "seek");
  }, { bucket: "playback" });

  onPayload(socket, "change_video", ({ videoId, url }) => {
    const { room, actor } = getRoomAndActor(socket);
    assertCanControlPlayback(actor);
    const media = providerRegistry.resolveMedia(videoId || url);
    if (!media) {
      throw new AppError(ERROR_CODES.INVALID_PAYLOAD, "That doesn't look like a valid YouTube URL or video ID.", 400);
    }
    room.updatePlayback({ provider: media.provider, videoId: media.mediaId, playing: false, currentTime: 0 });
    broadcastSync(io, room, "change_video");
  }, { bucket: "playback" });

  // Periodic "where are we" report from a controller. It carries the `seq` the reporter based it
  // on; if a newer command (e.g. a moderator's seek) has landed since, the report is stale and is
  // dropped instead of overwriting the newer position.
  onPayload(socket, CLIENT_EVENTS.TIME_SYNC, ({ time, seq }) => {
    const { room, actor } = getRoomAndActor(socket);
    assertCanControlPlayback(actor);
    const t = validTime(time);
    if (t === null) return; // malformed periodic ping: ignore silently
    if (seq !== room.currentVideo.seq) return; // stale (or missing) sequence number
    const now = Date.now();
    if (now - room.lastTimeSyncAt < MIN_TIME_SYNC_INTERVAL_MS) return; // too frequent
    room.lastTimeSyncAt = now;
    room.updatePlayback({ currentTime: t });
    broadcastSync(io, room, "periodic");
  }, { bucket: "playback" });
}
