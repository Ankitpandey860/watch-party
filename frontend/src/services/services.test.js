import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";

// ---------- api.js ----------
describe("api client", () => {
  let api;
  beforeEach(async () => {
    vi.resetModules();
    ({ api } = await import("./api"));
  });
  afterEach(() => vi.useRealTimers());

  test("sends credentials (cookie) and the CSRF header on every request", () => {
    expect(api.defaults.withCredentials).toBe(true);
    expect(api.defaults.headers["X-Requested-With"]).toBe("watchparty");
  });

  test("no auth token is ever attached from JavaScript-readable storage", async () => {
    let seen;
    api.defaults.adapter = async (config) => {
      seen = config;
      return { data: {}, status: 200, statusText: "OK", headers: {}, config };
    };
    localStorage.setItem("token", "should-not-be-used");
    await api.get("/x");
    expect(seen.headers.Authorization).toBeUndefined();
    localStorage.clear();
  });

  test("server errors are normalised to Error{code,status,retryAfterSeconds}", async () => {
    api.defaults.adapter = async (config) => {
      const err = new Error("x");
      err.config = config;
      err.response = {
        status: 429,
        data: {
          error: { code: "RATE_LIMITED", message: "Too many requests.", retryAfterSeconds: 42 },
        },
      };
      throw err;
    };
    await expect(api.post("/x")).rejects.toMatchObject({
      message: "Too many requests.",
      code: "RATE_LIMITED",
      status: 429,
      retryAfterSeconds: 42,
    });
  });

  test("network failures give a friendly message and code", async () => {
    api.defaults.adapter = async (config) => {
      const e = new Error("Network Error");
      e.config = config;
      throw e;
    };
    await expect(api.post("/x")).rejects.toMatchObject({
      code: "NETWORK_ERROR",
      message: expect.stringMatching(/can't reach the server/i),
    });
  });

  test("GETs are retried while the backend wakes up; POSTs are never retried automatically", async () => {
    vi.useFakeTimers();
    let gets = 0,
      posts = 0;
    api.defaults.adapter = async (config) => {
      if (config.method === "get") {
        gets++;
        if (gets < 3) {
          const e = new Error("down");
          e.config = config;
          e.response = { status: 503, data: {} };
          throw e;
        }
        return { data: { ok: true }, status: 200, statusText: "OK", headers: {}, config };
      }
      posts++;
      const e = new Error("down");
      e.config = config;
      e.response = { status: 503, data: {} };
      throw e;
    };
    const p = api.get("/health");
    await vi.advanceTimersByTimeAsync(5000);
    expect((await p).data.ok).toBe(true);
    expect(gets).toBe(3);
    await expect(api.post("/rooms")).rejects.toBeTruthy();
    expect(posts).toBe(1);
  });
});

// ---------- authService / roomService ----------
describe("auth + room services call the right endpoints", () => {
  let api, authService, roomService;
  beforeEach(async () => {
    vi.resetModules();
    ({ api } = await import("./api"));
    ({ authService } = await import("./authService"));
    ({ roomService } = await import("./roomService"));
    api.get = vi.fn().mockResolvedValue({ data: {} });
    api.post = vi
      .fn()
      .mockResolvedValue({ data: { principal: { id: "p" }, ticket: "T", ok: true } });
    api.patch = vi.fn().mockResolvedValue({ data: { principal: { id: "p" } } });
  });

  test("auth endpoints and payloads", async () => {
    await authService.me();
    expect(api.get).toHaveBeenCalledWith("/auth/me");
    await authService.guest("Sam");
    expect(api.post).toHaveBeenCalledWith("/auth/guest", { displayName: "Sam" });
    await authService.requestOtp("a@b.co");
    expect(api.post).toHaveBeenCalledWith("/auth/otp/request", { email: "a@b.co" });
    await authService.verifyOtp("a@b.co", "123456");
    expect(api.post).toHaveBeenCalledWith("/auth/otp/verify", { email: "a@b.co", code: "123456" });
    await authService.logout();
    expect(api.post).toHaveBeenCalledWith("/auth/logout");
    await authService.rename("N");
    expect(api.patch).toHaveBeenCalledWith("/auth/me", { displayName: "N" });
  });

  test("Google sign-in is a navigation URL carrying only the (encoded) returnTo", () => {
    const url = authService.googleStartUrl("/room/ABC234?x=1&y=2");
    expect(url).toMatch(/\/auth\/google\/start\?returnTo=/);
    expect(url).toContain(encodeURIComponent("/room/ABC234?x=1&y=2"));
    expect(url).not.toMatch(/secret|token/i);
  });

  test("room endpoints and payloads (identity is never sent by the client)", async () => {
    await roomService.createRoom();
    expect(api.post).toHaveBeenCalledWith("/rooms");
    await roomService.getRoom("ABC 234");
    expect(api.get).toHaveBeenCalledWith("/rooms/ABC%20234");
    await roomService.joinRoom("ABC234", "Sam");
    expect(api.post).toHaveBeenCalledWith("/rooms/ABC234/join", { displayName: "Sam" });
    await roomService.joinRoom("ABC234");
    expect(api.post).toHaveBeenLastCalledWith("/rooms/ABC234/join", {});
    expect(await roomService.socketTicket("ABC234")).toBe("T");
    expect(api.post).toHaveBeenLastCalledWith("/auth/socket-ticket", { roomId: "ABC234" });
  });
});

// ---------- socketService ----------
describe("socketService (ticket handshake)", () => {
  const sockets = [];
  const ioMock = vi.fn((_url, opts) => {
    const handlers = {};
    const s = {
      opts,
      connected: false,
      handlers,
      on: vi.fn((e, h) => {
        handlers[e] = h;
      }),
      off: vi.fn(),
      emit: vi.fn(),
      connect: vi.fn(),
      disconnect: vi.fn(),
      removeAllListeners: vi.fn(),
    };
    sockets.push(s);
    return s;
  });
  const ticketMock = vi.fn();
  let socketService;

  beforeEach(async () => {
    vi.resetModules();
    sockets.length = 0;
    ioMock.mockClear();
    ticketMock.mockReset();
    vi.doMock("socket.io-client", () => ({ io: ioMock }));
    vi.doMock("./roomService", () => ({
      default: { socketTicket: ticketMock },
      roomService: { socketTicket: ticketMock },
    }));
    ({ socketService } = await import("./socketService"));
  });
  afterEach(() => {
    vi.doUnmock("socket.io-client");
    vi.doUnmock("./roomService");
  });

  test("connects manually with a ticket-fetching auth callback; identity is not in the options", () => {
    socketService.connect("ABC234");
    const s = sockets[0];
    expect(s.opts.autoConnect).toBe(false);
    expect(typeof s.opts.auth).toBe("function");
    expect(JSON.stringify(Object.keys(s.opts))).not.toMatch(/userId|username|role/i);
    expect(s.connect).toHaveBeenCalled();
  });

  test("the auth callback fetches a FRESH ticket for the room on each (re)connect attempt", async () => {
    ticketMock.mockResolvedValueOnce("T1").mockResolvedValueOnce("T2");
    socketService.connect("ABC234");
    const { auth } = sockets[0].opts;
    const cb = vi.fn();
    await auth(cb);
    await auth(cb);
    expect(ticketMock).toHaveBeenNthCalledWith(1, "ABC234");
    expect(cb.mock.calls).toEqual([[{ ticket: "T1" }], [{ ticket: "T2" }]]);
    expect(socketService.lastTicketFailure).toBeNull();
  });

  test("a failed ticket request is remembered (why) and an empty ticket is presented", async () => {
    ticketMock.mockRejectedValue(
      Object.assign(new Error("gone"), { status: 404, code: "ROOM_NOT_FOUND" }),
    );
    socketService.connect("ABC234");
    const cb = vi.fn();
    await sockets[0].opts.auth(cb);
    expect(cb).toHaveBeenCalledWith({ ticket: "" });
    expect(socketService.lastTicketFailure).toMatchObject({ status: 404, code: "ROOM_NOT_FOUND" });
  });

  test("on every connect it asks to join the room — with only the roomId", () => {
    socketService.connect("ABC234");
    sockets[0].handlers.connect();
    expect(sockets[0].emit).toHaveBeenCalledWith("join_room", { roomId: "ABC234" });
  });

  test("disconnect says goodbye only when connected, removes listeners, and is idempotent", () => {
    socketService.connect("ABC234");
    const s = sockets[0];
    s.connected = true;
    socketService.disconnect();
    expect(s.emit).toHaveBeenCalledWith("leave_room");
    expect(s.removeAllListeners).toHaveBeenCalled();
    expect(() => socketService.disconnect()).not.toThrow();
  });

  test("connecting again tears down the previous socket first (no duplicates)", () => {
    socketService.connect("AAAAAA");
    socketService.connect("BBBBBB");
    expect(sockets[0].disconnect).toHaveBeenCalled();
    expect(sockets).toHaveLength(2);
  });

  test("on() returns an unsubscribe function and is a safe no-op with no socket", () => {
    expect(socketService.on("x", () => {})()).toBeUndefined();
    socketService.connect("ABC234");
    const off = socketService.on("room_state", () => {});
    off();
    expect(sockets[0].off).toHaveBeenCalled();
  });

  test("reconnect() only reconnects a disconnected socket", () => {
    socketService.connect("ABC234");
    const s = sockets[0];
    s.connect.mockClear();
    s.connected = true;
    socketService.reconnect();
    expect(s.connect).not.toHaveBeenCalled();
    s.connected = false;
    socketService.reconnect();
    expect(s.connect).toHaveBeenCalled();
  });
});
