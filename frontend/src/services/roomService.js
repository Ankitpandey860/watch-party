import api from "./api";

// Room-related HTTP calls (see backend/src/routes/roomRoutes.js + authRoutes.js).
export const roomService = {
  // POST /rooms -> { roomId }   (signed-in accounts only; the caller becomes the host)
  async createRoom() {
    const { data } = await api.post("/rooms");
    return data;
  },

  // GET /rooms/:id -> { roomId, participantCount, maxParticipants, full }
  async getRoom(roomId) {
    const { data } = await api.get(`/rooms/${encodeURIComponent(roomId)}`);
    return data;
  },

  // POST /rooms/:id/join { displayName? } -> { roomId, principal }
  // With no session this also creates the guest identity, so an invite link needs only a name.
  async joinRoom(roomId, displayName) {
    const { data } = await api.post(
      `/rooms/${encodeURIComponent(roomId)}/join`,
      displayName ? { displayName } : {},
    );
    return data;
  },

  // POST /auth/socket-ticket { roomId } -> one-time ticket for the Socket.IO handshake
  async socketTicket(roomId) {
    const { data } = await api.post("/auth/socket-ticket", { roomId });
    return data.ticket;
  },
};

export default roomService;
