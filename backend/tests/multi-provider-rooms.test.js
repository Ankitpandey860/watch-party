// Room-level behaviour for multiple providers: change_video, stale-command protection, rate,
// moderator cap and the host's moderator-control switch. Real server, real sockets.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, createRoomWithHost, joinAsParticipant, joinAsUser, sleep } from "./_helpers/harness.js";

let server;
before(async () => (server = await startServer()));
after(async () => server.close());
const roomOf = (id) => server.roomManager.getRoom(id);

async function room() {
  const r = await createRoomWithHost(server, "Host");
  const viewer = await joinAsParticipant(server, r.roomId, "Viewer");
  return { ...r, viewer: viewer.client, viewerId: viewer.userId };
}

describe("change_video across providers", () => {
  test("vimeo (with unlisted hash), twitch vod/clip and netflix are stored as canonical media state", async () => {
    const { host, viewer } = await room();
    let s = await host.request("change_video", { url: "https://vimeo.com/76979871/abcdef0123" }, "sync_state");
    assert.deepEqual([s.provider, s.videoId, s.mediaParams, s.playing, s.rate], ["vimeo", "76979871", { hash: "abcdef0123" }, false, 1]);
    s = await host.request("change_video", { url: "https://www.twitch.tv/videos/1234567890" }, "sync_state");
    assert.deepEqual([s.provider, s.videoId, s.mediaParams], ["twitch", "1234567890", { kind: "video" }]);
    s = await host.request("change_video", { url: "https://clips.twitch.tv/FunnySlug-abc123" }, "sync_state");
    assert.deepEqual(s.mediaParams, { kind: "clip" });
    const since = viewer.mark();
    s = await host.request("change_video", { url: "https://www.netflix.com/watch/80100172" }, "sync_state");
    assert.deepEqual([s.provider, s.videoId], ["netflix", "80100172"]);
    const seen = await viewer.waitFor("sync_state", { since, where: (e) => e.reason === "change_video" });
    assert.equal(seen.videoId, "80100172", "everyone gets the canonical media reference");
  });

  test("explicit provider makes a bare id unambiguous; a mismatching provider is refused", async () => {
    const { host } = await room();
    const s = await host.request("change_video", { videoId: "76979871", provider: "vimeo" }, "sync_state");
    assert.equal(s.provider, "vimeo");
    assert.equal((await host.request("change_video", { videoId: "76979871", provider: "youtube" }, "error_event")).code, "INVALID_PAYLOAD");
    assert.equal((await host.request("change_video", { url: "dQw4w9WgXcQ", provider: "nope" }, "error_event")).code, "UNSUPPORTED_MEDIA");
    assert.equal((await host.request("change_video", { url: "dQw4w9WgXcQ", provider: 5 }, "error_event")).code, "INVALID_PAYLOAD");
  });

  test("a Twitch live channel is rejected with an explanatory message and the room is unchanged", async () => {
    const { host, roomId } = await room();
    const before = roomOf(roomId).currentVideo.seq;
    const e = await host.request("change_video", { url: "https://www.twitch.tv/shroud" }, "error_event");
    assert.equal(e.code, "INVALID_PAYLOAD");
    assert.match(e.message, /Live Twitch streams/);
    assert.equal(roomOf(roomId).currentVideo.seq, before);
  });

  test("changing the video resets position, rate and everyone's reported player status", async () => {
    const { host, viewer, roomId } = await room();
    await host.request("change_video", { url: "https://vimeo.com/76979871" }, "sync_state");
    await host.request("seek", { time: 99 }, "sync_state");
    await host.request("set_rate", { rate: 1.5 }, "sync_state");
    await viewer.request("player_status", { status: "ready", ref: { provider: "vimeo", mediaId: "76979871" } }, "participants_updated");
    const s = await host.request("change_video", { url: "https://www.twitch.tv/videos/1234567890" }, "sync_state");
    assert.deepEqual([s.currentTime, s.rate, s.playing], [0, 1, false]);
    assert.ok(roomOf(roomId).listParticipants().every((p) => p.playerStatus === null));
  });
});

