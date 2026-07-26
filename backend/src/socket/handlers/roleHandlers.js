import { roomManager } from "../../services/roomManager.js";
import { assertIsHost, assertNotSelf } from "../../services/permissionService.js";
import { ASSIGNABLE_ROLES, ROLES } from "../../constants/roles.js";
import { SERVER_EVENTS } from "../../constants/events.js";
import { AppError, ERROR_CODES } from "../../constants/errors.js";
import { emitError } from "../socketUtils.js";
import { logger } from "../../utils/logger.js";

function getRoomAndHost(socket) {
  const { roomId, userId } = socket.data;
  if (!roomId || !userId) {
    throw new AppError(ERROR_CODES.NOT_IN_ROOM, "Join a room first.", 400);
  }
  const room = roomManager.getRoom(roomId);
  if (!room) throw new AppError(ERROR_CODES.ROOM_NOT_FOUND, "This room no longer exists.", 404);
  const actor = room.getParticipant(userId);
  if (!actor) throw new AppError(ERROR_CODES.PARTICIPANT_NOT_FOUND, "You're not in this room.", 403);
  assertIsHost(actor);
  return { room, actor };
}

function participantsPayload(room) {
  return room.listParticipants().map((p) => p.toPublic());
}

export function registerRoleHandlers(io, socket) {
  // Host promotes a Participant to Moderator, or demotes a Moderator back to Participant.
  socket.on("assign_role", ({ userId: targetId, role } = {}) => {
    try {
      const { room, actor } = getRoomAndHost(socket);
      assertNotSelf(actor.id, targetId, "Use transfer_host to change your own role.");

      if (!ASSIGNABLE_ROLES.includes(role)) {
        throw new AppError(
          ERROR_CODES.INVALID_PAYLOAD,
          `role must be one of: ${ASSIGNABLE_ROLES.join(", ")}.`,
          400,
        );
      }

      const target = room.getParticipant(targetId);
      if (!target) {
        throw new AppError(ERROR_CODES.PARTICIPANT_NOT_FOUND, "That participant isn't here.", 404);
      }
      if (target.role === ROLES.HOST) {
        throw new AppError(
          ERROR_CODES.INVALID_PAYLOAD,
          "Use transfer_host to change who the host is.",
          400,
        );
      }

      target.role = role;

      io.to(room.roomId).emit(SERVER_EVENTS.ROLE_ASSIGNED, {
        userId: target.id,
        username: target.username,
        role: target.role,
        participants: participantsPayload(room),
      });
    } catch (err) {
      emitError(socket, err);
    }
  });

  // Host removes a participant from the room entirely.
  socket.on("remove_participant", ({ userId: targetId } = {}) => {
    try {
      const { room, actor } = getRoomAndHost(socket);
      assertNotSelf(actor.id, targetId, "You can't remove yourself — use leave_room instead.");

      const target = room.getParticipant(targetId);
      if (!target) {
        throw new AppError(ERROR_CODES.PARTICIPANT_NOT_FOUND, "That participant isn't here.", 404);
      }

      const targetSocketId = target.socketId;
      room.removeParticipant(targetId);

      io.to(room.roomId).emit(SERVER_EVENTS.PARTICIPANT_REMOVED, {
        userId: targetId,
        username: target.username,
        participants: participantsPayload(room),
      });

      // Tell the removed user directly, then disconnect their socket so they can't
      // keep controlling playback or linger in the room list.
      if (targetSocketId) {
        io.to(targetSocketId).emit(SERVER_EVENTS.REMOVED_FROM_ROOM, { roomId: room.roomId });
        const targetSocket = io.sockets.sockets.get(targetSocketId);
        if (targetSocket) {
          targetSocket.leave(room.roomId);
          targetSocket.data.roomId = null;
          targetSocket.data.userId = null;
        }
      }

      if (room.isEmpty()) {
        roomManager.scheduleEmptyRoomCleanup(room.roomId);
      }

      logger.info(`${target.username} (${targetId}) removed from room ${room.roomId} by host`);
    } catch (err) {
      emitError(socket, err);
    }
  });

  // Host hands the crown to another (online) participant; they become host, the
  // previous host becomes a moderator.
  socket.on("transfer_host", ({ userId: targetId } = {}) => {
    try {
      const { room, actor } = getRoomAndHost(socket);
      assertNotSelf(actor.id, targetId, "You're already the host.");

      const target = room.getParticipant(targetId);
      if (!target) {
        throw new AppError(ERROR_CODES.PARTICIPANT_NOT_FOUND, "That participant isn't here.", 404);
      }
      if (!target.online) {
        throw new AppError(
          ERROR_CODES.INVALID_PAYLOAD,
          "You can only transfer host to someone currently online.",
          400,
        );
      }

      room.setHost(target.id);

      io.to(room.roomId).emit(SERVER_EVENTS.HOST_CHANGED, {
        hostId: room.hostId,
        participants: participantsPayload(room),
      });
    } catch (err) {
      emitError(socket, err);
    }
  });
}
