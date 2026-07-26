import { roomService } from "../services/roomService.js";
import { asyncHandler } from "../utils/asyncHandler.js";

// POST /api/rooms  { username } -> { roomId, userId, username, role }
export const createRoom = asyncHandler(async (req, res) => {
  const result = roomService.createRoom({ username: req.body?.username });
  res.status(201).json(result);
});

// POST /api/rooms/:roomId/join  { username } -> { roomId, userId, username, role }
export const joinRoom = asyncHandler(async (req, res) => {
  const result = roomService.joinRoom({
    roomId: req.params.roomId,
    username: req.body?.username,
  });
  res.status(200).json(result);
});

// GET /api/rooms/:roomId -> { roomId, participantCount, onlineCount, currentVideo }
export const getRoom = asyncHandler(async (req, res) => {
  const result = roomService.getRoomInfo(req.params.roomId);
  res.status(200).json(result);
});
