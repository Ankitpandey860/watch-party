import { v4 as uuidv4 } from "uuid";

const ROOM_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I to avoid confusion

/**
 * Generates a 6-character room code, e.g. "K3F9QZ".
 * Mirrors the shape produced by the frontend's own generateRoomCode() helper
 * (utils/youtube.js) so codes look consistent whichever side minted them.
 */
export function generateRoomCode(length = 6) {
  let code = "";
  for (let i = 0; i < length; i++) {
    code += ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)];
  }
  return code;
}

export function generateUserId() {
  return uuidv4();
}

export function generateMessageId() {
  return uuidv4();
}

export function normalizeRoomId(roomId) {
  return String(roomId || "").trim().toUpperCase();
}
