// Deterministic fakes: a controllable clock and a fake player that behaves like a real one
// (position advances while playing; commands change state; every call is recorded).
export function makeClock(start = 1_000_000) {
  const c = { t: start, players: [], now: () => c.t,
    advance(ms) { c.t += ms; for (const p of c.players) p.tickTime(ms); } };
  return c;
}

export function makePlayer(clock, { id = "netflix-cadmium", caps = { play: true, pause: true, seek: true, rate: false }, native = false, position = 0, playing = false } = {}) {
  const p = {
    id, caps, methods: [], state: { playing, position, rate: 1, duration: 3600 }, calls: [], stalled: false, ad: false,
    failPlayWith: null, nativeCb: null,
    tickTime(ms) { if (p.state.playing && !p.stalled) p.state.position += (ms / 1000) * p.state.rate; },
    async read() { return { ...p.state }; },
    async play() { if (p.failPlayWith) { const e = new Error("blocked"); e.name = p.failPlayWith; throw e; } p.calls.push(["play"]); p.state.playing = true; },
    async pause() { p.calls.push(["pause"]); p.state.playing = false; },
    async seek(s) { if (!p.caps.seek) throw new Error("seek-unsupported"); p.calls.push(["seek", s]); p.state.position = s; },
    async setRate(r) { p.calls.push(["rate", r]); p.state.rate = r; },
    isAd: () => p.ad,
    destroy() {},
    // a USER doing something through the player UI (not through our adapter calls)
    user: { play() { p.state.playing = true; }, pause() { p.state.playing = false; }, seek(s) { p.state.position = s; } },
  };
  if (native) p.onNativeEvents = (cb) => { p.nativeCb = cb; return () => { p.nativeCb = null; }; };
  clock.players.push(p);
  return p;
}

export const target = (o = {}) => ({ kind: "target", canControl: false, force: false, note: null, target: { mediaId: "80100172", playing: true, time: 100, rate: 1, seq: 1, ...o } });