describe("stale / mismatching commands (ref)", () => {
  test("a seek that was meant for the PREVIOUS video is refused after change_video", async () => {
    const { host, roomId } = await room();
    await host.request("change_video", { url: "dQw4w9WgXcQ" }, "sync_state");
    await host.request("change_video", { url: "https://vimeo.com/76979871" }, "sync_state");
    const seq = roomOf(roomId).currentVideo.seq;
    const e = await host.request("seek", { time: 500, ref: { provider: "youtube", mediaId: "dQw4w9WgXcQ" } }, "error_event");
    assert.equal(e.code, "MEDIA_MISMATCH");
    assert.equal(roomOf(roomId).currentVideo.seq, seq);
    const s = await host.request("seek", { time: 5, ref: { provider: "vimeo", mediaId: "76979871" } }, "sync_state");
    assert.equal(s.currentTime, 5);
  });
  test("play/pause/set_rate also check ref; malformed refs are refused; no ref still works (legacy clients)", async () => {
    const { host } = await room();
    await host.request("change_video", { url: "dQw4w9WgXcQ" }, "sync_state");
    for (const event of ["play", "pause"]) {
      assert.equal((await host.request(event, { ref: { provider: "vimeo", mediaId: "1" } }, "error_event")).code, "MEDIA_MISMATCH", event);
    }
    assert.equal((await host.request("set_rate", { rate: 1.25, ref: "x" }, "error_event")).code, "MEDIA_MISMATCH");
    assert.equal((await host.request("play", { ref: { provider: "youtube", mediaId: "dQw4w9WgXcQ" } }, "sync_state")).playing, true);
    assert.equal((await host.request("pause", {}, "sync_state")).playing, false);
  });
  test("a stale periodic time_sync for another title is silently dropped", async () => {
    const { host, roomId } = await room();
    await host.request("change_video", { url: "dQw4w9WgXcQ" }, "sync_state");
    const seq = roomOf(roomId).currentVideo.seq;
    host.emit("time_sync", { time: 77, seq, ref: { provider: "vimeo", mediaId: "1" } });
    await sleep(120);
    assert.equal(roomOf(roomId).currentVideo.currentTime, 0);
  });
});

describe("playback rate validation", () => {
  test("accepts 0.25..2, rejects everything else; needs a loaded video and controller rights", async () => {
    const { host, viewer } = await room();
    assert.equal((await host.request("set_rate", { rate: 1.5 }, "error_event")).code, "INVALID_PAYLOAD", "no video loaded yet");
    await host.request("change_video", { url: "dQw4w9WgXcQ" }, "sync_state");
    assert.equal((await host.request("set_rate", { rate: 1.5 }, "sync_state")).rate, 1.5);
    for (const rate of [0, 0.1, 2.01, 100, -1, NaN, Infinity, "1.5", null, {}, [], undefined]) {
      assert.equal((await host.request("set_rate", { rate }, "error_event")).code, "INVALID_PAYLOAD", String(rate));
    }
    assert.equal((await viewer.request("set_rate", { rate: 2 }, "error_event")).code, "NOT_AUTHORIZED");
  });
});

