import http from "node:http";
import { createApp } from "./app.js";
import { initSocket } from "./socket/index.js";
import { config } from "./config/env.js";
import { logger } from "./utils/logger.js";

const app = createApp();
const httpServer = http.createServer(app);

initSocket(httpServer);

httpServer.listen(config.port, () => {
  logger.info(`Watch Party backend listening on port ${config.port}`);
  logger.info(`Allowed CORS origins: ${config.corsOrigins.join(", ")}`);
});

process.on("unhandledRejection", (reason) => {
  logger.error("Unhandled promise rejection:", reason);
});
