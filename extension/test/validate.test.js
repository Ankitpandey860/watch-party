import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parseReport, parseSyncState, parseTarget, parseServerOrigin } from "../src/lib/validate.js";
import { netflixTitleId, classifyNetflixPage } from "../src/lib/netflixUrl.js";
import { createDiagnostics, redact } from "../src/lib/diagnostics.js";
import { pickTargetTab } from "../src/lib/tabPicker.js";

const rep = (o = {}) => ({ kind: "report", titleId: "80100172", adapter: "netflix-cadmium", status: "ok", state: { playing: true, position: 5, duration: 100, rate: 1 }, caps: { play: true, pause: true, seek: true, rate: false }, ...o });

describe("netflixUrl", () => {
  test("accepts real watch URLs, with locale prefixes, ignoring query/hash", () => {
    for (const u of ["https://www.netflix.com/watch/80100172", "https://www.netflix.com/in-hi/watch/80100172?trackId=1#x", "https://netflix.com/gb/watch/80100172/", "https://www.netflix.com/in/watch/80100172"]) assert.equal(netflixTitleId(u), "80100172", u);
  });
  test("rejects everything else", () => {
    for (const u of ["https://www.netflix.com/title/80100172", "http://www.netflix.com/watch/80100172", "https://netflix.com.evil.io/watch/80100172", "https://www.netflix.com/browse", "https://www.netflix.com/watch/abc", "https://www.netflix.com/watch/123", "https://www.netflix.com/watch/80100172/../x", "javascript:alert(1)", "", "nope", null, undefined]) assert.equal(netflixTitleId(u), null, String(u));
  });
  test("page classification drives the 'why can't I sync' message", () => {
    assert.equal(classifyNetflixPage("https://www.netflix.com/watch/80100172"), "watch");
    assert.equal(classifyNetflixPage("https://www.netflix.com/title/80100172"), "title-page");
    assert.equal(classifyNetflixPage("https://www.netflix.com/browse"), "browse");
    assert.equal(classifyNetflixPage("https://example.com/"), "not-netflix");
  });
});

describe("parseReport (content -> service worker)", () => {
  test("valid report is normalised; unknown fields are dropped", () => {
    const r = parseReport({ ...rep(), evil: "x", cookie: "NetflixId=abc" });
    assert.equal(r.titleId, "80100172");
    assert.ok(!("evil" in r) && !("cookie" in r));
  });
  test("rejects malformed titles, statuses, positions and actions", () => {
    for (const bad of [rep({ titleId: "abc" }), rep({ status: "weird" }), rep({ state: { playing: "yes", position: 1 } }), rep({ state: { playing: true, position: -1 } }),
      rep({ state: { playing: true, position: 1e9 } }), rep({ userAction: "nuke" }), rep({ adapter: 5 }), { kind: "other" }, null, "x", 5]) assert.equal(parseReport(bad), null);
  });
  test("a non-watch page report (titleId null) is allowed", () => assert.equal(parseReport(rep({ titleId: null, state: null, status: "no-player" })).titleId, null));
});

describe("parseSyncState / parseTarget", () => {
  test("sync_state is normalised to the canonical shape", () => {
    assert.deepEqual(parseSyncState({ provider: "netflix", videoId: "80100172", playing: true, currentTime: 12, rate: 1, seq: 4, mediaParams: null }), { provider: "netflix", mediaId: "80100172", playing: true, time: 12, rate: 1, seq: 4 });
    for (const bad of [null, {}, { provider: "netflix", videoId: 5, playing: true, currentTime: 1, seq: 1 }, { provider: "netflix", videoId: "1", playing: "y", currentTime: 1, seq: 1 }, { provider: "netflix", videoId: "1", playing: true, currentTime: NaN, seq: 1 }]) assert.equal(parseSyncState(bad), null);
  });
  test("targets are validated before the content script acts", () => {
    const ok = parseTarget({ kind: "target", canControl: false, target: { mediaId: "80100172", playing: true, time: 5, rate: 1, seq: 2 } });
    assert.equal(ok.target.seq, 2);
    for (const bad of [{ kind: "target", target: { mediaId: "x", playing: true, time: 1, seq: 1 } }, { kind: "target", target: { mediaId: "80100172", playing: true, time: -5, seq: 1 } },
      { kind: "target", target: { mediaId: "80100172", playing: true, time: 1e9, seq: 1 } }, { kind: "nope" }, null]) assert.equal(parseTarget(bad), null);
    assert.equal(parseTarget({ kind: "target", target: { mediaId: "80100172", playing: true, time: 1, seq: 1, rate: 99 } }).target.rate, 1, "absurd rate falls back to 1");
    assert.equal(parseTarget({ kind: "target", target: null, note: "hi" }).target, null);
  });
});

