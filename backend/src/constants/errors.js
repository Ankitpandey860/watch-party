// Stable error codes shared between REST responses and socket error_event payloads.
export const ERROR_CODES = Object.freeze({
  ROOM_NOT_FOUND: "ROOM_NOT_FOUND",
  USERNAME_TAKEN: "USERNAME_TAKEN",
  USERNAME_REQUIRED: "USERNAME_REQUIRED",
  INVALID_ROOM_ID: "INVALID_ROOM_ID",
  NOT_AUTHORIZED: "NOT_AUTHORIZED",
  PARTICIPANT_NOT_FOUND: "PARTICIPANT_NOT_FOUND",
  INVALID_PAYLOAD: "INVALID_PAYLOAD",
  ALREADY_HOST: "ALREADY_HOST",
  CANNOT_ACT_ON_SELF: "CANNOT_ACT_ON_SELF",
  NOT_IN_ROOM: "NOT_IN_ROOM",
  INTERNAL_ERROR: "INTERNAL_ERROR",
});

export class AppError extends Error {
  constructor(code, message, statusCode = 400) {
    super(message || code);
    this.name = "AppError";
    this.code = code;
    this.statusCode = statusCode;
  }
}
