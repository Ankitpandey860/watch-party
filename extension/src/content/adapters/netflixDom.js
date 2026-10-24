// FALLBACK adapter: used only when Netflix's internal player API is unavailable. It uses public
// HTMLVideoElement methods for what is safe (observe, play, pause) and REFUSES to seek: assigning
// video.currentTime on Netflix's player is known to throw a playback error, so we do not do it.
// The user is told synchronisation is "limited" instead of being silently degraded.

export function createDomAdapter(doc = document) {
  const pick = () => {
    const vs = [...doc.querySelectorAll("video")].filter((v) => v.readyState > 0 && (v.offsetWidth > 0 || v.offsetHeight > 0));
    return vs.sort((a, b) => (b.duration || 0) - (a.duration || 0))[0] || null; // the feature, not a preview/ad element
  };
  const adapter = {
    id: "netflix-dom",
    caps: { play: true, pause: true, seek: false, rate: false },
    methods: ["HTMLVideoElement.play", "HTMLVideoElement.pause"],
    async probe() { return { available: !!pick(), methods: adapter.methods }; },
    async read() {
      const v = pick();
      return v ? { playing: !v.paused && !v.ended, position: v.currentTime, duration: Number.isFinite(v.duration) ? v.duration : null, rate: v.playbackRate || 1 } : null;
    },
    async play() { const v = pick(); if (!v) throw new Error("no-video"); await v.play(); },
    async pause() { pick()?.pause(); },
    async seek() { throw new Error("seek-unsupported"); },
    onNativeEvents(cb) {
      const attach = (v) => {
        if (v.__wpAttached) return;
        v.__wpAttached = true;
        for (const e of ["play", "pause", "seeked", "waiting", "playing"]) v.addEventListener(e, () => { if (v === pick()) cb(e); });
      };
      const t = setInterval(() => doc.querySelectorAll("video").forEach(attach), 500);
      return () => clearInterval(t);
    },
    destroy() {},
  };
  return adapter;
}
