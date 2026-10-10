// Characterization tests for components/Controls/Controls.jsx.
import { describe, test, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Controls } from "./Controls";

function setup(props = {}) {
  const handlers = { onPlay: vi.fn(), onPause: vi.fn(), onSeek: vi.fn(), onVolume: vi.fn() };
  render(
    <Controls
      playing={false}
      currentTime={100}
      duration={300}
      volume={60}
      {...handlers}
      {...props}
    />,
  );
  const [seekSlider, volumeSlider] = screen.getAllByRole("slider");
  return { ...handlers, seekSlider, volumeSlider };
}

describe("Controls", () => {
  test("shows formatted current time and duration", () => {
    setup({ currentTime: 3725, duration: 7200 });
    expect(screen.getByText("1:02:05")).toBeInTheDocument();
    expect(screen.getByText("2:00:00")).toBeInTheDocument();
  });

  test("the main button toggles by `playing`: Play -> onPlay, Pause -> onPause", () => {
    const a = setup({ playing: false });
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    expect(a.onPlay).toHaveBeenCalledTimes(1);
    expect(a.onPause).not.toHaveBeenCalled();
  });

  test("when playing the button reads Pause and calls onPause", () => {
    const a = setup({ playing: true });
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    expect(a.onPause).toHaveBeenCalledTimes(1);
  });

  test("back/forward 10s seek relative to currentTime, clamped to [0, duration]", () => {
    const a = setup({ currentTime: 100, duration: 300 });
    fireEvent.click(screen.getByRole("button", { name: "Back 10s" }));
    fireEvent.click(screen.getByRole("button", { name: "Forward 10s" }));
    expect(a.onSeek.mock.calls).toEqual([[90], [110]]);
  });

  test("back 10s clamps at 0 and forward 10s clamps at duration", () => {
    const a = setup({ currentTime: 4, duration: 8 });
    fireEvent.click(screen.getByRole("button", { name: "Back 10s" }));
    fireEvent.click(screen.getByRole("button", { name: "Forward 10s" }));
    expect(a.onSeek.mock.calls).toEqual([[0], [8]]);
  });

  test("FIXED: dragging the seek slider sends ONE seek on release, not one per step", () => {
    const a = setup();
    for (const v of ["110", "120", "130", "140", "150"])
      fireEvent.change(a.seekSlider, { target: { value: v } });
    expect(a.onSeek).not.toHaveBeenCalled(); // still dragging
    expect(screen.getByText("2:30")).toBeInTheDocument(); // the thumb/time follow the finger locally
    fireEvent.pointerUp(a.seekSlider, { target: { value: "150" } });
    expect(a.onSeek.mock.calls).toEqual([[150]]);
  });

  test("keyboard seeking commits on key release; a plain blur without dragging sends nothing", () => {
    const a = setup();
    fireEvent.change(a.seekSlider, { target: { value: "130" } });
    fireEvent.keyUp(a.seekSlider, { key: "ArrowRight", target: { value: "130" } });
    expect(a.onSeek.mock.calls).toEqual([[130]]);
    a.onSeek.mockClear();
    fireEvent.blur(a.seekSlider);
    expect(a.onSeek).not.toHaveBeenCalled();
  });

  test("sliders are labelled for assistive tech", () => {
    setup();
    expect(screen.getByRole("slider", { name: "Seek" })).toBeInTheDocument();
    expect(screen.getByRole("slider", { name: "Volume" })).toBeInTheDocument();
  });

  test("volume: mute button toggles 0 <-> 60; the volume slider reports numbers", () => {
    const a = setup({ volume: 60 });
    fireEvent.click(screen.getByRole("button", { name: "Toggle mute" }));
    expect(a.onVolume).toHaveBeenLastCalledWith(0);
    fireEvent.change(a.volumeSlider, { target: { value: "25" } });
    expect(a.onVolume).toHaveBeenLastCalledWith(25);
  });

  test("muted state: the mute button restores 60", () => {
    const a = setup({ volume: 0 });
    fireEvent.click(screen.getByRole("button", { name: "Toggle mute" }));
    expect(a.onVolume).toHaveBeenLastCalledWith(60);
  });

  test("disabled: transport controls and the seek slider are disabled, a notice shows, volume stays usable", () => {
    const a = setup({ disabled: true });
    expect(screen.getByRole("button", { name: "Play" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Back 10s" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Forward 10s" })).toBeDisabled();
    expect(a.seekSlider).toBeDisabled();
    expect(a.volumeSlider).not.toBeDisabled();
    expect(screen.getByRole("button", { name: "Toggle mute" })).not.toBeDisabled();
    expect(screen.getByText(/controlled by the Host/i)).toBeInTheDocument();
  });
});
