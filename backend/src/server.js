import http from "node:http";
import { createApp } from "./app.js";
import { createContext } from "./context.js";
import { initSocket } from "./socket/index.js";
import { config } from "./config/env.js";
import { runMigrations } from "./db/migrate.js";
import { logger } from "./utils/logger.js";

const ctx = await createContext();
if (config.autoMigrate) await runMigrations(ctx.db, undefined, (m) => logger.info(`migration ${m}`));
const app = createApp(ctx);
const httpServer = http.createServer(app);
const io = initSocket(httpServer, ctx);
ctx.startMaintenance();

httpServer.listen(config.port, () => {
  logger.info(`Watch Party backend listening on port ${config.port}`);
  logger.info(`Allowed origins: ${config.corsOrigins.join(", ")}`);
  logger.info(`Sign-in methods: google=${ctx.google.enabled} email=${ctx.mailer.enabled}`);
});

// Render sends SIGTERM on every deploy: stop taking connections, close sockets and the pool, then exit.
function shutdown(signal) {
  logger.info(`${signal} received, shutting down`);
  const force = setTimeout(() => process.exit(1), 10_000);
  force.unref();
  io.close(() => ctx.close().finally(() => process.exit(0)));
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

process.on("unhandledRejection", (reason) => {
  logger.error("Unhandled promise rejection:", reason);
});
// Last resort only (the real defences are input validation and per-handler containment):
// state after an unknown exception is undefined, so log and let the platform restart us.
process.on("uncaughtException", (err) => {
  logger.error("Uncaught exception, exiting:", err);
  process.exit(1);
});
