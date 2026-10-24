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
// Playback speed range accepted from clients (YouTube supports 0.25-2).
export const MIN_RATE = 0.25;
export const MAX_RATE = 2;

function getRoomAndActor(socket) {
  const { roomId, userId } = socket.data;
  if (!roomId || !userId) throw new AppError(ERROR_CODES.NOT_IN_ROOM, "Join a room before controlling playback.", 400);
  const room = roomManager.getRoom(roomId);
  if (!room) throw new AppError(ERROR_CODES.ROOM_NOT_FOUND, "This room no longer exists.", 404);
  const actor = room.getParticipant(userId); // role comes from SERVER state
  if (!actor) throw new AppError(ERROR_CODES.PARTICIPANT_NOT_FOUND, "You're not in this room.", 403);
  return { room, actor };
}

export function broadcastSync(io, room, reason) {
  io.to(room.roomId).emit(SERVER_EVENTS.SYNC_STATE, { ...playbackSnapshot(room), reason });
}

export function validTime(time) {
  const t = typeof time === "number" ? time : typeof time === "string" && time.trim() !== "" ? Number(time) : NaN;
  return Number.isFinite(t) && t >= 0 && t <= MAX_SEEK_SECONDS ? t : null;
}

export function validRate(rate) {
  return typeof rate === "number" && Number.isFinite(rate) && rate >= MIN_RATE && rate <= MAX_RATE ? Math.round(rate * 100) / 100 : null;
}

/**
 * Stale-command protection: a controller may say which title it was looking at (`ref`). If that is
 * not the title the room is on NOW (e.g. a seek from the previous video arriving after change_video),
 * the command is refused instead of being applied to the wrong video.
 */
export function assertRefMatches(room, ref) {
  if (ref === undefined || ref === null) return; // legacy clients send no ref
  const cv = room.currentVideo;
  const ok = ref && typeof ref === "object" && ref.provider === cv.provider && ref.mediaId === cv.videoId;
  if (!ok) throw new AppError(ERROR_CODES.MEDIA_MISMATCH, "That command was for a different video than the room is on.", 409);
}

function requireMedia(room) {
  if (!room.currentVideo.videoId) throw new AppError(ERROR_CODES.INVALID_PAYLOAD, "Load a video first.", 400);
}

