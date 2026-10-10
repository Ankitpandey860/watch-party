// Playback synchronisation: authorisation, commands, validation, stale-report handling.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, sleep, createRoomWithHost, joinAsParticipant, joinAsUser } from "./_helpers/harness.js";

let server;
before(async () => (server = await startServer()));
after(async () => server.close());

const YT_ID = "dQw4w9WgXcQ";
const seqOf = (roomId) => server.roomManager.getRoom(roomId).currentVideo.seq;
const signal = (client, event) => { const s = client.mark(); client.socket.emit(event); return s; };

async function room() {
  const r = await createRoomWithHost(server, "Host");
  const viewer = await joinAsParticipant(server, r.roomId, "Viewer");
  return { ...r, viewer: viewer.client, viewerId: viewer.userId };
}

describe("authorisation", () => {
  test("a plain participant cannot play/pause/seek/change_video/time_sync, and nothing is broadcast", async () => {
    const { host, viewer, roomId } = await room();
    const before = seqOf(roomId);
    for (const [event, payload] of [["play"], ["pause"], ["seek", { time: 5 }], ["change_video", { url: YT_ID }], ["time_sync", { time: 5, seq: before }]]) {
      const hostSince = host.mark();
      const since = payload ? viewer.mark() : signal(viewer, event);
      if (payload) viewer.emit(event, payload);
      assert.equal((await viewer.waitFor("error_event", { since })).code, "NOT_AUTHORIZED", event);
      await host.expectNone("sync_state", { since: hostSince, ms: 60 });
    }
    assert.equal(seqOf(roomId), before);
  });

  test("a moderator (signed-in) CAN control playback", async () => {
    const { host, roomId } = await room();
    const mod = await joinAsUser(server, roomId, "Mod");
    await host.request("assign_role", { userId: mod.userId, role: "moderator" }, "role_assigned");
    const s = await mod.client.request("seek", { time: 42 }, "sync_state");
    assert.deepEqual([s.currentTime, s.reason], [42, "seek"]);
  });

  test("playback commands before join_room -> NOT_IN_ROOM", async () => {
    const owner = await server.actor().signIn("o");
    const { body } = await owner.rest("POST", "/rooms");
    const c = await owner.connect(body.roomId); // authenticated but has not joined
    const since = signal(c, "play");
    assert.equal((await c.waitFor("error_event", { since })).code, "NOT_IN_ROOM");
  });
});

describe("commands", () => {
  test("play/pause/seek broadcast sync_state (with a reason and provider) to everyone including the sender", async () => {
    const { host, viewer } = await room();
    const hs = signal(host, "play"), vs = viewer.mark();
    const [a, b] = await Promise.all([
      host.waitFor("sync_state", { since: hs, where: (e) => e.reason === "play" }),
      viewer.waitFor("sync_state", { since: vs, where: (e) => e.reason === "play" }),
    ]);
    assert.equal(a.playing && b.playing, true);
    assert.deepEqual(Object.keys(a).sort(), ["currentTime", "playing", "provider", "reason", "seq", "updatedAt", "videoId"]);
  });

  test("seq is strictly increasing across every update", async () => {
    const { host, roomId } = await room();
    const since = host.mark();
    host.socket.emit("play");
    host.emit("seek", { time: 10 });
    await sleep(900);
    host.emit("time_sync", { time: 11, seq: seqOf(roomId) });
    await host.waitFor("sync_state", { since, where: (e) => e.reason === "periodic" });
    host.socket.emit("pause");
    await host.waitFor("sync_state", { since, where: (e) => e.reason === "pause" });
    const seqs = host.events("sync_state", since).map((e) => e.seq);
    assert.equal(seqs.length, 4);
    for (let i = 1; i < seqs.length; i++) assert.equal(seqs[i], seqs[i - 1] + 1);
  });

  test("seek validation: negative / non-numeric / missing / absurdly large -> INVALID_PAYLOAD; 0 and numeric strings are fine", async () => {
    const { host } = await room();
    for (const payload of [{ time: -1 }, { time: "abc" }, {}, { time: 360_001 }, { time: 1e308 }, { time: [5] }, { time: {} }, { time: true }, { time: "" }]) {
      assert.equal((await host.request("seek", payload, "error_event")).code, "INVALID_PAYLOAD", JSON.stringify(payload));
    }
    assert.equal((await host.request("seek", { time: 0 }, "sync_state")).currentTime, 0);
    assert.equal((await host.request("seek", { time: "12.5" }, "sync_state")).currentTime, 12.5);
    assert.equal((await host.request("seek", { time: 360_000 }, "sync_state")).currentTime, 360_000);
  });

  test("change_video accepts a YouTube URL or 11-char id and resets to paused @ 0", async () => {
    const { host } = await room();
    await host.request("seek", { time: 99 }, "sync_state");
    const byUrl = await host.request("change_video", { url: `https://www.youtube.com/watch?v=${YT_ID}` }, "sync_state");
    assert.deepEqual([byUrl.provider, byUrl.videoId, byUrl.playing, byUrl.currentTime, byUrl.reason], ["youtube", YT_ID, false, 0, "change_video"]);
    assert.equal((await host.request("change_video", { videoId: "aaaaaaaaaaa" }, "sync_state")).videoId, "aaaaaaaaaaa");
    assert.equal((await host.request("change_video", { url: "https://youtu.be/bbbbbbbbbbb?t=3" }, "sync_state")).videoId, "bbbbbbbbbbb");
    assert.equal((await host.request("change_video", { url: "https://www.youtube.com/shorts/ccccccccccc" }, "sync_state")).videoId, "ccccccccccc");
  });

  test("FIXED: change_video rejects non-YouTube hosts, lookalike domains, malformed ids and oversized input", async () => {
    const { host } = await room();
    const bad = [
      "https://vimeo.com/12345", "hello", "", "https://notyoutube.com/watch?v=abcdefghijk",
      "https://youtube.com.evil.io/watch?v=abcdefghijk", "https://evil.io/?u=https://youtube.com/watch?v=abcdefghijk",
      "https://www.youtube.com/watch?v=this-is-definitely-not-an-eleven-char-id", "https://www.youtube.com/watch?v=short",
      "https://www.youtube.com/watch?v=<script>alert(1)</script>", "javascript:alert(1)", "ftp://youtube.com/watch?v=abcdefghijk",
      `https://www.youtube.com/watch?v=abcdefghijk&x=${"a".repeat(3000)}`, "abcdefghijkl", "abcdefghij",
    ];
    for (const url of bad) assert.equal((await host.request("change_video", { url }, "error_event")).code, "INVALID_PAYLOAD", url.slice(0, 60));
    for (const payload of [{}, { url: 42 }, { videoId: {} }, { url: ["a"] }]) {
      assert.equal((await host.request("change_video", payload, "error_event")).code, "INVALID_PAYLOAD", JSON.stringify(payload));
    }
  });
});

