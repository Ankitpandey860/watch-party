// PlayerAdapter: the ONE interface the sync engine (sync/useSyncedPlayer.js) talks to. Each provider
// wraps its SDK player in an adapter; nothing outside adapters/ ever calls an SDK directly.
//
//   id            string        provider id (for diagnostics)
//   caps          {play,pause,seek,rate,volume}   what this player can REALLY do (explicit, never assumed)
//   play()        -> void | Promise
//   pause()       -> void | Promise
//   seekTo(sec)   -> void | Promise
//   getCurrentTime() -> number | Promise<number>
//   getDuration()    -> number | Promise<number>      (0/undefined while unknown)
//   setVolume(0..100)    optional (caps.volume)
//   setRate(rate) / getRate()   optional (caps.rate)
//   destroy()     release SDK resources / listeners. Idempotent.
//
// Adapters are PULL-based for position and state; PUSH-based events (user clicked native controls,
// buffering, errors) arrive through the callbacks the component passes to the SDK wrapper and are
// normalised into the hook's handlers: onPlayState(isPlaying) / onSeek(sec) / onRate(r) /
// onBuffering(bool) / onBlocked() / onError(err).
//
// Methods may be synchronous (YouTube) or return promises (Vimeo): the engine handles both.

export const REQUIRED_METHODS = [
  "play",
  "pause",
  "seekTo",
  "getCurrentTime",
  "getDuration",
  "destroy",
];
export const CAP_KEYS = ["play", "pause", "seek", "rate", "volume"];

/** Fills in unspecified capability flags with `false` (a missing flag is "not supported"). */
export function makeCaps(partial = {}) {
  return Object.freeze(Object.fromEntries(CAP_KEYS.map((k) => [k, partial[k] === true])));
}

/** Throws if `adapter` does not satisfy the contract. Used by tests and in development. */
export function assertAdapter(adapter) {
  if (!adapter || typeof adapter !== "object") throw new TypeError("adapter must be an object");
  for (const m of REQUIRED_METHODS) {
    if (typeof adapter[m] !== "function") throw new TypeError(`adapter.${m} is required`);
  }
  if (!adapter.caps || CAP_KEYS.some((k) => typeof adapter.caps[k] !== "boolean")) {
    throw new TypeError("adapter.caps must define every capability flag as a boolean");
  }
  if (
    adapter.caps.rate &&
    (typeof adapter.setRate !== "function" || typeof adapter.getRate !== "function")
  ) {
    throw new TypeError("adapter.caps.rate requires setRate() and getRate()");
  }
  if (adapter.caps.volume && typeof adapter.setVolume !== "function") {
    throw new TypeError("adapter.caps.volume requires setVolume()");
  }
  return adapter;
}

export const isThenable = (v) => v != null && typeof v.then === "function";

/** Applies `fn` to a value that may or may not be a promise, staying synchronous when it is not. */
export function chain(value, fn) {
  return isThenable(value) ? value.then(fn) : fn(value);
}

/** True for the errors browsers/SDKs raise when playback needs a user gesture. */
export function isAutoplayBlock(err) {
  const text = `${err?.name || ""} ${err?.message || ""}`;
  return /NotAllowed|autoplay|user (gesture|interaction)|play\(\) failed/i.test(text);
}

/** Normalises any SDK error into { code, message } with user-facing wording (never a stack/token). */
export function normalizeError(provider, err, fallback = "This video can't be played.") {
  return { provider, code: String(err?.name || err?.code || "error"), message: fallback };
}
