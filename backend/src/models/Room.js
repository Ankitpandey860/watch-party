import { ROLES } from "../constants/roles.js";

// How many chat messages we keep in memory per room. Older messages are
// dropped as new ones arrive — this is a live watch-party chat, not a
// persisted history.
const MAX_STORED_MESSAGES = 100;

export class Room {
  /**
   * @param {string} roomId
   * @param {string} hostUserId - userId of the participant who created the room
   */
  constructor(roomId, hostUserId) {
    this.roomId = roomId;
    this.hostId = hostUserId;
    this.createdAt = Date.now();

    /** @type {Map<string, import("./Participant.js").Participant>} keyed by userId */
    this.participants = new Map();

    // In-memory chat history, oldest first, capped at MAX_STORED_MESSAGES.
    /** @type {Array<{id: string, senderId: string, senderName: string, role: string, message: string, timestamp: number}>} */
    this.messages = [];

    // Single source of truth for playback — the frontend Player never talks to
    // YouTube directly; it just mirrors this.
    this.currentVideo = {
      videoId: null,
      playing: false,
      currentTime: 0,
      updatedAt: Date.now(),
      seq: 0,
    };

    this.emptyRoomTimer = null; // grace-period deletion timer, set once participants hits 0
  }

  addParticipant(participant) {
    this.participants.set(participant.id, participant);
  }

  getParticipant(userId) {
    return this.participants.get(userId) || null;
  }

  removeParticipant(userId) {
    const p = this.participants.get(userId);
    if (p) p.clearDisconnectTimer();
    this.participants.delete(userId);
  }

  findBySocketId(socketId) {
    for (const p of this.participants.values()) {
      if (p.socketId === socketId) return p;
    }
    return null;
  }

  /** Case-insensitive username collision check, ignoring a given userId (for reconnects). */
  isUsernameTaken(username, ignoreUserId = null) {
    const target = username.trim().toLowerCase();
    for (const p of this.participants.values()) {
      if (p.id === ignoreUserId) continue;
      if (p.username.trim().toLowerCase() === target) return true;
    }
    return false;
  }

  listParticipants() {
    return Array.from(this.participants.values());
  }

  onlineParticipants() {
    return this.listParticipants().filter((p) => p.online);
  }

  get hostParticipant() {
    return this.getParticipant(this.hostId);
  }

  /** Promotes `userId` to host, demotes the previous host to moderator. Returns { previousHostId }. */
  setHost(userId) {
    const previousHostId = this.hostId;
    const prev = this.getParticipant(previousHostId);
    if (prev && prev.id !== userId) prev.role = ROLES.MODERATOR;

    const next = this.getParticipant(userId);
    if (next) next.role = ROLES.HOST;
    this.hostId = userId;

    return { previousHostId };
  }

  /** Picks the best candidate to auto-promote when the host disconnects/leaves. */
  pickNextHost(excludeUserId) {
    const candidates = this.listParticipants().filter(
      (p) => p.id !== excludeUserId && p.online,
    );
    if (candidates.length === 0) return null;
    // Prefer an existing moderator, then whoever joined earliest.
    candidates.sort((a, b) => {
      const rank = (p) => (p.role === ROLES.MODERATOR ? 0 : 1);
      const r = rank(a) - rank(b);
      if (r !== 0) return r;
      return a.joinedAt - b.joinedAt;
    });
    return candidates[0];
  }

  updatePlayback(patch) {
    // Every update — whether a discrete play/pause/seek/change_video command
    // or a periodic time_sync ping — gets a fresh, strictly-increasing seq.
    // Clients use this to discard a stale event that arrives after a newer
    // one (e.g. reordered over an HTTP long-polling fallback), instead of
    // letting the older event clobber more current playback state.
    const seq = this.currentVideo.seq + 1;
    this.currentVideo = { ...this.currentVideo, ...patch, updatedAt: Date.now(), seq };
    return this.currentVideo;
  }

  /**
   * Returns the current playback position projected forward to "now" when
   * playing, instead of the last value we happened to store. `currentTime` is
   * only ever written on an explicit seek/change_video or a periodic
   * time_sync ping, so without this a client that rejoins mid-playback (Bug 2)
   * would see whatever stale timestamp was last recorded rather than where
   * the video actually is right now.
   */
  getEffectivePlayback() {
    const cv = this.currentVideo;
    if (!cv.playing) return { ...cv };
    const elapsedSeconds = Math.max(0, (Date.now() - cv.updatedAt) / 1000);
    return { ...cv, currentTime: cv.currentTime + elapsedSeconds };
  }

  /** Appends a chat message, dropping the oldest once we're over the cap. */
  addMessage(message) {
    this.messages.push(message);
    if (this.messages.length > MAX_STORED_MESSAGES) {
      this.messages.splice(0, this.messages.length - MAX_STORED_MESSAGES);
    }
    return message;
  }

  /** The stored chat history (oldest first), capped at MAX_STORED_MESSAGES. */
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

  /** Full snapshot sent to a client right after it joins (ROOM_STATE event). */
  toPublicState() {
    return {
      roomId: this.roomId,
      hostId: this.hostId,
      currentVideo: this.getEffectivePlayback(),
      participants: this.listParticipants().map((p) => p.toPublic()),
      messages: this.getMessages(),
    };
  }
}

export default Room;
