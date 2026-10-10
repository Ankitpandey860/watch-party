import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  caps: { mode: "full", webgl: true, reducedMotion: false },
  set: vi.fn(),
}));
vi.mock("../../three/capabilities", async () => {
  const actual = await vi.importActual("../../three/capabilities");
  return {
    ...actual,
    detectCapabilities: () => mocks.caps,
    setEffectsPreference: (v) => mocks.set(v),
  };
});
import { EffectsToggle } from "./EffectsToggle";

beforeEach(() => {
  mocks.set.mockReset();
  mocks.caps = { mode: "full", webgl: true, reducedMotion: false };
});

describe("EffectsToggle", () => {
  test("is hidden when the device has no WebGL (nothing to toggle: no fake control)", () => {
    mocks.caps = { mode: "off", webgl: false };
    const { container } = render(<EffectsToggle />);
    expect(container).toBeEmptyDOMElement();
  });
  test("on: shows pressed state and turns effects off when clicked", () => {
    render(<EffectsToggle />);
    const btn = screen.getByRole("button", { name: /3d on/i });
    expect(btn).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(btn);
    expect(mocks.set).toHaveBeenCalledWith("off");
  });
  test("off: shows unpressed state and turns effects on when clicked", () => {
    mocks.caps = { mode: "off", webgl: true, reducedMotion: false };
    render(<EffectsToggle />);
    const btn = screen.getByRole("button", { name: /3d off/i });
    expect(btn).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(btn);
    expect(mocks.set).toHaveBeenCalledWith("on");
  });
});
