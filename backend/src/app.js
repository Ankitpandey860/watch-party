import express from "express";
import cors from "cors";
import routes from "./routes/index.js";
import { errorHandler } from "./middlewares/errorHandler.js";
import { notFound } from "./middlewares/notFound.js";
import { expressCorsOptions } from "./config/cors.js";

export function createApp() {
  const app = express();

  app.use(cors(expressCorsOptions));
  app.use(express.json());

  app.use("/api", routes);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}

export default createApp;