describe("parseServerOrigin", () => {
  test("https anywhere, http only for loopback; credentials and junk rejected; path dropped", () => {
    assert.equal(parseServerOrigin("https://watch.example.com/some/path"), "https://watch.example.com");
    assert.equal(parseServerOrigin("http://localhost:4000"), "http://localhost:4000");
    assert.equal(parseServerOrigin("http://127.0.0.1:4000/"), "http://127.0.0.1:4000");
    for (const bad of ["http://watch.example.com", "ftp://x.com", "https://user:pw@x.com", "javascript:1", "", "not a url", null]) assert.equal(parseServerOrigin(bad), null, String(bad));
  });
});

describe("diagnostics redaction", () => {
  test("tokens, tickets, cookies and bearer headers never survive", () => {
    const text = JSON.stringify(redact({ a: "wpx_AbC123_-xyz", b: "https://x/y?ticket=SECRET&ok=1", c: "Bearer abc.def.ghi", d: "NetflixId=v%3D3; other", token: "t", nested: { cookie: "c", authorization: "a", fine: "ok" } }));
    for (const secret of ["AbC123", "SECRET", "abc.def.ghi", "v%3D3"]) assert.ok(!text.includes(secret), secret);
    assert.ok(text.includes("fine") && text.includes("ok"));
  });
  test("ring buffer is bounded", () => {
    const d = createDiagnostics({ max: 5 });
    for (let i = 0; i < 20; i++) d.log("e", { i });
    assert.equal(d.size, 5);
    assert.equal(d.dump()[0].data.i, 15);
  });
});

describe("pickTargetTab (multiple Netflix tabs)", () => {
  const T = 100_000;
  const tab = (tabId, o = {}) => ({ tabId, titleId: "80100172", status: "ok", lastSeen: T, active: false, playing: false, ...o });
  test("only a tab on the room's title qualifies", () => {
    assert.equal(pickTargetTab([tab(1, { titleId: "80100999" })], "80100172", T), null);
    assert.equal(pickTargetTab([tab(1, { titleId: "80100999" }), tab(2)], "80100172", T).tabId, 2);
  });
  test("prefers the active tab, then a playing one, then the freshest, then lowest id (deterministic)", () => {
    assert.equal(pickTargetTab([tab(1, { playing: true }), tab(2, { active: true })], "80100172", T).tabId, 2);
    assert.equal(pickTargetTab([tab(1), tab(2, { playing: true })], "80100172", T).tabId, 2);
    assert.equal(pickTargetTab([tab(1, { lastSeen: T - 1000 }), tab(2)], "80100172", T).tabId, 2);
    assert.equal(pickTargetTab([tab(3), tab(2)], "80100172", T).tabId, 2);
  });
  test("stale reports and 'no-player' tabs are ignored; no media => no target", () => {
    assert.equal(pickTargetTab([tab(1, { lastSeen: T - 60_000 })], "80100172", T), null);
    assert.equal(pickTargetTab([tab(1, { status: "no-player" })], "80100172", T), null);
    assert.equal(pickTargetTab([tab(1)], null, T), null);
  });
});
