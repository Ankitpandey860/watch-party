// Per-socket token buckets: `capacity` = allowed burst, `refillPerSec` = sustained rate.
// Chosen so normal use never notices them (a human chats a few messages a minute; a host seeks
// a few times a minute) while a script hammering an event is cut off within a second.
export const BUCKETS = Object.freeze({
  chat: { capacity: 8, refillPerSec: 1 },
  playback: { capacity: 20, refillPerSec: 5 },
  admin: { capacity: 10, refillPerSec: 1 },
  join: { capacity: 5, refillPerSec: 0.2 },
});

// A socket that keeps tripping the limiter is dropped (it reconnects with a fresh ticket if legitimate).
export const STRIKE_LIMIT = 30;
export const STRIKE_WINDOW_MS = 10_000;
