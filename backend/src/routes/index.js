import { Router } from "express";
import roomRoutes from "./roomRoutes.js";
import { roomManager } from "../services/roomManager.js";

const router = Router();

router.get("/health", (req, res) => {
  res.json({ status: "ok", uptime: process.uptime(), ...roomManager.stats() });
});

router.use("/rooms", roomRoutes);

export default router;
