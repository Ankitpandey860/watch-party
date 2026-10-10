import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  caps: { mode: "full", reason: "ok", webgl: true },
  mount: vi.fn(),
  controller: null,
}));

vi.mock("../../three/capabilities", async () => {
  const actual = await vi.importActual("../../three/capabilities");
  return { ...actual, detectCapabilities: () => mocks.caps };
});
vi.mock("../../three/scene", () => ({ mountScene: (...a) => mocks.mount(...a) }));

import { ThreeBackdrop } from "./ThreeBackdrop";
import { EFFECTS_EVENT } from "../../three/capabilities";

beforeEach(() => {
  mocks.caps = { mode: "full", reason: "ok", webgl: true };
  mocks.controller = { setState: vi.fn(), dispose: vi.fn(), activate: vi.fn() };
  mocks.mount.mockReset().mockImplementation(() => mocks.controller);
});

describe("ThreeBackdrop", () => {
  test("mode off: renders only the CSS fallback; Three.js is never loaded or mounted", async () => {
    mocks.caps = { mode: "off", reason: "no-webgl" };
    const { container } = render(<ThreeBackdrop />);
    await act(async () => {});
    expect(screen.getByTestId("backdrop")).toHaveAttribute("data-mode", "off");
    expect(container.querySelector("canvas")).toBeNull();
    expect(container.querySelector(".backdrop-static")).not.toBeNull();
    expect(mocks.mount).not.toHaveBeenCalled();
  });

  test("full mode: lazily mounts the scene on a canvas with the requested options; the fallback stays underneath", async () => {
    const { container } = render(<ThreeBackdrop variant="room" interactive={false} />);
    await waitFor(() => expect(mocks.mount).toHaveBeenCalledTimes(1));
    const opts = mocks.mount.mock.calls[0][0];
    expect(opts).toMatchObject({ variant: "room", mode: "full", interactive: false });
    expect(opts.canvas).toBe(container.querySelector("canvas"));
    expect(container.querySelector(".backdrop-static")).not.toBeNull();
    expect(screen.getByTestId("backdrop")).toHaveAttribute("aria-hidden", "true");
  });

  test("static (reduced motion) mode mounts the still-frame variant", async () => {
    mocks.caps = { mode: "static", reason: "reduced-motion" };
    render(<ThreeBackdrop />);
    await waitFor(() => expect(mocks.mount).toHaveBeenCalled());
    expect(mocks.mount.mock.calls[0][0].mode).toBe("static");
  });

  test("pushes play state and participants into the scene, and updates them on change", async () => {
    const people = [{ id: "1", role: "host" }];
    const { rerender } = render(
      <ThreeBackdrop variant="room" playing={false} participants={people} />,
    );
    await waitFor(() => expect(mocks.controller.setState).toHaveBeenCalled());
    expect(mocks.controller.setState).toHaveBeenLastCalledWith({
      playing: false,
      participants: people,
    });
    rerender(<ThreeBackdrop variant="room" playing participants={people} />);
    expect(mocks.controller.setState).toHaveBeenLastCalledWith({
      playing: true,
      participants: people,
    });
  });

  test("onActivate from the scene reaches the page's handler (the screen is clickable, with a real button as the alternative)", async () => {
    const onActivate = vi.fn();
    render(<ThreeBackdrop onActivate={onActivate} />);
    await waitFor(() => expect(mocks.mount).toHaveBeenCalled());
    mocks.mount.mock.calls[0][0].onActivate();
    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  test("exposes the controller through controllerRef and clears it on unmount; unmount disposes the scene", async () => {
    const ref = { current: null };
    const { unmount } = render(<ThreeBackdrop controllerRef={ref} />);
    await waitFor(() => expect(ref.current).toBe(mocks.controller));
    unmount();
    expect(mocks.controller.dispose).toHaveBeenCalledTimes(1);
    expect(ref.current).toBeNull();
  });

  test("a WebGL context loss or a failed scene import falls back to CSS without crashing", async () => {
    const { container } = render(<ThreeBackdrop />);
    await waitFor(() => expect(mocks.mount).toHaveBeenCalled());
    act(() => mocks.mount.mock.calls[0][0].onContextLost());
    await waitFor(() => expect(container.querySelector("canvas")).toBeNull());
    expect(screen.getByTestId("backdrop")).toHaveAttribute("data-mode", "off");

    mocks.mount.mockReset().mockImplementation(() => {
      throw new Error("webgl init failed");
    });
    const second = render(<ThreeBackdrop />);
    await waitFor(() => expect(second.container.querySelector("canvas")).toBeNull());
  });

  test("changing the effects preference at runtime re-detects and tears the scene down", async () => {
    const { container } = render(<ThreeBackdrop />);
    await waitFor(() => expect(mocks.mount).toHaveBeenCalledTimes(1));
    mocks.caps = { mode: "off", reason: "user-off" };
    act(() => window.dispatchEvent(new Event(EFFECTS_EVENT)));
    await waitFor(() => expect(container.querySelector("canvas")).toBeNull());
    expect(mocks.controller.dispose).toHaveBeenCalled();
  });
});
