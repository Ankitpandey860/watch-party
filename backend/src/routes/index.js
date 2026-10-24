import { Router } from "express";
import { createAuthRoutes } from "./authRoutes.js";
import { createExtensionRoutes } from "./extensionRoutes.js";
import { createRoomRoutes } from "./roomRoutes.js";
import { attachPrincipal } from "../middlewares/auth.js";

export function createApiRouter(ctx) {
  const router = Router();

  // Liveness: no database, minimal output (suitable as the Render health-check path).
  router.get("/health", (_req, res) => res.json({ status: "ok", uptime: Math.round(process.uptime()) }));

  // Readiness: confirms the database answers (may wake a suspended Neon compute).
  router.get("/ready", async (_req, res) => {
    try {
      await ctx.db.query("SELECT 1");
      res.json({ status: "ready" });
    } catch {
      res.status(503).json({ status: "database_unavailable" });
    }
  });

  router.use(attachPrincipal(ctx));
  router.use("/auth", createAuthRoutes(ctx));
  router.use("/rooms", createRoomRoutes(ctx));
  router.use("/extension", createExtensionRoutes(ctx));
  return router;
}
