import { io } from "socket.io-client";
import { SOCKET_URL } from "./api";
import roomService from "./roomService";

// Socket.IO client. Event names must match backend/src/constants/events.js.
//
// Identity is NEVER sent by the client. On every (re)connection attempt the `auth` callback below
// fetches a fresh one-time ticket over REST (using the session cookie); the server derives who we
// are from that ticket alone.

let socket = null;
let ticketFailure = null; // why the last ticket request failed (404 room gone, 403 banned, 401 signed out...)

export const socketService = {
  /** Opens the connection and joins `roomId` (again on every automatic reconnect). */
  connect(roomId) {
    this.disconnect({ silent: true });
    ticketFailure = null;
    const s = io(SOCKET_URL, {
      autoConnect: false,
      transports: ["websocket", "polling"],
      reconnectionDelay: 1000,
      reconnectionDelayMax: 8000,
      auth: async (cb) => {
        try {
          cb({ ticket: await roomService.socketTicket(roomId) });
          ticketFailure = null;
        } catch (err) {
          ticketFailure = { status: err.status, code: err.code, message: err.message };
          cb({ ticket: "" }); // the server refuses an empty ticket; the failure reason is kept above
        }
      },
    });
    s.on("connect", () => s.emit("join_room", { roomId }));
    socket = s;
    s.connect();
    return s;
  },

  /** Reconnects with a fresh ticket (e.g. after the session was re-issued). */
  reconnect() {
    if (socket && !socket.connected) socket.connect();
  },

  disconnect({ silent = false } = {}) {
    if (!socket) return;
    if (socket.connected && !silent) socket.emit("leave_room");
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  },

  emit(event, payload) {
    if (!socket) return;
    socket.emit(event, payload);
  },

  /** Subscribes to a socket event (including connect / disconnect / connect_error); returns an unsubscribe function. */
  on(event, handler) {
    if (!socket) return () => {};
    const s = socket;
    s.on(event, handler);
    return () => s.off(event, handler);
  },

  get lastTicketFailure() {
    return ticketFailure;
  },

  get isConnected() {
    return Boolean(socket?.connected);
  },
};

export default socketService;
