import { Router } from "express";
import { createRoom, joinRoom, getRoom } from "../controllers/roomController.js";

const router = Router();

router.post("/", createRoom);
router.get("/:roomId", getRoom);
router.post("/:roomId/join", joinRoom);

export default router;
