import { PLAYBACK_ROLES, MANAGEMENT_ROLES, ROLES } from "../constants/roles.js";
import { AppError, ERROR_CODES } from "../constants/errors.js";

/**
 * Permission checks. Roles are read from SERVER-SIDE room state (the Participant object),
 * never from anything the client sends.
 */

/** Throws if `participant` isn't allowed to control playback (play/pause/seek/change_video). */
export function assertCanControlPlayback(participant, room) {
  if (!participant || !PLAYBACK_ROLES.includes(participant.role)) {
    throw new AppError(ERROR_CODES.NOT_AUTHORIZED, "Only the host and moderators can control playback.", 403);
  }
  // The host can switch moderator control off for the room; the host themselves always may.
  if (participant.role === ROLES.MODERATOR && room && room.settings?.moderatorsCanControl === false) {
    throw new AppError(ERROR_CODES.NOT_AUTHORIZED, "The host has turned off playback control for moderators.", 403);
  }
}

/** Throws if `participant` isn't the host (assign_role, remove_participant, transfer_host). */
export function assertIsHost(participant) {
  if (!participant || !MANAGEMENT_ROLES.includes(participant.role)) {
    throw new AppError(ERROR_CODES.NOT_AUTHORIZED, "Only the host can do that.", 403);
  }
}

export function assertNotSelf(actorId, targetId, message = "You can't do that to yourself.") {
  if (actorId === targetId) throw new AppError(ERROR_CODES.CANNOT_ACT_ON_SELF, message, 400);
}

/** Guests (invite-link identities) can watch and chat but never hold elevated roles. */
export function assertCanHoldElevatedRole(target) {
  if (target.kind !== "user") {
    throw new AppError(ERROR_CODES.NOT_AUTHORIZED, "Guests can't be moderators or host. Ask them to sign in first.", 403);
  }
}

export const isHost = (participant) => participant?.role === ROLES.HOST;
