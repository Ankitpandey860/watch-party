import { randomInt, randomUUID } from "node:crypto";

const ROOM_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I to avoid confusion

/** 6-character room code from a CSPRNG (e.g. "K3F9QZ"). */
export function generateRoomCode(length = 6) {
  let code = "";
  for (let i = 0; i < length; i++) code += ROOM_CODE_CHARS[randomInt(ROOM_CODE_CHARS.length)];
  return code;
}

export const generateUserId = () => randomUUID();
export const generateMessageId = () => randomUUID();

export function normalizeRoomId(roomId) {
  return String(roomId || "").trim().toUpperCase().slice(0, 16);
}
