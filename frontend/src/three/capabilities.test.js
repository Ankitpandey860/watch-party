import { describe, test, expect, beforeEach, vi } from "vitest";
import {
  detectCapabilities,
  getEffectsPreference,
  setEffectsPreference,
  EFFECTS_EVENT,
} from "./capabilities";

const env = (over = {}) => ({
  hasWebGL: () => true,
  prefersReducedMotion: false,
  hardwareConcurrency: 8,
  deviceMemory: 8,
  saveData: false,
  getPref: () => null,
  ...over,
});

describe("detectCapabilities", () => {
  test("a capable device runs the full animated scene", () => {
    expect(detectCapabilities(env())).toMatchObject({ mode: "full", reason: "ok" });
  });
  test("no WebGL -> off (CSS fallback), whatever the preference", () => {
    expect(detectCapabilities(env({ hasWebGL: () => false }))).toMatchObject({
      mode: "off",
      reason: "no-webgl",
    });
    expect(detectCapabilities(env({ hasWebGL: () => false, getPref: () => "on" })).mode).toBe(
      "off",
    );
  });
  test("prefers-reduced-motion -> a still frame (no animation loop)", () => {
    expect(detectCapabilities(env({ prefersReducedMotion: true }))).toMatchObject({
      mode: "static",
      reason: "reduced-motion",
    });
  });
  test.each([
    ["few CPU cores", { hardwareConcurrency: 2 }],
    ["little memory", { deviceMemory: 2 }],
    ["data saver", { saveData: true }],
  ])("low-power device (%s) -> off", (_n, over) => {
    expect(detectCapabilities(env(over))).toMatchObject({
      mode: "off",
      reason: "low-power",
      lowPower: true,
    });
  });
  test("the user's choice wins: 'off' disables, 'on' re-enables on low-power and for reduced motion", () => {
    expect(detectCapabilities(env({ getPref: () => "off" }))).toMatchObject({
      mode: "off",
      reason: "user-off",
    });
    expect(detectCapabilities(env({ hardwareConcurrency: 2, getPref: () => "on" })).mode).toBe(
      "full",
    );
    expect(detectCapabilities(env({ prefersReducedMotion: true, getPref: () => "on" })).mode).toBe(
      "full",
    );
  });
  test("no browser environment (SSR) -> off", () => {
    expect(detectCapabilities(null)).toMatchObject({ mode: "off", reason: "no-browser" });
  });
  test("jsdom (no WebGL) falls back safely", () => {
    expect(detectCapabilities().mode).toBe("off");
  });
});

describe("effects preference", () => {
  beforeEach(() => localStorage.clear());
  test("round-trips, clears, and announces changes", () => {
    const seen = vi.fn();
    window.addEventListener(EFFECTS_EVENT, seen);
    setEffectsPreference("off");
    expect(getEffectsPreference()).toBe("off");
    setEffectsPreference("on");
    expect(getEffectsPreference()).toBe("on");
    setEffectsPreference(null);
    expect(getEffectsPreference()).toBeNull();
    expect(seen).toHaveBeenCalledTimes(3);
    window.removeEventListener(EFFECTS_EVENT, seen);
  });
  test("ignores junk values and never stores anything auth-related", () => {
    setEffectsPreference("maybe");
    expect(getEffectsPreference()).toBeNull();
    expect(Object.keys(localStorage)).toEqual([]);
  });
});
