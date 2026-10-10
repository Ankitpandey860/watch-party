import { AppError, ERROR_CODES } from "../constants/errors.js";
import { logger } from "../utils/logger.js";

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({ error: { code: err.code, message: err.message, ...(err.extra || {}) } });
  }
  // body-parser failures are client errors, not server errors
  if (err?.type === "entity.parse.failed") {
    return res.status(400).json({ error: { code: ERROR_CODES.INVALID_JSON, message: "Request body is not valid JSON." } });
  }
  if (err?.type === "entity.too.large") {
    return res.status(413).json({ error: { code: ERROR_CODES.PAYLOAD_TOO_LARGE, message: "Request body is too large." } });
  }
  // Never expose internals: log server-side, answer generically.
  logger.error(`Unhandled error on ${req.method} ${req.path}:`, err);
  return res.status(500).json({ error: { code: ERROR_CODES.INTERNAL_ERROR, message: "Something went wrong." } });
}
