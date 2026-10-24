import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const svc = vi.hoisted(() => ({ status: vi.fn(), createPairingCode: vi.fn(), revoke: vi.fn() }));
vi.mock("../services/extensionService", () => ({ default: svc, extensionService: svc }));

import { useExtensionPairing } from "./useExtensionPairing";

const flush = () =>
  act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
const NOT_PAIRED = { paired: false, connected: false, label: null, expiresAt: null };

beforeEach(() => {
  vi.useFakeTimers();
  svc.status.mockReset().mockResolvedValue(NOT_PAIRED);
  svc.createPairingCode.mockReset().mockResolvedValue({ code: "ABCD-EFGH", expiresInSeconds: 120 });
  svc.revoke.mockReset().mockResolvedValue({ revoked: 1 });
});
afterEach(() => vi.useRealTimers());

describe("useExtensionPairing", () => {
  test("loads status immediately and then polls", async () => {
    renderHook(() => useExtensionPairing("ROOM42"));
    await flush();
    expect(svc.status).toHaveBeenCalledWith("ROOM42");
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    expect(svc.status).toHaveBeenCalledTimes(2);
  });
  test("does nothing when disabled or without a room", async () => {
    renderHook(() => useExtensionPairing("", { enabled: true }));
    renderHook(() => useExtensionPairing("ROOM42", { enabled: false }));
    await flush();
    expect(svc.status).not.toHaveBeenCalled();
  });
  test("pair() shows the code with a live countdown that disappears at expiry", async () => {
    const { result } = renderHook(() => useExtensionPairing("ROOM42"));
    await flush();
    await act(async () => {
      await result.current.pair();
    });
    expect(result.current.code).toBe("ABCD-EFGH");
    expect(result.current.expiresIn).toBe(120);
    await act(async () => {
      vi.advanceTimersByTime(30_000);
    });
    expect(result.current.expiresIn).toBeLessThanOrEqual(90);
    await act(async () => {
      vi.advanceTimersByTime(95_000);
    });
    expect(result.current.code).toBeNull(); // expired codes are not shown
  });
  test("the code is hidden as soon as the extension has used it (status becomes paired)", async () => {
    const { result } = renderHook(() => useExtensionPairing("ROOM42"));
    await flush();
    await act(async () => {
      await result.current.pair();
    });
    expect(result.current.code).toBe("ABCD-EFGH");
    svc.status.mockResolvedValue({ paired: true, connected: true, label: "x", expiresAt: null });
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    expect(result.current.status.paired).toBe(true);
    expect(result.current.code).toBeNull();
  });
  test("a failed pairing request becomes a message (not an exception) and clears busy", async () => {
    svc.createPairingCode.mockRejectedValue(
      new Error("Join the room first, then pair your extension."),
    );
    const { result } = renderHook(() => useExtensionPairing("ROOM42"));
    await flush();
    await act(async () => {
      await result.current.pair();
    });
    expect(result.current.error).toMatch(/Join the room first/);
    expect(result.current.busy).toBe(false);
    expect(result.current.code).toBeNull();
  });
  test("revoke() calls the server, clears any code and refreshes status", async () => {
    const { result } = renderHook(() => useExtensionPairing("ROOM42"));
    await flush();
    await act(async () => {
      await result.current.pair();
    });
    svc.status.mockClear();
    await act(async () => {
      await result.current.revoke();
    });
    expect(svc.revoke).toHaveBeenCalledWith("ROOM42");
    expect(result.current.code).toBeNull();
    expect(svc.status).toHaveBeenCalled();
  });
  test("a transient status failure is swallowed (the next poll retries)", async () => {
    svc.status.mockRejectedValueOnce(new Error("offline"));
    const { result } = renderHook(() => useExtensionPairing("ROOM42"));
    await flush();
    expect(result.current.status.paired).toBe(false);
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    expect(svc.status).toHaveBeenCalledTimes(2);
  });
  test("stops polling on unmount", async () => {
    const { unmount } = renderHook(() => useExtensionPairing("ROOM42"));
    await flush();
    unmount();
    svc.status.mockClear();
    await act(async () => {
      vi.advanceTimersByTime(20_000);
    });
    expect(svc.status).not.toHaveBeenCalled();
  });
});
