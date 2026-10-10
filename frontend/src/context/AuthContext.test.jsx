import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  auth: {
    me: vi.fn(),
    guest: vi.fn(),
    verifyOtp: vi.fn(),
    requestOtp: vi.fn(),
    logout: vi.fn(),
    rename: vi.fn(),
    googleStartUrl: vi.fn((r) => `/g?returnTo=${r}`),
  },
  warm: vi.fn(),
}));
vi.mock("../services/authService", () => ({ authService: mocks.auth, default: mocks.auth }));
vi.mock("../services/api", () => ({ warmUpBackend: mocks.warm }));

import { AuthProvider, useAuth } from "./AuthContext";

const wrapper = AuthProvider;
const user = { id: "u1", kind: "user", displayName: "Una" };

beforeEach(() => {
  Object.values(mocks.auth).forEach((f) => f.mockReset?.());
  mocks.auth.googleStartUrl.mockImplementation((r) => `/g?returnTo=${r}`);
  mocks.warm.mockReset();
  mocks.auth.me.mockResolvedValue({ principal: null, providers: { google: true, email: true } });
});
afterEach(() => vi.useRealTimers());

describe("AuthProvider", () => {
  test("loads who is signed in and which sign-in methods the server offers; wakes the backend early", async () => {
    mocks.auth.me.mockResolvedValue({ principal: user, providers: { google: false, email: true } });
    const { result } = renderHook(() => useAuth(), { wrapper });
    expect(result.current.status).toBe("loading");
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current).toMatchObject({
      principal: user,
      isUser: true,
      isGuest: false,
      providers: { google: false, email: true },
    });
    expect(mocks.warm).toHaveBeenCalledTimes(1);
  });

  test("a guest is not a user", async () => {
    mocks.auth.me.mockResolvedValue({
      principal: { id: "g", kind: "guest", displayName: "G" },
      providers: {},
    });
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current).toMatchObject({ isUser: false, isGuest: true });
  });

  test("an unreachable server is reported, and refresh() can recover", async () => {
    mocks.auth.me.mockRejectedValueOnce(new Error("down"));
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("unreachable"));
    mocks.auth.me.mockResolvedValue({ principal: user, providers: {} });
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.status).toBe("ready");
    expect(result.current.principal).toEqual(user);
  });

  test("flags a slow first load (probably a sleeping free-tier server)", async () => {
    vi.useFakeTimers();
    let release;
    mocks.auth.me.mockReturnValue(
      new Promise((r) => {
        release = r;
      }),
    );
    const { result } = renderHook(() => useAuth(), { wrapper });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3100);
    });
    expect(result.current.slow).toBe(true);
    await act(async () => {
      release({ principal: null, providers: {} });
    });
    expect(result.current.slow).toBe(false);
  });

  test("verifyOtp / continueAsGuest / rename update the principal", async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    mocks.auth.verifyOtp.mockResolvedValue(user);
    await act(async () => {
      await result.current.verifyOtp("a@b.co", "123456");
    });
    expect(mocks.auth.verifyOtp).toHaveBeenCalledWith("a@b.co", "123456");
    expect(result.current.principal).toEqual(user);
    mocks.auth.rename.mockResolvedValue({ ...user, displayName: "New" });
    await act(async () => {
      await result.current.rename("New");
    });
    expect(result.current.principal.displayName).toBe("New");
    mocks.auth.guest.mockResolvedValue({ id: "g", kind: "guest", displayName: "G" });
    await act(async () => {
      await result.current.continueAsGuest("G");
    });
    expect(result.current.isGuest).toBe(true);
  });

  test("logout clears the principal EVEN IF the request fails (never leave a stale signed-in UI)", async () => {
    mocks.auth.me.mockResolvedValue({ principal: user, providers: {} });
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isUser).toBe(true));
    mocks.auth.logout.mockRejectedValue(new Error("network"));
    await act(async () => {
      await result.current.logout().catch(() => {});
    });
    expect(result.current.principal).toBeNull();
  });

  test("never writes credentials to web storage", async () => {
    mocks.auth.verifyOtp.mockResolvedValue(user);
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    await act(async () => {
      await result.current.verifyOtp("a@b.co", "123456");
    });
    expect(Object.keys(localStorage)).toEqual([]);
    expect(Object.keys(sessionStorage)).toEqual([]);
  });

  test("useAuth outside the provider is a clear error", () => {
    expect(() => renderHook(() => useAuth())).toThrow(/AuthProvider/);
  });
});
