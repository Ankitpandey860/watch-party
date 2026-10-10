import { AppError, ERROR_CODES } from "../constants/errors.js";
import { TokenBucket } from "../infra/rateLimiter.js";
import { logger } from "../utils/logger.js";
import { BUCKETS, STRIKE_LIMIT, STRIKE_WINDOW_MS } from "./limits.js";
import { emitError } from "./socketUtils.js";

/**
 * True only for plain JSON-style objects ({} / Object.create(null)).
 * Rejects null, arrays, strings, numbers, booleans and class instances.
 */
export function isPlainObject(value) {
  if (value === null || typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

// Describes a rejected payload WITHOUT echoing its content (attacker-controlled, possibly huge).
function describe(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

/** Returns true when the event may proceed; otherwise tells the client and counts a strike. */
function allow(socket, event, bucketName) {
  if (!bucketName) return true;
  const spec = BUCKETS[bucketName];
  const buckets = (socket.data.buckets ||= {});
  const bucket = (buckets[bucketName] ||= new TokenBucket(spec));
  if (bucket.take()) return true;

  const now = Date.now();
  const strikes = (socket.data.strikes = (socket.data.strikes || []).filter((t) => now - t < STRIKE_WINDOW_MS));
  strikes.push(now);
  if (strikes.length === 1) logger.warn(`Rate limit hit on "${event}" (socket ${socket.id})`); // once per window, not per packet
  emitError(socket, new AppError(ERROR_CODES.RATE_LIMITED, "You're doing that too fast.", 429, { retryAfterMs: 1000 }));
  if (strikes.length >= STRIKE_LIMIT) {
    logger.warn(`Disconnecting socket ${socket.id} for repeated rate-limit violations`);
    socket.disconnect(true);
  }
  return false;
}

/**
 * Registers a listener for an event whose client payload must be an object.
 *
 * Why this exists: handlers used to destructure their argument in the parameter list
 * (`({ time } = {}) => ...`). The `= {}` default only covers `undefined`, so a client
 * sending `null` made destructuring throw OUTSIDE the handler's try/catch: an uncaught exception
 * that terminated the whole process.
 *
 * Guarantees for `handler`:
 *  - it only ever receives a plain object (a bare emit is treated as `{}`);
 *  - anything else is answered with INVALID_PAYLOAD and the handler never runs;
 *  - it is rate limited by `opts.bucket` (see limits.js);
 *  - if it throws, the error is logged server-side and the client sees only a generic error.
 */
export function onPayload(socket, event, handler, opts = {}) {
  socket.on(event, (payload) => {
    const body = payload === undefined ? {} : payload;

    if (!isPlainObject(body)) {
      logger.warn(`Rejected malformed "${event}" payload (${describe(body)}) from socket ${socket.id}`);
      emitError(socket, new AppError(ERROR_CODES.INVALID_PAYLOAD, "Malformed request payload.", 400));
      return;
    }
    if (!allow(socket, event, opts.bucket)) return;
    run(socket, event, () => handler(body));
  });
}

/** Like onPayload, for events that carry no payload (play, pause, leave_room). */
export function onSignal(socket, event, handler, opts = {}) {
  socket.on(event, () => {
    if (!allow(socket, event, opts.bucket)) return;
    run(socket, event, () => handler());
  });
}

function run(socket, event, fn) {
  try {
    fn();
  } catch (err) {
    if (err instanceof AppError) {
      emitError(socket, err); // expected, client-facing (e.g. NOT_AUTHORIZED)
      return;
    }
    logger.error(`Unexpected error in "${event}" handler for socket ${socket.id}:`, err);
    emitError(socket, err); // non-AppError -> generic INTERNAL_ERROR, nothing else exposed
  }
}
