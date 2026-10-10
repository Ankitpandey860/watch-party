import { roomManager } from "../../services/roomManager.js";
import { CLIENT_EVENTS, SERVER_EVENTS } from "../../constants/events.js";
import { AppError, ERROR_CODES } from "../../constants/errors.js";
import { generateMessageId } from "../../utils/idGenerator.js";
import { onPayload } from "../safeHandler.js";

// Messages longer than this are rejected rather than silently truncated.
const MAX_MESSAGE_LENGTH = 500;
// Control characters and invisible direction overrides have no place in a chat line.
const UNSAFE = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g;

function getRoomAndSender(socket) {
  const { roomId, userId } = socket.data;
  if (!roomId || !userId) throw new AppError(ERROR_CODES.NOT_IN_ROOM, "Join a room before sending messages.", 400);
  const room = roomManager.getRoom(roomId);
  if (!room) throw new AppError(ERROR_CODES.ROOM_NOT_FOUND, "This room no longer exists.", 404);
  const sender = room.getParticipant(userId);
  if (!sender) throw new AppError(ERROR_CODES.PARTICIPANT_NOT_FOUND, "You're not in this room.", 403);
  return { room, sender };
}

export function registerChatHandlers(io, socket) {
  onPayload(socket, CLIENT_EVENTS.SEND_MESSAGE, ({ message }) => {
    const { room, sender } = getRoomAndSender(socket);

    const trimmed = (typeof message === "string" ? message : "").replace(UNSAFE, "").trim();
    if (!trimmed) throw new AppError(ERROR_CODES.INVALID_PAYLOAD, "Message can't be empty.", 400);
    if (trimmed.length > MAX_MESSAGE_LENGTH) {
      throw new AppError(ERROR_CODES.INVALID_PAYLOAD, `Messages can't be longer than ${MAX_MESSAGE_LENGTH} characters.`, 400);
    }

    const chatMessage = {
      id: generateMessageId(),
      senderId: sender.id,
      senderName: sender.username,
      role: sender.role,
      kind: sender.kind,
      message: trimmed,
      timestamp: Date.now(),
    };
    room.addMessage(chatMessage);
    io.to(room.roomId).emit(SERVER_EVENTS.NEW_MESSAGE, chatMessage);
  }, { bucket: "chat" });
}

export default registerChatHandlers;
