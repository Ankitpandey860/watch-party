// Tests for context/RoomContext.jsx (real provider; network services mocked).
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  handlers: new Map(),
  socket: {
    connect: vi.fn(),
    disconnect: vi.fn(),
    emit: vi.fn(),
    on: vi.fn(),
    reconnect: vi.fn(),
    lastTicketFailure: null,
  },
}));

vi.mock("../services/socketService", () => ({
  socketService: mocks.socket,
  default: mocks.socket,
}));
vi.mock("../services/roomService", () => ({
  roomService: { createRoom: vi.fn() },
  default: { createRoom: vi.fn() },
}));

import { RoomProvider, useRoom } from "./RoomContext";

const EXPECTED_EVENTS = [
  "disconnect",
  "connect_error",
  "auth_expired",
  "room_state",
  "participants_updated",
  "user_joined",
  "user_left",
  "participant_removed",
  "role_assigned",
  "host_changed",
  "removed_from_room",
  "sync_state",
  "new_message",
  "error_event",
];
const P = (id, role = "participant", extra = {}) => ({
  id,
  username: id,
  role,
  kind: "user",
  online: true,
  ...extra,
});
const ME = { id: "me", displayName: "Me" };

beforeEach(() => {
  mocks.handlers.clear();
  mocks.socket.lastTicketFailure = null;
  mocks.socket.connect.mockClear();
  mocks.socket.emit.mockClear();
  mocks.socket.disconnect.mockClear();
  mocks.socket.reconnect.mockClear();
  mocks.socket.on.mockImplementation((event, handler) => {
    mocks.handlers.set(event, handler);
    return () => mocks.handlers.delete(event);
  });
});

function setup() {
  const hook = renderHook(() => useRoom(), { wrapper: RoomProvider });
  act(() => hook.result.current.connectSocket("ABC234", ME));
  const fire = (event, payload) => act(() => mocks.handlers.get(event)(payload));
  const join = (over = {}) =>
    fire("room_state", {
      participants: [P("me", "participant"), P("host", "host")],
      messages: [],
      hostId: "host",
      currentVideo: { provider: null, videoId: null, playing: false, currentTime: 0, seq: 0 },
      you: P("me"),
      ...over,
    });
  return { ...hook, fire, join };
}

describe("connecting", () => {
  test("opens the socket for the room, shows 'connecting', and binds exactly the expected listeners", () => {
    const { result } = setup();
    expect(mocks.socket.connect).toHaveBeenCalledWith("ABC234");
    expect(result.current.connectionStatus).toBe("connecting");
    expect(result.current).toMatchObject({ roomId: "ABC234", userId: "me", username: "Me" });
    expect([...mocks.handlers.keys()].sort()).toEqual([...EXPECTED_EVENTS].sort());
  });

  test("re-connecting the same context releases the previous listeners first (no stacking)", () => {
    const offs = [];
    mocks.socket.on.mockImplementation((event, handler) => {
      mocks.handlers.set(event, handler);
      const off = vi.fn();
      offs.push(off);
      return off;
    });
    const hook = renderHook(() => useRoom(), { wrapper: RoomProvider });
    act(() => hook.result.current.connectSocket("ABC234", ME));
    expect(offs).toHaveLength(EXPECTED_EVENTS.length);
    act(() => hook.result.current.connectSocket("ABC234", ME));
    expect(offs.slice(0, EXPECTED_EVENTS.length).every((off) => off.mock.calls.length === 1)).toBe(
      true,
    );
    expect(offs).toHaveLength(EXPECTED_EVENTS.length * 2);
  });

  test("nothing identity-related is written to web storage (the session is an HttpOnly cookie)", () => {
    const { join } = setup();
    join();
    expect(Object.keys(localStorage)).toEqual([]);
    expect(Object.keys(sessionStorage)).toEqual([]);
  });
});

