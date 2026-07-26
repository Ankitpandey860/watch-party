import { roomManager } from "./roomManager.js";
import { Participant } from "../models/Participant.js";
import { ROLES } from "../constants/roles.js";
import { AppError, ERROR_CODES } from "../constants/errors.js";
import { generateUserId, normalizeRoomId } from "../utils/idGenerator.js";

function validateUsername(username) {
  const trimmed = String(username || "").trim();
  if (!trimmed) {
    throw new AppError(ERROR_CODES.USERNAME_REQUIRED, "Username is required.", 400);
  }
  if (trimmed.length > 20) {
    throw new AppError(
      ERROR_CODES.INVALID_PAYLOAD,
      "Username must be 20 characters or fewer.",
      400,
    );
  }
  return trimmed;
}

/**
 * Creates a brand-new room and registers its creator as a not-yet-connected host.
 * The participant only flips to `online` once their socket actually calls join_room —
 * this REST call just reserves the room code and the host's seat.
 */
function createRoom({ username }) {
  const cleanUsername = validateUsername(username);
  const userId = generateUserId();
  const room = roomManager.createRoom(userId);

  const host = new Participant({ id: userId, username: cleanUsername, role: ROLES.HOST });
  room.addParticipant(host);

  return { roomId: room.roomId, userId, username: cleanUsername, role: ROLES.HOST };
}

/**
 * Validates that a room can be joined and reserves a seat for the joiner as a Participant.
 * Rejects unknown rooms and duplicate (case-insensitive) usernames up front, before the
 * frontend navigates to /room/:roomId, so the user gets a clear error on the join form.
 */
function joinRoom({ roomId, username }) {
  const cleanUsername = validateUsername(username);
  const id = normalizeRoomId(roomId);
  if (!id) {
    throw new AppError(ERROR_CODES.INVALID_ROOM_ID, "Room code is required.", 400);
  }

  const room = roomManager.getRoom(id);
  if (!room) {
    throw new AppError(ERROR_CODES.ROOM_NOT_FOUND, `Room ${id} doesn't exist.`, 404);
  }

  if (room.isUsernameTaken(cleanUsername)) {
    throw new AppError(
      ERROR_CODES.USERNAME_TAKEN,
      `"${cleanUsername}" is already taken in this room.`,
      409,
    );
  }

  // A join in progress means the room is no longer "empty" — cancel any pending GC.
  roomManager.cancelEmptyRoomCleanup(id);

  const userId = generateUserId();
  const participant = new Participant({
    id: userId,
    username: cleanUsername,
    role: ROLES.PARTICIPANT,
  });
  room.addParticipant(participant);

  return { roomId: room.roomId, userId, username: cleanUsername, role: ROLES.PARTICIPANT };
}

function getRoomInfo(roomId) {
  const room = roomManager.getRoom(roomId);
  if (!room) {
    throw new AppError(ERROR_CODES.ROOM_NOT_FOUND, `Room ${roomId} doesn't exist.`, 404);
  }
  return {
    roomId: room.roomId,
    participantCount: room.participants.size,
    onlineCount: room.onlineParticipants().length,
    currentVideo: room.currentVideo,
  };
}

export const roomService = { createRoom, joinRoom, getRoomInfo, validateUsername };
export default roomService;
