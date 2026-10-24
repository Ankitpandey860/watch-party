// The frontend parsers mirror the backend's (which are the authority). This runs ONE corpus through
// both and requires identical answers, so the two can never silently diverge.
import { describe, test, expect } from "vitest";
import frontend from "./index";
import { providerRegistry as backend } from "../../../backend/src/providers/registry.js";

const CORPUS = [
  ["https://youtu.be/dQw4w9WgXcQ"],
  ["dQw4w9WgXcQ"],
  ["https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=5"],
  ["https://www.youtube.com/shorts/dQw4w9WgXcQ"],
  ["https://youtube.com.evil.io/watch?v=dQw4w9WgXcQ"],
  ["https://vimeo.com/76979871"],
  ["https://vimeo.com/76979871/ABCDEF0123"],
  ["https://player.vimeo.com/video/76979871?h=0123456789"],
  ["https://vimeo.com/channels/staffpicks/76979871"],
  ["https://vimeo.com/76979871/zzzz"],
  ["https://vimeo.com/../etc/76979871"],
  ["https://notvimeo.com/76979871"],
  ["https://vimeo.com.evil.io/76979871"],
  ["https://vimeo.com/76979871?h=<script>"],
  ["76979871"],
  ["76979871", "vimeo"],
  ["76979871", "twitch"],
  ["76979871", "netflix"],
  ["v123456789", "twitch"],
  ["https://www.twitch.tv/videos/1234567890"],
  ["https://clips.twitch.tv/FunnySlug-abc123"],
  ["https://www.twitch.tv/somechannel/clip/FunnySlug-abc123"],
  ["https://www.twitch.tv/shroud"],
  ["https://twitch.tv.evil.io/videos/1234567"],
  ["https://www.twitch.tv/videos/12"],
  ["https://www.twitch.tv/videos/abc"],
  ["https://www.netflix.com/watch/80100172"],
  ["https://www.netflix.com/in-hi/watch/80100172?trackId=1"],
  ["https://www.netflix.com/title/80100172"],
  ["http://www.netflix.com/watch/80100172"],
  ["https://netflix.com.evil.io/watch/80100172"],
  ["https://www.netflix.com/browse"],
  ["https://www.netflix.com/watch/123"],
  ["javascript:alert(1)"],
  [""],
  ["   "],
  ["https://vimeo.com/76979871", "youtube"],
  ["x", "nonexistent"],
  [undefined],
  [null],
  [5],
  [{}],
];

describe("frontend parsers == backend parsers", () => {
  test.each(CORPUS)("%j (hint %j)", (input, hint) => {
    const f = frontend.resolve(input, hint);
    const b = backend.resolveMedia(input, hint);
    expect(f).toEqual(b);
  });
});
