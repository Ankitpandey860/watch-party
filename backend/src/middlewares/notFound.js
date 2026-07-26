import { ERROR_CODES } from "../constants/errors.js";

export function notFound(req, res) {
  res.status(404).json({
    error: { code: ERROR_CODES.INVALID_PAYLOAD, message: `No route: ${req.method} ${req.path}` },
  });
}
