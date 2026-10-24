import { ROLES } from "../constants/roles.js";

// How many chat messages we keep in memory per room (a live chat, not a persisted history).
const MAX_STORED_MESSAGES = 100;

export class Room {
  /**
   * @param {string} roomId
   * @param {string} ownerId - the authenticated user who created the room (always a "user", never a guest)
   * @param {{ maxParticipants?: number }} [opts]
   */
  constructor(roomId, ownerId, { maxParticipants = 30, maxModerators = 3 } = {}) {
    this.roomId = roomId;
    this.ownerId = ownerId; // permanent host entitlement; changes only via transfer_host
    this.hostId = ownerId; // current host (an "acting host" while the owner is away)
    this.maxParticipants = maxParticipants;
    // Host-controlled settings (server-enforced). Moderators exclude the host.
    this.settings = { maxModerators, moderatorsCanControl: true };
    this.createdAt = Date.now();
    this.lastActiveAt = Date.now();

    /** @type {Map<string, import("./Participant.js").Participant>} keyed by principal id */
    this.participants = new Map();
    /** Principal ids that were removed by the host and may not come back. */
    this.bans = new Set();
    this.messages = [];

    // Single source of truth for playback; clients only mirror this.
    this.currentVideo = { provider: null, videoId: null, mediaParams: null, playing: false, currentTime: 0, rate: 1, updatedAt: Date.now(), seq: 0 };
    this.lastTimeSyncAt = 0;

    this.emptyRoomTimer = null;
    this.hostGraceTimer = null;
    this.actingHost = null; // { id, previousRole } while someone covers for an absent owner
  }

  touch() {
    this.lastActiveAt = Date.now();
  }

  addParticipant(participant) {
    this.participants.set(participant.id, participant);
    this.touch();
  }

  getParticipant(id) {
    return this.participants.get(id) || null;
  }

  removeParticipant(id) {
    const p = this.participants.get(id);
    if (p) p.clearDisconnectTimer();
    this.participants.delete(id);
    this.touch();
  }

  isBanned(id) {
    return this.bans.has(id);
  }

  ban(id) {
    this.bans.add(id);
  }

  /** Number of current moderators (the host is never counted). */
  moderatorCount() {
    return this.listParticipants().filter((p) => p.role === ROLES.MODERATOR).length;
  }

  isFull() {
    return this.participants.size >= this.maxParticipants;
  }

  /** A display name unique within the room (case-insensitive): "Sam", then "Sam (2)", "Sam (3)"... */
  uniqueName(name, forId = null) {
    const taken = new Set(
      this.listParticipants().filter((p) => p.id !== forId).map((p) => p.username.trim().toLowerCase()),
    );
    if (!taken.has(name.toLowerCase())) return name;
    for (let n = 2; n < 1000; n++) {
      const candidate = `${name.slice(0, 20 - String(n).length - 3)} (${n})`;
      if (!taken.has(candidate.toLowerCase())) return candidate;
    }
    return `${name.slice(0, 12)} (${Date.now() % 1000})`;
  }

  findBySocketId(socketId) {
    for (const p of this.participants.values()) if (p.socketId === socketId) return p;
    return null;
  }

  listParticipants() {
    return Array.from(this.participants.values());
  }

  onlineParticipants() {
    return this.listParticipants().filter((p) => p.online);
  }

  publicRoster() {
    return this.listParticipants().map((p) => p.toPublic());
  }

  get hostParticipant() {
    return this.getParticipant(this.hostId);
  }

  /** Explicit hand-over (transfer_host): `userId` becomes host AND owner; the old host becomes moderator. */
  transferHost(userId) {
    const prev = this.getParticipant(this.hostId);
    if (prev && prev.id !== userId) prev.role = ROLES.MODERATOR;
    const next = this.getParticipant(userId);
    if (next) next.role = ROLES.HOST;
    this.hostId = userId;
    this.ownerId = userId;
    this.actingHost = null;
  }

  /** Temporarily promotes `participant` while the owner is away; remembers their previous role. */
  promoteActingHost(participant) {
    const prev = this.getParticipant(this.hostId);
    if (prev && prev.id !== participant.id) prev.role = ROLES.MODERATOR;
    this.actingHost = { id: participant.id, previousRole: participant.role };
    participant.role = ROLES.HOST;
    this.hostId = participant.id;
  }

  /** The owner is back: they become host again and the acting host returns to their previous role. */
  restoreOwner(owner) {
    if (this.actingHost) {
      const acting = this.getParticipant(this.actingHost.id);
      if (acting && acting.id !== owner.id) acting.role = this.actingHost.previousRole;
      this.actingHost = null;
    }
    const current = this.getParticipant(this.hostId);
    if (current && current.id !== owner.id && current.role === ROLES.HOST) current.role = ROLES.MODERATOR;
    owner.role = ROLES.HOST;
    this.hostId = owner.id;
  }

  /** Best candidate to cover for an absent host: online SIGNED-IN users only (guests can never host). */
  pickNextHost(excludeId) {
    const candidates = this.listParticipants().filter((p) => p.id !== excludeId && p.online && p.kind === "user");
    if (candidates.length === 0) return null;
    candidates.sort((a, b) => {
      const rank = (p) => (p.role === ROLES.MODERATOR ? 0 : 1);
      return rank(a) - rank(b) || a.joinedAt - b.joinedAt;
    });
    return candidates[0];
  }

  /**
   * Applies a playback change. Every update gets a strictly-increasing `seq` so clients can drop
   * stale events. Before any change, the position is advanced to "now" if the video was playing:
   * pausing therefore freezes the REAL position instead of the last reported one.
   */
  updatePlayback(patch) {
    const projected = this.getEffectivePlayback().currentTime;
    this.currentVideo = {
      ...this.currentVideo,
      currentTime: projected,
      ...patch,
      updatedAt: Date.now(),
      seq: this.currentVideo.seq + 1,
    };
    this.touch();
    return this.currentVideo;
  }

  /** Current playback position projected forward to now while playing. */
  getEffectivePlayback() {
    const cv = this.currentVideo;
    if (!cv.playing) return { ...cv };
    return { ...cv, currentTime: cv.currentTime + Math.max(0, (Date.now() - cv.updatedAt) / 1000) };
  }

  addMessage(message) {
    this.messages.push(message);
    if (this.messages.length > MAX_STORED_MESSAGES) this.messages.splice(0, this.messages.length - MAX_STORED_MESSAGES);
    this.touch();
    return message;
  }

  getMessages() {
    return this.messages;
  }

  isEmpty() {
    return this.participants.size === 0;
  }

  clearEmptyRoomTimer() {
    if (this.emptyRoomTimer) {
      clearTimeout(this.emptyRoomTimer);
      this.emptyRoomTimer = null;
    }
  }

  clearHostGraceTimer() {
    if (this.hostGraceTimer) {
      clearTimeout(this.hostGraceTimer);
      this.hostGraceTimer = null;
    }
  }

  /** Clears every timer owned by the room and its participants (called when the room is deleted). */
  dispose() {
    this.clearEmptyRoomTimer();
    this.clearHostGraceTimer();
    for (const p of this.participants.values()) p.clearDisconnectTimer();
  }

  toPublicState() {
    return {
      roomId: this.roomId,
      hostId: this.hostId,
      currentVideo: this.getEffectivePlayback(),
      settings: { ...this.settings },
      participants: this.publicRoster(),
      messages: this.getMessages(),
    };
  }
}

export default Room;
