import express from "express";
import cors from "cors";
import { createApiRouter } from "./routes/index.js";
import { errorHandler } from "./middlewares/errorHandler.js";
import { notFound } from "./middlewares/notFound.js";
import { csrfGuard, securityHeaders } from "./middlewares/auth.js";
import { createRateLimitMiddleware } from "./infra/rateLimiter.js";
import { expressCorsOptions } from "./config/cors.js";

export function createApp(ctx) {
  const { config, limiters } = ctx;
  const app = express();

  app.disable("x-powered-by");
  app.set("trust proxy", config.trustProxyHops);

  app.use(securityHeaders);
  app.use(cors(expressCorsOptions));
  app.use(express.json({ limit: "10kb" }));
  app.use(csrfGuard({ config }));
  app.use(createRateLimitMiddleware({ name: "api", limiter: limiters.apiIp, keyFn: (req) => req.ip, disabled: config.limits.disabled }));

  app.use("/api", createApiRouter(ctx));

  app.use(notFound);
  app.use(errorHandler);
  return app;
}

export default createApp;
