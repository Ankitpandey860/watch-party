// Decides how much 3D to run. Pure functions over an injectable environment so every branch is testable.
//
//   mode "full"   - animated, interactive WebGL scene
//   mode "static" - a single still frame (prefers-reduced-motion); redraws only on user input
//   mode "off"    - no WebGL at all: a CSS gradient fallback is shown (no WebGL, low-power, or user opted out)
const PREF_KEY = "wp:effects"; // a UI preference only ("on" | "off"); never anything auth-related

export function browserEnv() {
  if (typeof window === "undefined") return null;
  const safe = (fn, fallback) => {
    try {
      return fn();
    } catch {
      return fallback;
    }
  };
  return {
    hasWebGL: () =>
      safe(() => {
        const c = document.createElement("canvas");
        return Boolean(c.getContext("webgl2") || c.getContext("webgl"));
      }, false),
    prefersReducedMotion: safe(
      () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      false,
    ),
    hardwareConcurrency: navigator.hardwareConcurrency,
    deviceMemory: navigator.deviceMemory,
    saveData: Boolean(navigator.connection?.saveData),
    getPref: () => safe(() => window.localStorage.getItem(PREF_KEY), null),
  };
}

export function detectCapabilities(env = browserEnv()) {
  if (!env)
    return {
      mode: "off",
      reason: "no-browser",
      webgl: false,
      reducedMotion: false,
      lowPower: false,
      pref: null,
    };
  const webgl = Boolean(env.hasWebGL());
  const lowPower =
    Boolean(env.saveData) ||
    (typeof env.hardwareConcurrency === "number" && env.hardwareConcurrency <= 2) ||
    (typeof env.deviceMemory === "number" && env.deviceMemory <= 2);
  const pref = env.getPref();
  const reducedMotion = Boolean(env.prefersReducedMotion);

  let mode = "full";
  let reason = "ok";
  if (!webgl) {
    mode = "off";
    reason = "no-webgl";
  } else if (pref === "off") {
    mode = "off";
    reason = "user-off";
  } else if (pref !== "on" && lowPower) {
    mode = "off";
    reason = "low-power";
  } else if (reducedMotion && pref !== "on") {
    mode = "static";
    reason = "reduced-motion";
  }
  return { mode, reason, webgl, reducedMotion, lowPower, pref };
}

export const EFFECTS_EVENT = "wp:effects-changed";

export function getEffectsPreference() {
  try {
    return window.localStorage.getItem(PREF_KEY);
  } catch {
    return null;
  }
}

export function setEffectsPreference(value) {
  try {
    if (value === "on" || value === "off") window.localStorage.setItem(PREF_KEY, value);
    else window.localStorage.removeItem(PREF_KEY);
  } catch {
    /* storage unavailable: preference just won't persist */
  }
  if (typeof window !== "undefined") window.dispatchEvent(new Event(EFFECTS_EVENT));
}
