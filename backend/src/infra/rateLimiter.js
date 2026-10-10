import { AppError, ERROR_CODES } from "../constants/errors.js";

/**
 * Fixed-window counter keyed by an arbitrary string. In-memory: correct for ONE process.
 * With several instances each keeps its own counters (limits become per-instance);
 * a shared store (e.g. Redis) would be required — see docs/ARCHITECTURE.md.
 */
export class WindowLimiter {
  constructor({ windowMs, max, now = Date.now, maxKeys = 50_000 }) {
    this.windowMs = windowMs;
    this.max = max;
    this.now = now;
    this.maxKeys = maxKeys;
    this.hits = new Map(); // key -> { count, resetAt }
  }

  /** Records one hit. Returns { allowed, retryAfterMs, remaining }. */
  hit(key) {
    const t = this.now();
    let entry = this.hits.get(key);
    if (!entry || entry.resetAt <= t) {
      if (this.hits.size >= this.maxKeys) this.prune(t);
      entry = { count: 0, resetAt: t + this.windowMs };
      this.hits.set(key, entry);
    }
    entry.count += 1;
    const allowed = entry.count <= this.max;
    return { allowed, retryAfterMs: allowed ? 0 : entry.resetAt - t, remaining: Math.max(0, this.max - entry.count) };
  }

  prune(t = this.now()) {
    for (const [k, e] of this.hits) if (e.resetAt <= t) this.hits.delete(k);
    // Still full (a flood of distinct keys)? Drop the oldest entries rather than grow without bound.
    if (this.hits.size >= this.maxKeys) {
      let drop = Math.ceil(this.maxKeys * 0.1);
      for (const k of this.hits.keys()) { this.hits.delete(k); if (--drop <= 0) break; }
    }
  }
}

/** Token bucket (burst `capacity`, refilling `refillPerSec`) — used per socket connection. */
export class TokenBucket {
  constructor({ capacity, refillPerSec, now = Date.now }) {
    this.capacity = capacity;
    this.refillPerSec = refillPerSec;
    this.now = now;
    this.tokens = capacity;
    this.updatedAt = now();
  }

  take() {
    const t = this.now();
    this.tokens = Math.min(this.capacity, this.tokens + ((t - this.updatedAt) / 1000) * this.refillPerSec);
    this.updatedAt = t;
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }
}

/**
 * Express middleware factory. `keyFn(req)` may return a string or an array of strings;
 * every key is counted and ALL must be within limits (e.g. per-IP and per-email together).
 */
export function createRateLimitMiddleware({ name, limiter, keyFn, disabled = false }) {
  return (req, res, next) => {
    if (disabled) return next();
    const keys = [].concat(keyFn(req)).filter(Boolean);
    let worst = 0;
    for (const key of keys) {
      const r = limiter.hit(`${name}:${key}`);
      if (!r.allowed) worst = Math.max(worst, r.retryAfterMs);
    }
    if (worst > 0) {
      const retryAfterSeconds = Math.max(1, Math.ceil(worst / 1000));
      res.set("Retry-After", String(retryAfterSeconds));
      return next(new AppError(ERROR_CODES.RATE_LIMITED, "Too many requests. Please slow down.", 429, { retryAfterSeconds }));
    }
    return next();
  };
}
