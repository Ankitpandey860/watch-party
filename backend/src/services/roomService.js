import { roomManager } from "./roomManager.js";
import { Participant } from "../models/Participant.js";
import { ROLES } from "../constants/roles.js";
import { AppError, ERROR_CODES } from "../constants/errors.js";
import { normalizeRoomId } from "../utils/idGenerator.js";

/** Creates a room owned by an authenticated USER (guests can never reach this). */
function createRoom({ principal }) {
  if (!principal || principal.kind !== "user") {
    throw new AppError(ERROR_CODES.FORBIDDEN, "Sign in to create a room.", 403);
  }
  const room = roomManager.createRoom(principal.id);
  // The owner's seat is created when their socket joins (nothing is reserved here), so an
  // abandoned room holds no participants and is reclaimed by the idle sweeper.
  return { roomId: room.roomId };
}

function requireRoom(roomId) {
  const id = normalizeRoomId(roomId);
  if (!id) throw new AppError(ERROR_CODES.INVALID_ROOM_ID, "Room code is required.", 400);
  const room = roomManager.getRoom(id);
  if (!room) throw new AppError(ERROR_CODES.ROOM_NOT_FOUND, "This room doesn't exist or has ended.", 404);
  return room;
}

/** Public, non-sensitive facts for the invite page. */
function getRoomInfo(roomId) {
  const room = requireRoom(roomId);
  return {
    roomId: room.roomId,
    participantCount: room.participants.size,
    maxParticipants: room.maxParticipants,
    full: room.isFull(),
  };
}

/** Throws unless `principal` may enter the room right now (exists, not banned, not full). */
function assertCanEnter(roomId, principal) {
  const room = requireRoom(roomId);
  if (room.isBanned(principal.id)) {
    throw new AppError(ERROR_CODES.BANNED, "You were removed from this room and can't rejoin.", 403);
  }
  if (!room.getParticipant(principal.id) && room.isFull()) {
    throw new AppError(ERROR_CODES.ROOM_FULL, "This room is full.", 409);
  }
  return room;
}

export const roomService = { createRoom, getRoomInfo, assertCanEnter, requireRoom, Participant, ROLES };
export default roomService;
