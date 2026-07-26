// Role model — matches the frontend's RoleBadge (host | moderator | participant).
export const ROLES = Object.freeze({
  HOST: "host",
  MODERATOR: "moderator",
  PARTICIPANT: "participant",
});

export const ALL_ROLES = Object.freeze([ROLES.HOST, ROLES.MODERATOR, ROLES.PARTICIPANT]);

// Roles allowed to control playback (play/pause/seek/change_video).
export const PLAYBACK_ROLES = Object.freeze([ROLES.HOST, ROLES.MODERATOR]);

// Only the host can manage the room (assign roles, remove participants, transfer host).
export const MANAGEMENT_ROLES = Object.freeze([ROLES.HOST]);

export function isValidRole(role) {
  return ALL_ROLES.includes(role);
}

// Roles a host is allowed to *assign* to someone else via assign_role.
// (Host status only ever changes via transfer_host, never via assign_role.)
export const ASSIGNABLE_ROLES = Object.freeze([ROLES.MODERATOR, ROLES.PARTICIPANT]);
