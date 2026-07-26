import { AppError, ERROR_CODES } from "../constants/errors.js";
import { logger } from "../utils/logger.js";

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({ error: { code: err.code, message: err.message } });
  }

  // CORS rejection thrown by config/cors.js
  if (err && /not allowed by CORS/i.test(err.message || "")) {
    return res.status(403).json({
      error: { code: ERROR_CODES.NOT_AUTHORIZED, message: "Origin not allowed." },
    });
  }

  logger.error("Unhandled error:", err);
  return res.status(500).json({
    error: { code: ERROR_CODES.INTERNAL_ERROR, message: "Something went wrong." },
  });
}
