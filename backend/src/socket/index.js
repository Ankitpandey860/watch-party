import { Server } from "socket.io";
import { socketCorsOptions } from "../config/cors.js";
import { registerRoomHandlers } from "./handlers/roomHandlers.js";
import { registerPlaybackHandlers } from "./handlers/playbackHandlers.js";
import { registerRoleHandlers } from "./handlers/roleHandlers.js";
import { registerChatHandlers } from "./handlers/chatHandlers.js";
import { logger } from "../utils/logger.js";

export function initSocket(httpServer) {
  const io = new Server(httpServer, {
    cors: socketCorsOptions,
  });

  io.on("connection", (socket) => {
    // roomId/userId are populated once join_room succeeds; used by every other
    // handler to know "who is this socket, in which room" without re-trusting
    // whatever the client claims on each individual event.
    socket.data.roomId = null;
    socket.data.userId = null;

    logger.info(`Socket connected: ${socket.id}`);

    registerRoomHandlers(io, socket);
    registerPlaybackHandlers(io, socket);
    registerRoleHandlers(io, socket);
    registerChatHandlers(io, socket);
  });

  return io;
}

export default initSocket;
