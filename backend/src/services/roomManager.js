import { Room } from "../models/Room.js";
import { generateRoomCode, normalizeRoomId } from "../utils/idGenerator.js";
import { config } from "../config/env.js";
import { logger } from "../utils/logger.js";

class RoomManager {
  constructor() {
    /** @type {Map<string, Room>} keyed by roomId */
    this.rooms = new Map();
  }

  /** Generates a fresh, collision-free room code. */
  generateUniqueRoomId() {
    let id;
    do {
      id = generateRoomCode();
    } while (this.rooms.has(id));
    return id;
  }

  createRoom(hostUserId) {
    const roomId = this.generateUniqueRoomId();
    const room = new Room(roomId, hostUserId);
    this.rooms.set(roomId, room);
    logger.info(`Room created: ${roomId} (host=${hostUserId})`);
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
    if (room) room.clearEmptyRoomTimer();
    this.rooms.delete(id);
    logger.info(`Room deleted: ${id}`);
  }

  /** Schedules (or reschedules) deletion of a room that currently has zero participants. */
  scheduleEmptyRoomCleanup(roomId) {
    const room = this.getRoom(roomId);
    if (!room) return;
    room.clearEmptyRoomTimer();
    room.emptyRoomTimer = setTimeout(() => {
      const current = this.getRoom(roomId);
      if (current && current.isEmpty()) {
        this.deleteRoom(roomId);
      }
    }, config.emptyRoomTtlMs);
  }

  cancelEmptyRoomCleanup(roomId) {
    const room = this.getRoom(roomId);
    if (room) room.clearEmptyRoomTimer();
  }

  stats() {
    return {
      roomCount: this.rooms.size,
      totalParticipants: Array.from(this.rooms.values()).reduce(
        (sum, r) => sum + r.participants.size,
        0,
      ),
    };
  }
}

// Singleton — every controller/socket handler shares the same in-memory store.
export const roomManager = new RoomManager();
export default roomManager;
