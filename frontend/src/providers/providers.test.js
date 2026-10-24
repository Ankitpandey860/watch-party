import { describe, test, expect } from "vitest";
import providerRegistry from "./index";

describe("provider registry (frontend)", () => {
  test("registers exactly the providers that have a real integration", () => {
    expect(providerRegistry.list().map((p) => p.id)).toEqual([
      "youtube",
      "vimeo",
      "twitch",
      "netflix",
    ]);
    expect(providerRegistry.list().map((p) => p.mode)).toEqual([
      "embedded",
      "embedded",
      "embedded",
      "companion",
    ]);
  });
  test("every provider states its capabilities and limitations explicitly", () => {
    for (const p of providerRegistry.list()) {
      expect(Object.keys(p.capabilities).sort()).toEqual(["pause", "play", "rate", "seek", "sync"]);
      expect(p.limitations.length).toBeGreaterThan(0);
      expect(p.example && p.parse(p.example)).toBeTruthy(); // the documented example really parses
    }
  });
  test("resolve() maps input to { provider, mediaId, params }, or null", () => {
    expect(providerRegistry.resolve("https://youtu.be/dQw4w9WgXcQ")).toEqual({
      provider: "youtube",
      mediaId: "dQw4w9WgXcQ",
      params: {},
    });
    expect(providerRegistry.resolve("https://vimeo.com/76979871/abcdef0123")).toEqual({
      provider: "vimeo",
      mediaId: "76979871",
      params: { hash: "abcdef0123" },
    });
    expect(providerRegistry.resolve("https://www.twitch.tv/videos/1234567890").params).toEqual({
      kind: "video",
    });
    expect(providerRegistry.resolve("https://www.netflix.com/watch/80100172").provider).toBe(
      "netflix",
    );
    expect(providerRegistry.resolve("https://example.com/watch/80100172")).toBeNull();
  });
  test("a bare numeric id needs an explicit provider (it is ambiguous otherwise)", () => {
    expect(providerRegistry.resolve("76979871")).toBeNull();
    expect(providerRegistry.resolve("76979871", "vimeo").provider).toBe("vimeo");
    expect(providerRegistry.resolve("76979871", "netflix")).toBeNull();
    expect(providerRegistry.resolve("https://vimeo.com/76979871", "youtube")).toBeNull();
    expect(providerRegistry.resolve("x", "nope")).toBeNull();
  });
  test("urlFor / labelFor rebuild links (defaulting to YouTube for legacy callers)", () => {
    expect(providerRegistry.urlFor("youtube", "dQw4w9WgXcQ")).toBe(
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    );
    expect(providerRegistry.urlFor(null, "dQw4w9WgXcQ")).toBe(
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    );
    expect(providerRegistry.urlFor("youtube", null)).toBe("");
    expect(providerRegistry.urlFor("vimeo", "76979871", { hash: "abcdef0123" })).toBe(
      "https://vimeo.com/76979871/abcdef0123",
    );
    expect(providerRegistry.urlFor("twitch", "1234567890", { kind: "video" })).toBe(
      "https://www.twitch.tv/videos/1234567890",
    );
    expect(providerRegistry.urlFor("twitch", "Slug-abc", { kind: "clip" })).toBe(
      "https://clips.twitch.tv/Slug-abc",
    );
    expect(providerRegistry.urlFor("netflix", "80100172")).toBe(
      "https://www.netflix.com/watch/80100172",
    );
    expect(providerRegistry.labelFor("youtube")).toBe("YouTube");
    expect(providerRegistry.labelFor("unknown")).toBe("YouTube");
  });
  test("Twitch clips are shown but explicitly NOT remote-controllable; VODs are", () => {
    expect(providerRegistry.capabilitiesFor("twitch", { kind: "clip" })).toMatchObject({
      sync: false,
      seek: false,
    });
    expect(providerRegistry.capabilitiesFor("twitch", { kind: "video" })).toMatchObject({
      sync: true,
      seek: true,
      rate: false,
    });
    expect(providerRegistry.capabilitiesFor("nope")).toBeNull();
  });
  test("explain() gives provider-specific reasons, including the Twitch live-stream refusal", () => {
    expect(providerRegistry.explain("https://www.twitch.tv/shroud")).toMatch(/Live Twitch streams/);
    expect(providerRegistry.explain("https://www.netflix.com/title/80100172", "netflix")).toMatch(
      /netflix\.com\/watch/,
    );
    expect(providerRegistry.explain("garbage")).toMatch(/supported/);
  });
});
