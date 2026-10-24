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
  // --- auth / session
  UNAUTHENTICATED: "UNAUTHENTICATED", // no valid session
  SESSION_EXPIRED: "SESSION_EXPIRED",
  FORBIDDEN: "FORBIDDEN", // authenticated but not allowed (e.g. guest creating a room)
  CSRF_REJECTED: "CSRF_REJECTED",
  INVALID_CODE: "INVALID_CODE", // wrong / expired / used OTP (deliberately indistinguishable)
  EMAIL_UNAVAILABLE: "EMAIL_UNAVAILABLE",
  OAUTH_UNAVAILABLE: "OAUTH_UNAVAILABLE",
  // --- rooms / abuse
  BANNED: "BANNED",
  ROOM_FULL: "ROOM_FULL",
  ROOM_LIMIT: "ROOM_LIMIT",
  SERVER_BUSY: "SERVER_BUSY",
  RATE_LIMITED: "RATE_LIMITED",
  INVALID_JSON: "INVALID_JSON",
  PAYLOAD_TOO_LARGE: "PAYLOAD_TOO_LARGE",
  // --- providers / permissions
  MODERATOR_LIMIT: "MODERATOR_LIMIT",
  MEDIA_MISMATCH: "MEDIA_MISMATCH", // command refers to a different title/provider than the room is on
  UNSUPPORTED_MEDIA: "UNSUPPORTED_MEDIA",
  PAIRING_INVALID: "PAIRING_INVALID",
});

export class AppError extends Error {
  constructor(code, message, statusCode = 400, extra = undefined) {
    super(message || code);
    this.name = "AppError";
    this.code = code;
    this.statusCode = statusCode;
    this.extra = extra; // safe, client-visible extras (e.g. { retryAfterSeconds })
  }
}
