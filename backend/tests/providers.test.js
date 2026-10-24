// Provider descriptors + registry: URL parsing, normalisation and rejection (no network, pure functions).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { providerRegistry as reg } from "../src/providers/registry.js";

const ok = (input, hint) => reg.resolveMedia(input, hint);

describe("YouTube (unchanged behaviour)", () => {
  test("bare id and URLs resolve", () => {
    assert.deepEqual(ok("dQw4w9WgXcQ"), { provider: "youtube", mediaId: "dQw4w9WgXcQ", params: {} });
    assert.equal(ok("https://youtu.be/dQw4w9WgXcQ").mediaId, "dQw4w9WgXcQ");
  });
});

describe("Vimeo", () => {
  test("public, unlisted (path hash and ?h=) and player URLs", () => {
    assert.deepEqual(ok("https://vimeo.com/76979871"), { provider: "vimeo", mediaId: "76979871", params: {} });
    assert.deepEqual(ok("https://vimeo.com/76979871/ABCDEF0123").params, { hash: "abcdef0123" });
    assert.deepEqual(ok("https://player.vimeo.com/video/76979871?h=0123456789").params, { hash: "0123456789" });
    assert.equal(ok("https://vimeo.com/channels/staffpicks/76979871").mediaId, "76979871");
  });
  test("a bare numeric id is only accepted with an explicit provider (it is ambiguous otherwise)", () => {
    assert.equal(ok("76979871"), null);
    assert.equal(ok("76979871", "vimeo").mediaId, "76979871");
    assert.equal(ok("76979871", "twitch").params.kind, "video"); // the hint, not the id shape, picks the provider
  });
  test("an unrecognised path segment after the id is not treated as a privacy hash", () => {
    assert.deepEqual(ok("https://vimeo.com/76979871/zzzz").params, {});
  });
  test("rejects look-alike hosts, bad hashes, non-http schemes and junk", () => {
    for (const bad of ["https://notvimeo.com/76979871", "https://vimeo.com.evil.io/76979871",
      "https://vimeo.com/76979871?h=<script>", "javascript:alert(1)", "https://vimeo.com/", "https://vimeo.com/abc", "https://vimeo.com/../etc/76979871"]) {
      assert.equal(ok(bad), null, bad);
    }
  });
});

describe("Twitch", () => {
  test("VODs and clips resolve with their kind", () => {
    assert.deepEqual(ok("https://www.twitch.tv/videos/1234567890"), { provider: "twitch", mediaId: "1234567890", params: { kind: "video" } });
    assert.deepEqual(ok("https://clips.twitch.tv/FunnySlug-abc123").params, { kind: "clip" });
    assert.deepEqual(ok("https://www.twitch.tv/somechannel/clip/FunnySlug-abc123").params, { kind: "clip" });
    assert.equal(ok("v123456789", "twitch").mediaId, "123456789");
  });
  test("live channels are refused, and the reason says why", () => {
    assert.equal(ok("https://www.twitch.tv/shroud"), null);
    assert.match(reg.explain("https://www.twitch.tv/shroud"), /Live Twitch streams can't be synchronised/);
  });
  test("rejects look-alikes and malformed ids", () => {
    for (const bad of ["https://twitch.tv.evil.io/videos/1234567", "https://www.twitch.tv/videos/12", "https://www.twitch.tv/videos/abc", "https://example.com/videos/1234567"]) assert.equal(ok(bad), null, bad);
  });
});

describe("Netflix (companion mode)", () => {
  test("only https netflix.com/watch/<id> pages, with optional locale prefix; query is dropped", () => {
    assert.deepEqual(ok("https://www.netflix.com/watch/80100172"), { provider: "netflix", mediaId: "80100172", params: {} });
    assert.equal(ok("https://www.netflix.com/in-hi/watch/80100172?trackId=14170286&tctx=1").mediaId, "80100172");
    assert.equal(reg.get("netflix").mode, "companion");
  });
  test("rejects /title/ pages, http, look-alikes, other paths and bare ids", () => {
    for (const bad of ["https://www.netflix.com/title/80100172", "http://www.netflix.com/watch/80100172", "https://netflix.com.evil.io/watch/80100172",
      "https://www.netflix.com/browse", "https://www.netflix.com/watch/abc", "https://www.netflix.com/watch/123", "80100172"]) assert.equal(ok(bad), null, bad);
    assert.equal(ok("80100172", "netflix"), null);
  });
});

describe("registry", () => {
  test("an explicit provider restricts parsing to that provider", () => {
    assert.equal(ok("https://vimeo.com/76979871", "youtube"), null);
    assert.equal(ok("https://vimeo.com/76979871", "nonexistent"), null);
    assert.equal(ok("https://vimeo.com/76979871", 42), null);
  });
  test("non-string inputs never throw", () => {
    for (const v of [undefined, null, 5, {}, [], true]) assert.equal(ok(v), null);
  });
});
