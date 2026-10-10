import { describe, test, expect } from "vitest";
import { extractYouTubeId, formatTime } from "./youtube";

describe("extractYouTubeId", () => {
  test.each([
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://youtube.com/watch?v=dQw4w9WgXcQ&t=42s&list=PL1", "dQw4w9WgXcQ"],
    ["https://m.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://music.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://youtu.be/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://youtu.be/dQw4w9WgXcQ?si=abc", "dQw4w9WgXcQ"],
    ["https://www.youtube.com/embed/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://www.youtube.com/shorts/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://www.youtube.com/live/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["  https://youtu.be/dQw4w9WgXcQ  ", "dQw4w9WgXcQ"],
    ["dQw4w9WgXcQ", "dQw4w9WgXcQ"], // a bare 11-character id is accepted (the server accepts it too)
  ])("extracts the id from %s", (input, id) => {
    expect(extractYouTubeId(input)).toBe(id);
  });

  test.each([
    [""],
    [null],
    [undefined],
    [42],
    [{}],
    ["not a url"],
    ["abcdefghij"],
    ["abcdefghijkl"],
    ["https://vimeo.com/12345"],
    ["https://www.youtube.com/"],
    ["https://www.youtube.com/watch?v="],
    ["https://www.youtu.be/dQw4w9WgXcQ"],
    ["https://youtu.be/"],
    ["javascript:alert(1)"],
    ["ftp://youtube.com/watch?v=dQw4w9WgXcQ"],
  ])("returns null for %s", (input) => {
    expect(extractYouTubeId(input)).toBeNull();
  });

  test("FIXED: lookalike hosts and malformed ids are rejected (previously accepted)", () => {
    expect(extractYouTubeId("https://notyoutube.com/watch?v=dQw4w9WgXcQ")).toBeNull();
    expect(extractYouTubeId("https://youtube.com.evil.io/watch?v=dQw4w9WgXcQ")).toBeNull();
    expect(
      extractYouTubeId("https://evil.io/?u=https://youtube.com/watch?v=dQw4w9WgXcQ"),
    ).toBeNull();
    expect(extractYouTubeId("https://www.youtube.com/watch?v=<anything goes>")).toBeNull();
    expect(extractYouTubeId("https://www.youtube.com/watch?v=short")).toBeNull();
    expect(
      extractYouTubeId(`https://www.youtube.com/watch?v=dQw4w9WgXcQ&x=${"a".repeat(3000)}`),
    ).toBeNull();
  });
});

describe("formatTime", () => {
  test.each([
    [0, "0:00"],
    [5, "0:05"],
    [65, "1:05"],
    [600, "10:00"],
    [3600, "1:00:00"],
    [3725, "1:02:05"],
    [59.9, "0:59"],
  ])("formats %s as %s", (seconds, text) => expect(formatTime(seconds)).toBe(text));
  test.each([[NaN], [-1], [Infinity], [undefined]])("falls back to 0:00 for %s", (v) =>
    expect(formatTime(v)).toBe("0:00"),
  );
});
