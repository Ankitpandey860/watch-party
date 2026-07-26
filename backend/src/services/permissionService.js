import { PLAYBACK_ROLES, MANAGEMENT_ROLES, ROLES } from "../constants/roles.js";
import { AppError, ERROR_CODES } from "../constants/errors.js";

/** Throws if `participant` isn't allowed to control playback (play/pause/seek/change_video). */
export function assertCanControlPlayback(participant) {
  if (!participant || !PLAYBACK_ROLES.includes(participant.role)) {
    throw new AppError(
      ERROR_CODES.NOT_AUTHORIZED,
      "Only the host and moderators can control playback.",
      403,
    );
  }
}

/** Throws if `participant` isn't the host (assign_role, remove_participant, transfer_host). */
export function assertIsHost(participant) {
  if (!participant || !MANAGEMENT_ROLES.includes(participant.role)) {
    throw new AppError(ERROR_CODES.NOT_AUTHORIZED, "Only the host can do that.", 403);
  }
}

export function assertNotSelf(actorId, targetId, message = "You can't do that to yourself.") {
  if (actorId === targetId) {
    throw new AppError(ERROR_CODES.CANNOT_ACT_ON_SELF, message, 400);
  }
}

export const isHost = (participant) => participant?.role === ROLES.HOST;
