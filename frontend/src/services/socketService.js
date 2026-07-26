import { io } from "socket.io-client";
import { SOCKET_URL } from "./api";

// Socket.IO client wiring against the Express + Socket.IO backend
// (see /backend/src/socket). Event names below must match
// /backend/src/constants/events.js exactly.

let socket = null;

function ensureSocket() {
  if (!socket) {
    socket = io(SOCKET_URL, {
      autoConnect: false,
      transports: ["websocket", "polling"],
    });
  }
  return socket;
}

export const socketService = {
  /**
   * Opens the connection (if needed) and emits join_room — both on the initial
   * call and automatically again on every reconnect, so a dropped wifi
   * connection rejoins the room without the user doing anything.
   */
  connect(roomId, userId, username) {
    const s = ensureSocket();
    const doJoin = () => s.emit("join_room", { roomId, userId, username });

    s.off("connect", doJoin);
    s.on("connect", doJoin);

    if (s.connected) {
      doJoin();
    } else {
      s.connect();
    }
    return s;
  },

  disconnect() {
    if (socket) {
      if (socket.connected) socket.emit("leave_room");
      socket.removeAllListeners();
      socket.disconnect();
      socket = null;
    }
  },

  emit(event, payload) {
    if (!socket) return;
    socket.emit(event, payload);
  },

  /** Subscribes to a server event; returns an unsubscribe function. */
  on(event, handler) {
    const s = ensureSocket();
    s.on(event, handler);
    return () => s.off(event, handler);
  },

  get isConnected() {
    return Boolean(socket?.connected);
  },
};

export default socketService;
