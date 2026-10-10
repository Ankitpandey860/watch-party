import { describe, test, expect } from "vitest";
import providerRegistry from "./index";

describe("provider registry (frontend)", () => {
  test("YouTube is registered and is the only provider (no unverified OTT integrations)", () => {
    expect(providerRegistry.list().map((p) => p.id)).toEqual(["youtube"]);
  });
  test("resolve() maps input to { provider, mediaId }, or null", () => {
    expect(providerRegistry.resolve("https://youtu.be/dQw4w9WgXcQ")).toEqual({
      provider: "youtube",
      mediaId: "dQw4w9WgXcQ",
    });
    expect(providerRegistry.resolve("https://netflix.com/watch/123")).toBeNull();
  });
  test("urlFor / labelFor build URLs and labels (defaulting to the first provider)", () => {
    expect(providerRegistry.urlFor("youtube", "dQw4w9WgXcQ")).toBe(
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    );
    expect(providerRegistry.urlFor(null, "dQw4w9WgXcQ")).toBe(
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    );
    expect(providerRegistry.urlFor("youtube", null)).toBe("");
    expect(providerRegistry.labelFor("youtube")).toBe("YouTube");
    expect(providerRegistry.labelFor("unknown")).toBe("YouTube");
  });
});
