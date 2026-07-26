import { config } from "./env.js";

// Shared origin-check so Express and Socket.IO agree on who's allowed in.
export function corsOriginCheck(origin, callback) {
  // Allow non-browser clients (curl, server-to-server, same-origin) with no Origin header.
  if (!origin) return callback(null, true);
  if (config.corsOrigins.includes("*") || config.corsOrigins.includes(origin)) {
    return callback(null, true);
  }
  return callback(new Error(`Origin ${origin} not allowed by CORS`));
}

export const expressCorsOptions = {
  origin: true,
  credentials: false,
};

export const socketCorsOptions = {
  origin: "*",
  credentials: false,
};