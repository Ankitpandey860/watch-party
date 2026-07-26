import { roomManager } from "../../services/roomManager.js";
import { CLIENT_EVENTS, SERVER_EVENTS } from "../../constants/events.js";
import { AppError, ERROR_CODES } from "../../constants/errors.js";
import { generateMessageId } from "../../utils/idGenerator.js";
import { emitError } from "../socketUtils.js";

// Messages longer than this are rejected outright rather than silently
// truncated, so the sender knows their message didn't go through as typed.
const MAX_MESSAGE_LENGTH = 500;

function getRoomAndSender(socket) {
  const { roomId, userId } = socket.data;
  if (!roomId || !userId) {
    throw new AppError(ERROR_CODES.NOT_IN_ROOM, "Join a room before sending messages.", 400);
  }
  const room = roomManager.getRoom(roomId);
  if (!room) throw new AppError(ERROR_CODES.ROOM_NOT_FOUND, "This room no longer exists.", 404);
  const sender = room.getParticipant(userId);
  if (!sender) throw new AppError(ERROR_CODES.PARTICIPANT_NOT_FOUND, "You're not in this room.", 403);
  return { room, sender };
}

export function registerChatHandlers(io, socket) {
  socket.on(CLIENT_EVENTS.SEND_MESSAGE, ({ message } = {}) => {
    try {
      const { room, sender } = getRoomAndSender(socket);

      // Never trust the payload's shape or size — a malformed or hostile
      // client shouldn't be able to throw an unhandled error here.
      const raw = typeof message === "string" ? message : "";
      const trimmed = raw.trim();

      if (!trimmed) {
        throw new AppError(ERROR_CODES.INVALID_PAYLOAD, "Message can't be empty.", 400);
      }
      if (trimmed.length > MAX_MESSAGE_LENGTH) {
        throw new AppError(
          ERROR_CODES.INVALID_PAYLOAD,
          `Messages can't be longer than ${MAX_MESSAGE_LENGTH} characters.`,
          400,
        );
      }

      const chatMessage = {
        id: generateMessageId(),
        senderId: sender.id,
        senderName: sender.username,
        role: sender.role,
        message: trimmed,
        timestamp: Date.now(),
      };

      room.addMessage(chatMessage);
      io.to(room.roomId).emit(SERVER_EVENTS.NEW_MESSAGE, chatMessage);
    } catch (err) {
      emitError(socket, err);
    }
  });
}

export default registerChatHandlers;
