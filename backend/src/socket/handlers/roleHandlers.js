import { roomManager } from "../../services/roomManager.js";
import { assertIsHost, assertNotSelf, assertCanHoldElevatedRole } from "../../services/permissionService.js";
import { ASSIGNABLE_ROLES, ROLES } from "../../constants/roles.js";
import { CLIENT_EVENTS, SERVER_EVENTS } from "../../constants/events.js";
import { AppError, ERROR_CODES } from "../../constants/errors.js";
import { onPayload } from "../safeHandler.js";
import { dropCompanions } from "../socketUtils.js";
import { logger } from "../../utils/logger.js";

function getRoomAndHost(socket) {
  const { roomId, userId } = socket.data;
  if (!roomId || !userId) throw new AppError(ERROR_CODES.NOT_IN_ROOM, "Join a room first.", 400);
  const room = roomManager.getRoom(roomId);
  if (!room) throw new AppError(ERROR_CODES.ROOM_NOT_FOUND, "This room no longer exists.", 404);
  const actor = room.getParticipant(userId);
  if (!actor) throw new AppError(ERROR_CODES.PARTICIPANT_NOT_FOUND, "You're not in this room.", 403);
  assertIsHost(actor); // host-ness is read from server state, never from the client
  return { room, actor };
}

const targetId = (v) => (typeof v === "string" && v.length > 0 && v.length <= 64 ? v : null);

export function registerRoleHandlers(io, socket) {
  // Host promotes a signed-in participant to Moderator, or demotes a Moderator back to Participant.
  onPayload(socket, "assign_role", ({ userId, role }) => {
    const { room, actor } = getRoomAndHost(socket);
    const id = targetId(userId);
    if (!id) throw new AppError(ERROR_CODES.INVALID_PAYLOAD, "userId is required.", 400);
    assertNotSelf(actor.id, id, "Use transfer_host to change your own role.");

    if (!ASSIGNABLE_ROLES.includes(role)) {
      throw new AppError(ERROR_CODES.INVALID_PAYLOAD, `role must be one of: ${ASSIGNABLE_ROLES.join(", ")}.`, 400);
    }
    const target = room.getParticipant(id);
    if (!target) throw new AppError(ERROR_CODES.PARTICIPANT_NOT_FOUND, "That participant isn't here.", 404);
    if (target.role === ROLES.HOST) {
      throw new AppError(ERROR_CODES.INVALID_PAYLOAD, "Use transfer_host to change who the host is.", 400);
    }
    if (role === ROLES.MODERATOR) {
      assertCanHoldElevatedRole(target); // guests can't be moderators
      // The cap counts moderators other than this target (re-assigning an existing moderator is a no-op).
      const others = room.listParticipants().filter((p) => p.role === ROLES.MODERATOR && p.id !== target.id).length;
      if (others >= room.settings.maxModerators) {
        throw new AppError(ERROR_CODES.MODERATOR_LIMIT,
          `This room allows at most ${room.settings.maxModerators} moderator${room.settings.maxModerators === 1 ? "" : "s"} (not counting the host).`, 409);
      }
    }

    target.role = role;
    io.to(room.roomId).emit(SERVER_EVENTS.ROLE_ASSIGNED, {
      userId: target.id, username: target.username, role: target.role, participants: room.publicRoster(),
    });
  }, { bucket: "admin" });

  // Host changes room settings: whether moderators may control playback, and the moderator cap.
  onPayload(socket, CLIENT_EVENTS.UPDATE_ROOM_SETTINGS, ({ moderatorsCanControl, maxModerators }) => {
    const { room } = getRoomAndHost(socket);
    const next = { ...room.settings };
    if (moderatorsCanControl !== undefined) {
      if (typeof moderatorsCanControl !== "boolean") throw new AppError(ERROR_CODES.INVALID_PAYLOAD, "moderatorsCanControl must be true or false.", 400);
      next.moderatorsCanControl = moderatorsCanControl;
    }
    if (maxModerators !== undefined) {
      if (!Number.isInteger(maxModerators) || maxModerators < 0 || maxModerators > 10) {
        throw new AppError(ERROR_CODES.INVALID_PAYLOAD, "maxModerators must be a whole number from 0 to 10.", 400);
      }
      // Lowering the cap never silently demotes anyone: the host demotes first.
      if (maxModerators < room.moderatorCount()) {
        throw new AppError(ERROR_CODES.MODERATOR_LIMIT, `There are already ${room.moderatorCount()} moderators; remove some first.`, 409);
      }
      next.maxModerators = maxModerators;
    }
    room.settings = next;
    io.to(room.roomId).emit(SERVER_EVENTS.ROOM_SETTINGS, { settings: { ...room.settings } });
  }, { bucket: "admin" });

  // Host removes a participant AND bans them from this room for its lifetime.
  onPayload(socket, "remove_participant", ({ userId }) => {
    const { room, actor } = getRoomAndHost(socket);
    const id = targetId(userId);
    if (!id) throw new AppError(ERROR_CODES.INVALID_PAYLOAD, "userId is required.", 400);
    assertNotSelf(actor.id, id, "You can't remove yourself — use leave_room instead.");

    const target = room.getParticipant(id);
    if (!target) throw new AppError(ERROR_CODES.PARTICIPANT_NOT_FOUND, "That participant isn't here.", 404);
    // An acting host must not be able to lock the real owner out of their own room.
    if (id === room.ownerId) throw new AppError(ERROR_CODES.NOT_AUTHORIZED, "The room owner can't be removed.", 403);

    const targetSocketId = target.socketId;
    room.ban(id);
    room.removeParticipant(id);
    dropCompanions(io, room.roomId, id, "removed");

    io.to(room.roomId).emit(SERVER_EVENTS.PARTICIPANT_REMOVED, {
      userId: id, username: target.username, participants: room.publicRoster(),
    });

    if (targetSocketId) {
      io.to(targetSocketId).emit(SERVER_EVENTS.REMOVED_FROM_ROOM, { roomId: room.roomId });
      const targetSocket = io.sockets.sockets.get(targetSocketId);
      if (targetSocket) {
        targetSocket.leave(room.roomId);
        targetSocket.data.roomId = null;
        targetSocket.disconnect(true); // ends the connection; a ticket for this room is refused from now on
      }
    }
    if (room.isEmpty()) roomManager.scheduleEmptyRoomCleanup(room.roomId);
    logger.info(`${target.kind} removed and banned from room ${room.roomId}`);
  }, { bucket: "admin" });

  // Host hands the room to another online SIGNED-IN participant (they become host and owner).
  onPayload(socket, "transfer_host", ({ userId }) => {
    const { room, actor } = getRoomAndHost(socket);
    const id = targetId(userId);
    if (!id) throw new AppError(ERROR_CODES.INVALID_PAYLOAD, "userId is required.", 400);
    assertNotSelf(actor.id, id, "You're already the host.");

    const target = room.getParticipant(id);
    if (!target) throw new AppError(ERROR_CODES.PARTICIPANT_NOT_FOUND, "That participant isn't here.", 404);
    if (!target.online) {
      throw new AppError(ERROR_CODES.INVALID_PAYLOAD, "You can only transfer host to someone currently online.", 400);
    }
    assertCanHoldElevatedRole(target); // guests can never become host

    room.clearHostGraceTimer();
    room.transferHost(target.id);
    io.to(room.roomId).emit(SERVER_EVENTS.HOST_CHANGED, { hostId: room.hostId, participants: room.publicRoster() });
  }, { bucket: "admin" });
}