describe("room_state (server is the authority)", () => {
  test("applies roster, chat, host, video, playback and marks connected", () => {
    const { result, join } = setup();
    const before = result.current.syncSeq;
    join({
      messages: [{ id: "m1", message: "hi" }],
      currentVideo: {
        provider: "youtube",
        videoId: "dQw4w9WgXcQ",
        playing: true,
        currentTime: 42,
        seq: 7,
      },
      you: P("me", "moderator"),
    });
    expect(result.current.connectionStatus).toBe("connected");
    expect(result.current.participants).toHaveLength(2);
    expect(result.current.messages).toEqual([{ id: "m1", message: "hi" }]);
    expect(result.current.hostId).toBe("host");
    expect(result.current.provider).toBe("youtube");
    expect(result.current.videoUrl).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(result.current.playback).toMatchObject({ playing: true, currentTime: 42 });
    expect(result.current.role).toBe("moderator");
    expect(result.current.syncSeq).toBe(before + 1);
  });

  test("identity and role come from the server's `you`, overriding whatever the page assumed", () => {
    const { result, join } = setup();
    join({ you: P("server-id", "host", { username: "Server Name" }) });
    expect(result.current).toMatchObject({
      userId: "server-id",
      username: "Server Name",
      role: "host",
    });
  });

  test("an empty room has no video", () => {
    const { result, join } = setup();
    join();
    expect(result.current.videoUrl).toBe("");
    expect(result.current.provider).toBeNull();
  });
});

describe("sync_state", () => {
  const sync = (over) => ({
    provider: "youtube",
    videoId: "aaaaaaaaaaa",
    playing: true,
    currentTime: 10,
    seq: 1,
    reason: "play",
    ...over,
  });

  test("a command applies playback + video and bumps syncSeq (not driftSeq)", () => {
    const { result, join, fire } = setup();
    join();
    const { syncSeq, driftSeq } = result.current;
    fire("sync_state", sync());
    expect(result.current.playback).toMatchObject({ playing: true, currentTime: 10 });
    expect(result.current.videoUrl).toContain("aaaaaaaaaaa");
    expect(result.current.syncSeq).toBe(syncSeq + 1);
    expect(result.current.driftSeq).toBe(driftSeq);
  });

  test("'periodic' only bumps driftSeq", () => {
    const { result, join, fire } = setup();
    join();
    const { syncSeq, driftSeq } = result.current;
    fire("sync_state", sync({ reason: "periodic", currentTime: 99 }));
    expect(result.current.playback.currentTime).toBe(99);
    expect([result.current.syncSeq, result.current.driftSeq]).toEqual([syncSeq, driftSeq + 1]);
  });

  test("stale or duplicate seq is dropped; newer wins; room_state seeds the baseline", () => {
    const { result, join, fire } = setup();
    join({
      currentVideo: {
        provider: "youtube",
        videoId: "aaaaaaaaaaa",
        playing: false,
        currentTime: 5,
        seq: 10,
      },
    });
    fire("sync_state", sync({ seq: 9, currentTime: 999 }));
    expect(result.current.playback.currentTime).toBe(5);
    fire("sync_state", sync({ seq: 11, currentTime: 50 }));
    fire("sync_state", sync({ seq: 11, currentTime: 51 }));
    fire("sync_state", sync({ seq: 10, currentTime: 40 }));
    expect(result.current.playback.currentTime).toBe(50);
  });

  test("an event without a numeric seq is always applied", () => {
    const { result, join, fire } = setup();
    join();
    fire("sync_state", sync({ seq: 5, currentTime: 50 }));
    fire("sync_state", sync({ seq: undefined, currentTime: 77 }));
    expect(result.current.playback.currentTime).toBe(77);
  });
});