describe("moderator cap and the moderator-control switch", () => {
  async function withMods(n) {
    const r = await room();
    const mods = [];
    for (let i = 0; i < n; i++) {
      const m = await joinAsUser(server, r.roomId, `Mod${i}`);
      await r.host.request("assign_role", { userId: m.userId, role: "moderator" }, "role_assigned");
      mods.push(m);
    }
    return { ...r, mods };
  }
  test("default cap is 3 (host excluded): the 4th promotion is refused, demoting frees a slot", async () => {
    const r = await withMods(3);
    const fourth = await joinAsUser(server, r.roomId, "Mod4");
    assert.equal((await r.host.request("assign_role", { userId: fourth.userId, role: "moderator" }, "error_event")).code, "MODERATOR_LIMIT");
    assert.equal(roomOf(r.roomId).getParticipant(fourth.userId).role, "participant");
    await r.host.request("assign_role", { userId: r.mods[0].userId, role: "participant" }, "role_assigned");
    assert.equal((await r.host.request("assign_role", { userId: fourth.userId, role: "moderator" }, "role_assigned")).role, "moderator");
  });
  test("re-assigning an existing moderator at the cap is allowed (idempotent)", async () => {
    const r = await withMods(3);
    assert.equal((await r.host.request("assign_role", { userId: r.mods[1].userId, role: "moderator" }, "role_assigned")).role, "moderator");
  });
  test("only the host can change settings; moderators and participants get NOT_AUTHORIZED", async () => {
    const r = await withMods(1);
    for (const c of [r.mods[0].client, r.viewer]) {
      assert.equal((await c.request("update_room_settings", { maxModerators: 5 }, "error_event")).code, "NOT_AUTHORIZED");
    }
    assert.equal(roomOf(r.roomId).settings.maxModerators, 3);
  });
  test("host can lower/raise the cap; lowering below the current count is refused; bad values rejected", async () => {
    const r = await withMods(2);
    assert.equal((await r.host.request("update_room_settings", { maxModerators: 1 }, "error_event")).code, "MODERATOR_LIMIT");
    const s = await r.host.request("update_room_settings", { maxModerators: 2 }, "room_settings");
    assert.equal(s.settings.maxModerators, 2);
    const extra = await joinAsUser(server, r.roomId, "Extra");
    assert.equal((await r.host.request("assign_role", { userId: extra.userId, role: "moderator" }, "error_event")).code, "MODERATOR_LIMIT");
    for (const bad of [{ maxModerators: -1 }, { maxModerators: 11 }, { maxModerators: 1.5 }, { maxModerators: "3" }]) {
      assert.equal((await r.host.request("update_room_settings", bad, "error_event")).code, "INVALID_PAYLOAD", JSON.stringify(bad));
    }
    const r2 = await room(); // fresh socket: the admin bucket is deliberately small, so don't exhaust it
    for (const bad of [{ moderatorsCanControl: "yes" }, { moderatorsCanControl: 1 }]) {
      assert.equal((await r2.host.request("update_room_settings", bad, "error_event")).code, "INVALID_PAYLOAD", JSON.stringify(bad));
    }
  });
  test("cap 0 means no moderators at all", async () => {
    const r = await room();
    await r.host.request("update_room_settings", { maxModerators: 0 }, "room_settings");
    const u = await joinAsUser(server, r.roomId, "U");
    assert.equal((await r.host.request("assign_role", { userId: u.userId, role: "moderator" }, "error_event")).code, "MODERATOR_LIMIT");
  });
  test("moderatorsCanControl=false: moderators lose playback control, the host keeps it, re-enabling restores it", async () => {
    const r = await withMods(1);
    const mod = r.mods[0].client;
    await r.host.request("change_video", { url: "dQw4w9WgXcQ" }, "sync_state");
    assert.equal((await mod.request("seek", { time: 10 }, "sync_state")).currentTime, 10);
    const s = await r.host.request("update_room_settings", { moderatorsCanControl: false }, "room_settings");
    assert.equal(s.settings.moderatorsCanControl, false);
    for (const [ev, payload] of [["play", {}], ["pause", {}], ["seek", { time: 3 }], ["change_video", { url: "dQw4w9WgXcQ" }], ["set_rate", { rate: 2 }]]) {
      assert.equal((await mod.request(ev, payload, "error_event")).code, "NOT_AUTHORIZED", ev);
    }
    assert.equal((await r.host.request("seek", { time: 20 }, "sync_state")).currentTime, 20);
    await r.host.request("update_room_settings", { moderatorsCanControl: true }, "room_settings");
    assert.equal((await mod.request("seek", { time: 30 }, "sync_state")).currentTime, 30);
  });
  test("settings are part of room_state for late joiners and reconnects", async () => {
    const r = await room();
    await r.host.request("update_room_settings", { moderatorsCanControl: false, maxModerators: 1 }, "room_settings");
    const late = await joinAsParticipant(server, r.roomId, "Late");
    assert.deepEqual(late.state.settings, { maxModerators: 1, moderatorsCanControl: false });
  });
  test("guests can never become moderators even when slots are free", async () => {
    const r = await room();
    assert.equal((await r.host.request("assign_role", { userId: r.viewerId, role: "moderator" }, "error_event")).code, "NOT_AUTHORIZED");
  });
});

describe("participant-reported player status", () => {
  test("server derives wrong_title from the reported ref; unknown statuses are rejected; no privileges change", async () => {
    const { host, viewer, viewerId, roomId } = await room();
    await host.request("change_video", { url: "https://www.netflix.com/watch/80100172" }, "sync_state");
    let u = await viewer.request("player_status", { status: "ready", ref: { provider: "netflix", mediaId: "80100172" } }, "participants_updated");
    assert.equal(u.participants.find((p) => p.id === viewerId).playerStatus, "ready");
    u = await viewer.request("player_status", { status: "ready", ref: { provider: "netflix", mediaId: "99999999" } }, "participants_updated");
    assert.equal(u.participants.find((p) => p.id === viewerId).playerStatus, "wrong_title");
    assert.equal((await viewer.request("player_status", { status: "admin" }, "error_event")).code, "INVALID_PAYLOAD");
    assert.equal(roomOf(roomId).getParticipant(viewerId).role, "participant");
  });
});
