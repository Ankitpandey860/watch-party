// Loads a third-party player SDK <script> at most once per page, safely:
//  - concurrent callers share one in-flight load (no duplicate <script> tags);
//  - a failed load is NOT cached forever (the next call retries, and the failed tag is removed);
//  - it times out instead of hanging the player;
//  - the global it must define is verified (a blocked/!ok script that defines nothing is an error).
const loads = new Map();

export function loadScriptOnce(
  src,
  { globalName, timeoutMs = 15_000, doc = document, win = window } = {},
) {
  if (globalName && win[globalName]) return Promise.resolve(win[globalName]);
  if (loads.has(src)) return loads.get(src);

  const promise = new Promise((resolve, reject) => {
    const script = doc.createElement("script");
    let done = false;
    const finish = (err, value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      script.onload = script.onerror = null;
      if (err) {
        script.remove();
        loads.delete(src); // allow a retry
        reject(err);
      } else resolve(value);
    };
    const timer = setTimeout(
      () => finish(new Error(`Timed out loading ${new URL(src).hostname}`)),
      timeoutMs,
    );
    script.src = src;
    script.async = true;
    script.onload = () => {
      const g = globalName ? win[globalName] : true;
      g
        ? finish(null, g)
        : finish(new Error(`${new URL(src).hostname} loaded but did not define ${globalName}`));
    };
    script.onerror = () =>
      finish(
        new Error(
          `Couldn't load ${new URL(src).hostname} (blocked by a network, ad-blocker or privacy setting?)`,
        ),
      );
    doc.head.appendChild(script);
  });
  loads.set(src, promise);
  return promise;
}

/** Test hook: forget cached loads. */
export function _resetSdkLoader() {
  loads.clear();
}