describe("position accuracy", () => {
  test("FIXED: pause freezes the REAL position (it used to snap back to the last reported time)", async () => {
    const { host } = await room();
    await host.request("seek", { time: 10 }, "sync_state");
    host.socket.emit("play");
    await sleep(800);
    const s = host.mark(); host.socket.emit("pause");
    const paused = await host.waitFor("sync_state", { since: s, where: (e) => e.reason === "pause" });
    assert.ok(paused.currentTime >= 10.7 && paused.currentTime < 11.6, `expected ~10.8, got ${paused.currentTime}`);
  });

  test("seeking while playing keeps playing from the new position", async () => {
    const { host } = await room();
    host.socket.emit("play");
    const s = await host.request("seek", { time: 100 }, "sync_state", { where: (e) => e.reason === "seek" });
    assert.equal(s.playing, true);
    assert.equal(s.currentTime, 100);
  });

  test("while playing, a late joiner's room_state has the position projected to now; while paused it is unchanged", async () => {
    const { host, roomId } = await room();
    await host.request("seek", { time: 10 }, "sync_state");
    const paused = await joinAsParticipant(server, roomId, "LateA");
    assert.equal(paused.state.currentVideo.currentTime, 10);
    host.socket.emit("play");
    await sleep(600);
    const late = await joinAsParticipant(server, roomId, "LateB");
    assert.ok(late.state.currentVideo.currentTime >= 10.4 && late.state.currentVideo.currentTime < 12);
  });
});

describe("periodic time_sync (controller position reports)", () => {
  test("a valid report bumps seq, keeps `playing`, and broadcasts reason 'periodic'", async () => {
    const { host, roomId } = await room();
    host.socket.emit("play");
    await host.waitFor("sync_state", { where: (e) => e.reason === "play" });
    const s = await host.request("time_sync", { time: 33, seq: seqOf(roomId) }, "sync_state", { where: (e) => e.reason === "periodic" });
    assert.deepEqual([s.currentTime, s.playing], [33, true]);
  });

  test("FIXED: a STALE report (older seq than a newer command) is dropped instead of overwriting the newer position", async () => {
    const { host, roomId } = await room();
    const mod = await joinAsUser(server, roomId, "Mod");
    await host.request("assign_role", { userId: mod.userId, role: "moderator" }, "role_assigned");
    const staleSeq = seqOf(roomId);
    await mod.client.request("seek", { time: 500 }, "sync_state"); // newer command lands first
    const since = host.mark();
    host.emit("time_sync", { time: 20, seq: staleSeq }); // host's report was computed before the seek
    await host.expectNone("sync_state", { since, ms: 150 });
    assert.equal(server.roomManager.getRoom(roomId).currentVideo.currentTime, 500);
  });

  test("reports without a seq, with a wrong seq, or with malformed time are silently ignored", async () => {
    const { host, roomId } = await room();
    const since = host.mark();
    const seq = seqOf(roomId);
    for (const p of [{ time: 5 }, { time: 5, seq: seq + 7 }, { time: "nope", seq }, { time: -5, seq }, { seq }, { time: 1e9, seq }]) host.emit("time_sync", p);
    await host.expectNone("sync_state", { since, ms: 200 });
    await host.expectNone("error_event", { since, ms: 10 });
    assert.equal(seqOf(roomId), seq);
  });

  test("reports arriving faster than ~1/second are dropped server-side (broadcast amplification guard)", async () => {
    const { host, roomId } = await room();
    const since = host.mark();
    host.emit("time_sync", { time: 1, seq: seqOf(roomId) });
    await host.waitFor("sync_state", { since });
    host.emit("time_sync", { time: 2, seq: seqOf(roomId) }); // right away: too soon
    await host.expectNone("sync_state", { since: host.mark(), ms: 200 });
    await sleep(700);
    host.emit("time_sync", { time: 3, seq: seqOf(roomId) });
    assert.equal((await host.waitFor("sync_state", { since: host.mark() - 0, where: (e) => e.currentTime === 3 })).currentTime, 3);
  });
});
