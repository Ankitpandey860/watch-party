import { roomManager } from "../../services/roomManager.js";
import { Participant } from "../../models/Participant.js";
import { ROLES } from "../../constants/roles.js";
import { SERVER_EVENTS } from "../../constants/events.js";
import { AppError, ERROR_CODES } from "../../constants/errors.js";
import { normalizeRoomId } from "../../utils/idGenerator.js";
import { config } from "../../config/env.js";
import { emitError, broadcastParticipants, dropCompanions } from "../socketUtils.js";
import { onPayload, onSignal } from "../safeHandler.js";
import { logger } from "../../utils/logger.js";

function announceHostChange(io, room) {
  io.to(room.roomId).emit(SERVER_EVENTS.HOST_CHANGED, { hostId: room.hostId, participants: room.publicRoster() });
}

/**
 * Fully removes a participant: clears timers, covers for an absent host, broadcasts, and schedules
 * garbage collection of an emptied room. Shared by leave_room and the disconnect grace timeout.
 */
function departParticipant(io, room, userId, { reasonEvent } = {}) {
  const participant = room.getParticipant(userId);
  if (!participant) return;

  const wasHost = room.hostId === userId;
  room.removeParticipant(userId);
  dropCompanions(io, room.roomId, userId, "left_room");

  if (reasonEvent) {
    io.to(room.roomId).emit(reasonEvent, { userId, username: participant.username, participants: room.publicRoster() });
  }

  if (wasHost && !room.isEmpty()) {
    const next = room.pickNextHost(userId);
    if (next) {
      room.promoteActingHost(next);
      announceHostChange(io, room);
    }
  }

  if (room.isEmpty()) roomManager.scheduleEmptyRoomCleanup(room.roomId);
}

/**
 * When the host's socket drops, don't hand over instantly (a page refresh or mobile network blip
 * would permanently cost them the room). Wait `hostGraceMs`; only then does a signed-in participant
 * cover for them. The owner regains host automatically on return (see join_room).
 */
function scheduleHostFailover(io, room, absentHostId) {
  room.clearHostGraceTimer();
  room.hostGraceTimer = setTimeout(() => {
    room.hostGraceTimer = null;
    const absent = room.getParticipant(absentHostId);
    if (room.hostId !== absentHostId || (absent && absent.online)) return;
    const next = room.pickNextHost(absentHostId);
    if (!next) return;
    room.promoteActingHost(next);
    announceHostChange(io, room);
    logger.info(`Host absent in room ${room.roomId}; ${next.kind} participant now acting host`);
  }, config.rooms.hostGraceMs);
  room.hostGraceTimer.unref?.();
}

export function registerRoomHandlers(io, socket) {
  onPayload(
    socket,
    "join_room",
    ({ roomId }) => {
      const id = normalizeRoomId(roomId);
      if (!id) throw new AppError(ERROR_CODES.INVALID_PAYLOAD, "roomId is required.", 400);

      // The ticket was minted for ONE room; it cannot be used to enter another.
      if (socket.data.ticketRoomId !== id) {
        throw new AppError(ERROR_CODES.NOT_AUTHORIZED, "This connection isn't authorised for that room.", 403);
      }
      const room = roomManager.getRoom(id);
      if (!room) throw new AppError(ERROR_CODES.ROOM_NOT_FOUND, "This room doesn't exist or has ended.", 404);

      const principal = socket.data.principal;
      if (room.isBanned(principal.id)) throw new AppError(ERROR_CODES.BANNED, "You were removed from this room and can't rejoin.", 403);

      let participant = room.getParticipant(principal.id);
      if (!participant) {
        if (room.isFull()) throw new AppError(ERROR_CODES.ROOM_FULL, "This room is full.", 409);
        participant = new Participant({
          id: principal.id,
          username: room.uniqueName(principal.displayName),
          role: principal.id === room.hostId ? ROLES.HOST : ROLES.PARTICIPANT, // host is decided by SERVER state
          kind: principal.kind,
        });
        room.addParticipant(participant);
      }

      // The room owner always (re)gains host on joining, e.g. after a refresh or a long absence.
      let hostRestored = false;
      if (principal.id === room.ownerId && room.hostId !== principal.id) {
        room.restoreOwner(participant);
        hostRestored = true;
      }
      if (principal.id === room.hostId) room.clearHostGraceTimer();

      roomManager.cancelEmptyRoomCleanup(id);
      participant.attachSocket(socket.id);
      socket.data.roomId = id;
      socket.join(id);

      socket.emit(SERVER_EVENTS.ROOM_STATE, { ...room.toPublicState(), you: participant.toPublic() });
      io.to(id).emit(SERVER_EVENTS.USER_JOINED, { participant: participant.toPublic(), participants: room.publicRoster() });
      if (hostRestored) announceHostChange(io, room);

      logger.info(`${participant.kind} joined room ${id}`);
    },
    { bucket: "join" },
  );

  onSignal(socket, "leave_room", () => {
    const { roomId, userId } = socket.data;
    if (!roomId || !userId) return;
    const room = roomManager.getRoom(roomId);
    if (!room) return;

    departParticipant(io, room, userId, { reasonEvent: SERVER_EVENTS.USER_LEFT });
    socket.leave(roomId);
    socket.data.roomId = null;
  });

  socket.on("disconnect", () => {
    const { roomId, userId } = socket.data;
    if (!roomId || !userId) return;
    const room = roomManager.getRoom(roomId);
    if (!room) return;

    const participant = room.getParticipant(userId);
    if (!participant || participant.socketId !== socket.id) return; // stale/replaced connection

    participant.markOffline();
    broadcastParticipants(io, room);

    if (room.hostId === userId) scheduleHostFailover(io, room, userId);

    participant.disconnectTimer = setTimeout(() => {
      const stillThere = room.getParticipant(userId);
      if (stillThere && !stillThere.online) departParticipant(io, room, userId, { reasonEvent: SERVER_EVENTS.USER_LEFT });
    }, config.rooms.disconnectGraceMs);
    participant.disconnectTimer.unref?.();
  });
}

export { emitError };