describe("reconnecting", () => {
  test("a dropped connection shows 'reconnecting'; an intentional close does not; room_state restores 'connected'", () => {
    const { result, join, fire } = setup();
    join();
    fire("disconnect", "io client disconnect");
    expect(result.current.connectionStatus).toBe("connected");
    fire("disconnect", "transport close");
    expect(result.current.connectionStatus).toBe("reconnecting");
    join();
    expect(result.current.connectionStatus).toBe("connected");
  });

  test("FIXED: a connect_error during the first connect keeps 'connecting' (and later 'reconnecting'), never a stuck dead end", () => {
    const { result, join, fire } = setup();
    fire("connect_error", new Error("xhr poll error"));
    expect(result.current.connectionStatus).toBe("connecting");
    join();
    fire("disconnect", "ping timeout");
    fire("connect_error", new Error("xhr poll error"));
    expect(result.current.connectionStatus).toBe("reconnecting");
  });

  test.each([
    [{ status: 404, code: "ROOM_NOT_FOUND" }, "room_not_found"],
    [{ status: 403, code: "BANNED" }, "banned"],
    [{ status: 403, code: "FORBIDDEN" }, "unauthorized"],
    [{ status: 401, code: "UNAUTHENTICATED" }, "auth_expired"],
  ])("ticket failure %j ends in the %s screen", (failure, status) => {
    const { result, fire } = setup();
    mocks.socket.lastTicketFailure = failure;
    fire("connect_error", new Error("TICKET_INVALID"));
    expect(result.current.connectionStatus).toBe(status);
  });

  test("terminal states are sticky: a later disconnect does not flip them back to 'reconnecting'", () => {
    const { result, fire } = setup();
    mocks.socket.lastTicketFailure = { status: 403, code: "BANNED" };
    fire("connect_error", new Error("x"));
    fire("disconnect", "transport close");
    expect(result.current.connectionStatus).toBe("banned");
  });

  test("auth_expired (expired/logout): terminal 'auth_expired'", () => {
    const { result, join, fire } = setup();
    join();
    fire("auth_expired", { reason: "expired" });
    expect(result.current.connectionStatus).toBe("auth_expired");
  });

  test("auth_expired with reason 'rotated' (re-login) quietly reconnects with a fresh ticket", () => {
    vi.useFakeTimers();
    try {
      const { result, join, fire } = setup();
      join();
      fire("auth_expired", { reason: "rotated" });
      expect(result.current.connectionStatus).toBe("reconnecting");
      act(() => vi.advanceTimersByTime(200));
      expect(mocks.socket.reconnect).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  test("retryConnection reopens the same room", () => {
    const { result } = setup();
    mocks.socket.connect.mockClear();
    act(() => result.current.retryConnection());
    expect(mocks.socket.connect).toHaveBeenCalledWith("ABC234");
  });
});

describe("errors from the server", () => {
  test.each([
    ["ROOM_NOT_FOUND", "room_not_found"],
    ["ROOM_FULL", "room_full"],
    ["BANNED", "banned"],
    ["NOT_AUTHORIZED", "unauthorized"],
  ])("%s before we are in the room -> %s screen", (code, status) => {
    const { result, fire } = setup();
    fire("error_event", { code, message: "x" });
    expect(result.current.connectionStatus).toBe(status);
  });

  test("the same codes once connected are just a message (e.g. a participant pressing a host-only control)", () => {
    const { result, join, fire } = setup();
    join();
    fire("error_event", { code: "NOT_AUTHORIZED", message: "Only the host can do that." });
    expect(result.current.connectionStatus).toBe("connected");
    expect(result.current.roomError).toBe("Only the host can do that.");
  });

  test("rate limiting gets a friendly message; unknown errors fall back to a generic one", () => {
    const { result, join, fire } = setup();
    join();
    fire("error_event", { code: "RATE_LIMITED", message: "x" });
    expect(result.current.roomError).toMatch(/too fast/i);
    fire("error_event", {});
    expect(result.current.roomError).toBe("Something went wrong.");
  });

  test("removed_from_room -> banned screen", () => {
    const { result, join, fire } = setup();
    join();
    fire("removed_from_room", {});
    expect(result.current.connectionStatus).toBe("banned");
  });
});

describe("roster, roles and chat", () => {
  test("roster events replace the participant list", () => {
    const { result, join, fire } = setup();
    join();
    for (const event of [
      "participants_updated",
      "user_joined",
      "user_left",
      "participant_removed",
    ]) {
      fire(event, { participants: [P(event)] });
      expect(result.current.participants[0].id).toBe(event);
    }
  });

  test("my role follows the SERVER roster on role_assigned and host_changed", () => {
    const { result, join, fire } = setup();
    join();
    fire("role_assigned", {
      userId: "someone",
      role: "moderator",
      participants: [P("me", "participant")],
    });
    expect(result.current.role).toBe("participant");
    fire("role_assigned", {
      userId: "me",
      role: "moderator",
      participants: [P("me", "moderator")],
    });
    expect(result.current.role).toBe("moderator");
    fire("host_changed", { hostId: "me", participants: [P("me", "host")] });
    expect(result.current.role).toBe("host");
    expect(result.current.hostId).toBe("me");
    fire("host_changed", { hostId: "x", participants: [P("me", "moderator"), P("x", "host")] });
    expect(result.current.role).toBe("moderator");
  });

  test("chat appends in order, ignores null, and keeps the last 100", () => {
    const { result, join, fire } = setup();
    join();
    fire("new_message", null);
    expect(result.current.messages).toEqual([]);
    for (let i = 1; i <= 105; i++) fire("new_message", { id: `m${i}`, message: `m${i}` });
    expect(result.current.messages).toHaveLength(100);
    expect(result.current.messages[0].id).toBe("m6");
  });
});

describe("outgoing actions (the wire contract)", () => {
  test.each([
    ["play", [], ["play"]],
    ["pause", [], ["pause"]],
    ["seek", [12], ["seek", { time: 12 }]],
    [
      "changeVideo",
      ["https://youtu.be/aaaaaaaaaaa"],
      ["change_video", { url: "https://youtu.be/aaaaaaaaaaa" }],
    ],
    ["assignRole", ["u1", "moderator"], ["assign_role", { userId: "u1", role: "moderator" }]],
    ["removeParticipant", ["u1"], ["remove_participant", { userId: "u1" }]],
    ["transferHost", ["u1"], ["transfer_host", { userId: "u1" }]],
    ["sendMessage", ["hello"], ["send_message", { message: "hello" }]],
  ])("%s emits the right event", (action, args, emitted) => {
    const { result } = setup();
    act(() => result.current[action](...args));
    expect(mocks.socket.emit).toHaveBeenCalledWith(...emitted);
  });

  test("syncTime carries the sequence number it is based on (so the server can drop stale reports)", () => {
    const { result, join, fire } = setup();
    act(() => result.current.syncTime(3));
    expect(mocks.socket.emit).toHaveBeenLastCalledWith("time_sync", { time: 3, seq: -1 });
    join({
      currentVideo: {
        provider: "youtube",
        videoId: "aaaaaaaaaaa",
        playing: true,
        currentTime: 0,
        seq: 7,
      },
    });
    act(() => result.current.syncTime(5));
    expect(mocks.socket.emit).toHaveBeenLastCalledWith("time_sync", { time: 5, seq: 7 });
    fire("sync_state", {
      provider: "youtube",
      videoId: "aaaaaaaaaaa",
      playing: true,
      currentTime: 6,
      seq: 8,
      reason: "seek",
    });
    act(() => result.current.syncTime(6));
    expect(mocks.socket.emit).toHaveBeenLastCalledWith("time_sync", { time: 6, seq: 8 });
  });

  test("no outgoing event ever carries an identity or role claim", () => {
    const { result } = setup();
    act(() => {
      result.current.play();
      result.current.seek(1);
      result.current.syncTime(1);
      result.current.sendMessage("x");
      result.current.assignRole("u", "moderator");
      result.current.changeVideo("u");
    });
    const payloads = mocks.socket.emit.mock.calls.map((c) => JSON.stringify(c[1] ?? {}));
    expect(payloads.join(" ")).not.toMatch(/isHost|"role":"host"|username|senderId|ownerId/);
  });
});

describe("leaving", () => {
  test("leaveRoom closes the socket and resets everything", () => {
    const { result, join } = setup();
    join();
    act(() => result.current.leaveRoom());
    expect(mocks.socket.disconnect).toHaveBeenCalled();
    expect(result.current).toMatchObject({
      connectionStatus: "idle",
      roomId: "",
      userId: "",
      participants: [],
      messages: [],
      videoUrl: "",
    });
  });
});

afterEach(() => vi.useRealTimers());
