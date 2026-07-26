import api from "./api";

// Room-related HTTP calls against the Express backend (see /backend/src/routes/roomRoutes.js).
// These run once, before the socket connects, so the UI can show a clear error
// (room not found, username taken) without ever navigating to /room/:roomId.
export const roomService = {
  // POST /rooms { username } -> { roomId, userId, username, role: 'host' }
  async createRoom({ username }) {
    const { data } = await api.post("/rooms", { username });
    return data;
  },

  // POST /rooms/:roomId/join { username } -> { roomId, userId, username, role: 'participant' }
  async joinRoom({ roomId, username }) {
    const { data } = await api.post(`/rooms/${encodeURIComponent(roomId)}/join`, { username });
    return data;
  },

  // GET /rooms/:roomId -> { roomId, participantCount, onlineCount, currentVideo }
  async getRoom(roomId) {
    const { data } = await api.get(`/rooms/${encodeURIComponent(roomId)}`);
    return data;
  },
};

export default roomService;