export function registerPlaybackHandlers(io, socket, { companion = false } = {}) {
  onPayload(socket, "play", ({ ref }) => {
    const { room, actor } = getRoomAndActor(socket);
    assertCanControlPlayback(actor, room);
    assertRefMatches(room, ref);
    room.updatePlayback({ playing: true });
    broadcastSync(io, room, "play");
  }, { bucket: "playback" });

  onPayload(socket, "pause", ({ ref }) => {
    const { room, actor } = getRoomAndActor(socket);
    assertCanControlPlayback(actor, room);
    assertRefMatches(room, ref);
    room.updatePlayback({ playing: false }); // freezes the REAL position (see Room.updatePlayback)
    broadcastSync(io, room, "pause");
  }, { bucket: "playback" });

  onPayload(socket, "seek", ({ time, ref }) => {
    const { room, actor } = getRoomAndActor(socket);
    assertCanControlPlayback(actor, room);
    assertRefMatches(room, ref);
    const t = validTime(time);
    if (t === null) throw new AppError(ERROR_CODES.INVALID_PAYLOAD, "seek requires a valid `time`.", 400);
    room.updatePlayback({ currentTime: t });
    broadcastSync(io, room, "seek");
  }, { bucket: "playback" });

  onPayload(socket, CLIENT_EVENTS.SET_RATE, ({ rate, ref }) => {
    const { room, actor } = getRoomAndActor(socket);
    assertCanControlPlayback(actor, room);
    assertRefMatches(room, ref);
    requireMedia(room);
    const r = validRate(rate);
    if (r === null) throw new AppError(ERROR_CODES.INVALID_PAYLOAD, `rate must be a number between ${MIN_RATE} and ${MAX_RATE}.`, 400);
    room.updatePlayback({ rate: r });
    broadcastSync(io, room, "rate");
  }, { bucket: "playback" });

  // The title is chosen in the web app; a companion (extension) socket may never switch it.
  if (!companion) {
    // `{ videoId | url, provider? }`: `provider` is an optional explicit choice (needed for bare ids).
    onPayload(socket, "change_video", ({ videoId, url, provider }) => {
      const { room, actor } = getRoomAndActor(socket);
      assertCanControlPlayback(actor, room);
      if (provider !== undefined && provider !== null && typeof provider !== "string") {
        throw new AppError(ERROR_CODES.INVALID_PAYLOAD, "provider must be a string.", 400);
      }
      if (provider && !providerRegistry.get(provider)) {
        throw new AppError(ERROR_CODES.UNSUPPORTED_MEDIA, "That provider isn't supported.", 400);
      }
      const input = videoId || url;
      const media = providerRegistry.resolveMedia(input, provider || undefined);
      if (!media) {
        throw new AppError(ERROR_CODES.INVALID_PAYLOAD, providerRegistry.explain(input, provider || undefined), 400);
      }
      room.updatePlayback({
        provider: media.provider, videoId: media.mediaId, mediaParams: Object.keys(media.params).length ? media.params : null,
        playing: false, currentTime: 0, rate: 1,
      });
      // Everyone's own-player status is about the PREVIOUS title now; they will re-report.
      for (const p of room.listParticipants()) p.playerStatus = null;
      broadcastSync(io, room, "change_video");
      io.to(room.roomId).emit(SERVER_EVENTS.PARTICIPANTS_UPDATED, { participants: room.publicRoster(), hostId: room.hostId });
    }, { bucket: "playback" });

  }

  // Periodic "where are we" report from a controller. It carries the `seq` the reporter based it
  // on; if a newer command (e.g. a moderator's seek) has landed since, the report is stale and is
  // dropped instead of overwriting the newer position.
  onPayload(socket, CLIENT_EVENTS.TIME_SYNC, ({ time, seq, ref }) => {
    const { room, actor } = getRoomAndActor(socket);
    assertCanControlPlayback(actor, room);
    try { assertRefMatches(room, ref); } catch { return; } // a stale periodic report is simply dropped
    const t = validTime(time);
    if (t === null) return; // malformed periodic ping: ignore silently
    if (seq !== room.currentVideo.seq) return; // stale (or missing) sequence number
    const now = Date.now();
    if (now - room.lastTimeSyncAt < MIN_TIME_SYNC_INTERVAL_MS) return; // too frequent
    room.lastTimeSyncAt = now;
    room.updatePlayback({ currentTime: t });
    broadcastSync(io, room, "periodic");
  }, { bucket: "playback" });

  // Any participant reports whether THEIR OWN player is on the room's title (informational: it drives the
  // "Alice has the wrong title" indicator and never grants or removes any permission).
  onPayload(socket, CLIENT_EVENTS.PLAYER_STATUS, ({ status, ref }) => {
    const { room, actor } = getRoomAndActor(socket);
    if (!["ready", "wrong_title", "no_player", "blocked", "unsupported"].includes(status)) {
      throw new AppError(ERROR_CODES.INVALID_PAYLOAD, "Unknown player status.", 400);
    }
    let next = status;
    // The server decides "wrong_title" itself when the participant says which title they have.
    if (ref && typeof ref === "object" && room.currentVideo.videoId) {
      const same = ref.provider === room.currentVideo.provider && ref.mediaId === room.currentVideo.videoId;
      if (!same && status === "ready") next = "wrong_title";
    }
    if (actor.playerStatus === next) return;
    actor.playerStatus = next;
    io.to(room.roomId).emit(SERVER_EVENTS.PARTICIPANTS_UPDATED, { participants: room.publicRoster(), hostId: room.hostId });
  }, { bucket: "playback" });
}
