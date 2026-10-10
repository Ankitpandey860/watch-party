import { Room } from "../models/Room.js";
import { generateRoomCode, normalizeRoomId } from "../utils/idGenerator.js";
import { config } from "../config/env.js";
import { AppError, ERROR_CODES } from "../constants/errors.js";
import { logger } from "../utils/logger.js";

/**
 * In-memory room store. SINGLE-INSTANCE ASSUMPTION: rooms live in this process only, so running
 * several backend instances would split rooms between them. Moving to multiple instances needs
 * shared room state (and shared rate-limit counters) — see docs/ARCHITECTURE.md.
 */
class RoomManager {
  constructor() {
    /** @type {Map<string, Room>} */
    this.rooms = new Map();
    this.sweeper = null;
  }

  generateUniqueRoomId() {
    let id;
    do id = generateRoomCode();
    while (this.rooms.has(id));
    return id;
  }

  roomsOwnedBy(ownerId) {
    let n = 0;
    for (const r of this.rooms.values()) if (r.ownerId === ownerId) n++;
    return n;
  }

  /** Creates a room for an authenticated owner, enforcing global and per-user limits. */
  createRoom(ownerId) {
    if (this.rooms.size >= config.rooms.maxRooms) {
      throw new AppError(ERROR_CODES.SERVER_BUSY, "The server is at capacity right now. Please try again in a few minutes.", 503);
    }
    if (this.roomsOwnedBy(ownerId) >= config.rooms.maxPerUser) {
      throw new AppError(ERROR_CODES.ROOM_LIMIT, "You already have the maximum number of open rooms. Close one first.", 409);
    }
    const roomId = this.generateUniqueRoomId();
    const room = new Room(roomId, ownerId, { maxParticipants: config.rooms.maxParticipants });
    this.rooms.set(roomId, room);
    logger.info(`Room created: ${roomId}`);
    return room;
  }

  getRoom(roomId) {
    return this.rooms.get(normalizeRoomId(roomId)) || null;
  }

  hasRoom(roomId) {
    return this.rooms.has(normalizeRoomId(roomId));
  }

  deleteRoom(roomId) {
    const id = normalizeRoomId(roomId);
    const room = this.rooms.get(id);
    if (room) room.dispose();
    this.rooms.delete(id);
    logger.info(`Room deleted: ${id}`);
  }

  scheduleEmptyRoomCleanup(roomId) {
    const room = this.getRoom(roomId);
    if (!room) return;
    room.clearEmptyRoomTimer();
    room.emptyRoomTimer = setTimeout(() => {
      const current = this.getRoom(roomId);
      if (current && current.isEmpty()) this.deleteRoom(roomId);
    }, config.rooms.emptyRoomTtlMs);
    room.emptyRoomTimer.unref?.();
  }

  cancelEmptyRoomCleanup(roomId) {
    const room = this.getRoom(roomId);
    if (room) room.clearEmptyRoomTimer();
  }

  /**
   * Deletes rooms nobody is in and nothing has happened in for `idleTtlMs`. This is what reclaims
   * rooms that were created but never joined (previously they lived until the process restarted).
   */
  sweep(now = Date.now()) {
    let removed = 0;
    for (const room of [...this.rooms.values()]) {
      if (room.onlineParticipants().length === 0 && now - room.lastActiveAt > config.rooms.idleTtlMs) {
        this.deleteRoom(room.roomId);
        removed++;
      }
    }
    return removed;
  }

  startSweeper() {
    if (this.sweeper) return;
    this.sweeper = setInterval(() => this.sweep(), config.rooms.sweepIntervalMs);
    this.sweeper.unref?.();
  }

  stopSweeper() {
    if (this.sweeper) clearInterval(this.sweeper);
    this.sweeper = null;
  }

  stats() {
    return {
      roomCount: this.rooms.size,
      totalParticipants: Array.from(this.rooms.values()).reduce((sum, r) => sum + r.participants.size, 0),
    };
  }
}

export const roomManager = new RoomManager();
export default roomManager;
