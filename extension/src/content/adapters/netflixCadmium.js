// Isolated-world side of the primary Netflix adapter: talks to netflixMain.js over a private MessageChannel.
const CALL_TIMEOUT_MS = 3000;

export function createCadmiumAdapter(win = window) {
  let port = null;
  let seq = 0;
  const pending = new Map();
  let ready = null;
  let destroyed = false;

  function connect() {
    return new Promise((resolve, reject) => {
      const nonce = Array.from(win.crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, "0")).join("");
      const timer = setTimeout(() => { win.removeEventListener("message", onMsg); reject(new Error("bridge-timeout")); }, CALL_TIMEOUT_MS);
      function onMsg(ev) {
        if (ev.source !== win || ev.origin !== win.location.origin) return;
        const d = ev.data;
        if (!d || d.source !== "wp-netflix-port" || d.nonce !== nonce || !ev.ports[0]) return;
        clearTimeout(timer);
        win.removeEventListener("message", onMsg);
        port = ev.ports[0];
        port.onmessage = (m) => {
          const p = pending.get(m.data?.id);
          if (!p) return;
          pending.delete(m.data.id);
          m.data.ok ? p.res(m.data.data) : p.rej(new Error(m.data.error || "call-failed"));
        };
        resolve();
      }
      win.addEventListener("message", onMsg);
      win.postMessage({ source: "wp-netflix-hello", nonce }, win.location.origin);
    });
  }

  async function call(op, value) {
    if (destroyed) throw new Error("destroyed");
    ready = ready || connect().catch((e) => { ready = null; throw e; });
    await ready;
    return new Promise((res, rej) => {
      const id = ++seq;
      pending.set(id, { res, rej });
      setTimeout(() => { if (pending.delete(id)) rej(new Error("call-timeout")); }, CALL_TIMEOUT_MS);
      port.postMessage({ id, op, value });
    });
  }

  const adapter = {
    id: "netflix-cadmium",
    caps: { play: false, pause: false, seek: false, rate: false },
    methods: [],
    async probe() {
      try {
        const r = await call("probe");
        adapter.methods = r?.methods || [];
        const ok = !!r?.available;
        adapter.caps = { play: ok, pause: ok, seek: ok, rate: ok && adapter.methods.includes("getPlaybackRate") && adapter.methods.includes("setPlaybackRate") };
        return { available: ok, methods: adapter.methods };
      } catch (e) { return { available: false, methods: [], error: String(e.message) }; }
    },
    async read() {
      try {
        const r = await call("read");
        if (!r || !Number.isFinite(r.position)) return null;
        return { playing: !!r.playing, position: r.position, duration: Number.isFinite(r.duration) ? r.duration : null, rate: r.rate || 1, busy: r.busy };
      } catch { return null; }
    },
    play: () => call("play"),
    pause: () => call("pause"),
    seek: (s) => call("seek", s),
    setRate: (r) => call("rate", r),
    // No dependable DOM events on this path: the controller polls.
    destroy() { destroyed = true; try { port?.postMessage({ op: "close" }); port?.close(); } catch { /* already closed */ } pending.clear(); },
  };
  return adapter;
}
