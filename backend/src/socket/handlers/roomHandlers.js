import { roomManager } from "../../services/roomManager.js";
import { Participant } from "../../models/Participant.js";
import { ROLES } from "../../constants/roles.js";
import { SERVER_EVENTS } from "../../constants/events.js";
import { AppError, ERROR_CODES } from "../../constants/errors.js";
import { normalizeRoomId } from "../../utils/idGenerator.js";
import { config } from "../../config/env.js";
import { emitError, broadcastParticipants } from "../socketUtils.js";
import { logger } from "../../utils/logger.js";

/**
 * Fully removes a participant from a room: clears timers, hands off the host
 * crown if needed, broadcasts the change, and garbage-collects an empty room.
 * Shared by leave_room, remove_participant, and the disconnect grace-timeout.
 */
function departParticipant(io, room, userId, { reasonEvent, extraPayload } = {}) {
  const participant = room.getParticipant(userId);
  if (!participant) return;

  const wasHost = room.hostId === userId;
  room.removeParticipant(userId);

  let hostChange = null;
  if (wasHost && !room.isEmpty()) {
    const next = room.pickNextHost(userId);
    if (next) {
      room.setHost(next.id);
      hostChange = { hostId: next.id };
    }
  }

  if (reasonEvent) {
    io.to(room.roomId).emit(reasonEvent, {
      userId,
      username: participant.username,
      participants: room.listParticipants().map((p) => p.toPublic()),
      ...extraPayload,
    });
  }

  if (hostChange) {
    io.to(room.roomId).emit(SERVER_EVENTS.HOST_CHANGED, {
      hostId: hostChange.hostId,
      participants: room.listParticipants().map((p) => p.toPublic()),
    });
  }

  if (room.isEmpty()) {
    roomManager.scheduleEmptyRoomCleanup(room.roomId);
  }
}

export function registerRoomHandlers(io, socket) {
  socket.on("join_room", ({ roomId, userId, username } = {}) => {
    try {
      const id = normalizeRoomId(roomId);
      if (!id || !userId) {
        throw new AppError(ERROR_CODES.INVALID_PAYLOAD, "roomId and userId are required.", 400);
      }

      const room = roomManager.getRoom(id);
      if (!room) {
        throw new AppError(ERROR_CODES.ROOM_NOT_FOUND, `Room ${id} doesn't exist.`, 404);
      }

      let participant = room.getParticipant(userId);

      if (!participant) {
        // Safety net: normally the REST createRoom/joinRoom call already reserved
        // this seat. If a client connects straight to the socket (e.g. after
        // recovering a session) we register them here instead of rejecting.
        const cleanUsername = String(username || "").trim();
        if (!cleanUsername) {
          throw new AppError(
            ERROR_CODES.USERNAME_REQUIRED,
            "Username is required to join.",
            400,
          );
        }
        if (room.isUsernameTaken(cleanUsername, userId)) {
          throw new AppError(
            ERROR_CODES.USERNAME_TAKEN,
            `"${cleanUsername}" is already taken in this room.`,
            409,
          );
        }
        participant = new Participant({ id: userId, username: cleanUsername, role: ROLES.PARTICIPANT });
        room.addParticipant(participant);
      }

      roomManager.cancelEmptyRoomCleanup(id);

      participant.attachSocket(socket.id);
      socket.data.roomId = id;
      socket.data.userId = userId;
      socket.join(id);

      // Snapshot to the joiner only.
      socket.emit(SERVER_EVENTS.ROOM_STATE, {
        ...room.toPublicState(),
        you: participant.toPublic(),
      });

      // Let everyone else (and this socket, for a consistent roster) know.
      io.to(id).emit(SERVER_EVENTS.USER_JOINED, {
        participant: participant.toPublic(),
        participants: room.listParticipants().map((p) => p.toPublic()),
      });

      logger.info(`${participant.username} (${userId}) joined room ${id}`);
    } catch (err) {
      emitError(socket, err);
    }
  });

  socket.on("leave_room", () => {
    const { roomId, userId } = socket.data;
    if (!roomId || !userId) return;
    const room = roomManager.getRoom(roomId);
    if (!room) return;

    departParticipant(io, room, userId, { reasonEvent: SERVER_EVENTS.USER_LEFT });
    socket.leave(roomId);
    socket.data.roomId = null;
    socket.data.userId = null;
  });

  socket.on("disconnect", () => {
    const { roomId, userId } = socket.data;
    if (!roomId || !userId) return;
    const room = roomManager.getRoom(roomId);
    if (!room) return;

    const participant = room.getParticipant(userId);
    if (!participant || participant.socketId !== socket.id) return; // stale/replaced session

    participant.markOffline();
    broadcastParticipants(io, room);

    // If the host just went offline, hand control to someone else right away
    // instead of leaving playback stuck for the whole grace period.
    if (room.hostId === userId) {
      const next = room.pickNextHost(userId);
      if (next) {
        room.setHost(next.id);
        io.to(room.roomId).emit(SERVER_EVENTS.HOST_CHANGED, {
          hostId: next.id,
          participants: room.listParticipants().map((p) => p.toPublic()),
        });
      }
    }

    participant.disconnectTimer = setTimeout(() => {
      const stillThere = room.getParticipant(userId);
      if (stillThere && !stillThere.online) {
        departParticipant(io, room, userId, { reasonEvent: SERVER_EVENTS.USER_LEFT });
      }
    }, config.disconnectGraceMs);

    logger.info(`${participant.username} (${userId}) disconnected from room ${roomId}`);
  });
}
