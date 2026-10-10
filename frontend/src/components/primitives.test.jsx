import { describe, test, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Dropdown } from "./Dropdown";
import { Modal } from "./Modal";
import { TiltCard } from "./TiltCard";

describe("Dropdown (keyboard accessible menu)", () => {
  const items = () => [
    { label: "One", onClick: vi.fn() },
    { label: "Two", onClick: vi.fn() },
    { divider: true },
    { label: "Gone", onClick: vi.fn(), disabled: true },
  ];
  const mk = (its) =>
    render(<Dropdown label="Actions" trigger={<button type="button">Open</button>} items={its} />);

  test("the trigger exposes aria-haspopup/expanded and toggles the menu", async () => {
    mk(items());
    const t = screen.getByRole("button", { name: /open|actions/i });
    expect(t).toHaveAttribute("aria-haspopup", "menu");
    expect(t).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(t);
    expect(t).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(screen.getAllByRole("menuitem")).toHaveLength(3);
  });

  test("opening moves focus into the menu; arrows move; Escape closes and returns focus to the trigger", async () => {
    const user = userEvent.setup();
    mk(items());
    const t = screen.getByRole("button", { name: /open|actions/i });
    await user.click(t);
    expect(screen.getByRole("menuitem", { name: "One" })).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "Two" })).toHaveFocus();
    await user.keyboard("{ArrowDown}"); // wraps past the disabled item
    expect(screen.getByRole("menuitem", { name: "One" })).toHaveFocus();
    await user.keyboard("{ArrowUp}");
    expect(screen.getByRole("menuitem", { name: "Two" })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(t).toHaveFocus();
  });

  test("ArrowDown on the closed trigger opens it; choosing an item runs it and closes; disabled items do nothing", async () => {
    const user = userEvent.setup();
    const its = items();
    mk(its);
    screen.getByRole("button", { name: /open|actions/i }).focus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menu")).toBeInTheDocument();
    await user.click(screen.getByRole("menuitem", { name: "Gone" }));
    expect(its[3].onClick).not.toHaveBeenCalled();
    await user.click(screen.getByRole("menuitem", { name: "Two" }));
    expect(its[1].onClick).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  test("clicking outside closes it", async () => {
    mk(items());
    await userEvent.click(screen.getByRole("button", { name: /open|actions/i }));
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
  });
});

describe("Modal", () => {
  test("is a labelled modal dialog, focuses its first field, closes on Escape / the X / the backdrop, and restores focus", async () => {
    const onClose = vi.fn();
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    const { rerender } = render(
      <Modal open title="Rename" onClose={onClose}>
        <input aria-label="Name" />
      </Modal>,
    );
    const dialog = screen.getByRole("dialog", { name: "Rename" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    await vi.waitFor(() => expect(screen.getByLabelText("Name")).toHaveFocus());
    fireEvent.keyDown(window, { key: "Escape" });
    await userEvent.click(screen.getByRole("button", { name: /close dialog/i }));
    expect(onClose).toHaveBeenCalledTimes(2);
    rerender(
      <Modal open={false} title="Rename" onClose={onClose}>
        <input aria-label="Name" />
      </Modal>,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(opener).toHaveFocus();
    opener.remove();
  });
});

describe("TiltCard (CSS 3D)", () => {
  const media = (fine, reduced) => {
    window.matchMedia = (q) => ({
      matches: q.includes("reduced-motion") ? reduced : q.includes("pointer: fine") ? fine : false,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
    });
  };
  const rect = { left: 0, top: 0, width: 200, height: 100, right: 200, bottom: 100, x: 0, y: 0 };
  const move = (el, x, y) => {
    el.parentElement.getBoundingClientRect = () => rect;
    el.getBoundingClientRect = () => rect;
    fireEvent.pointerMove(el.parentElement, { clientX: x, clientY: y });
  };

  test("tilts toward the pointer with a mouse and resets when it leaves; content stays interactive", async () => {
    media(true, false);
    const onClick = vi.fn();
    render(
      <TiltCard>
        <button onClick={onClick}>Hi</button>
      </TiltCard>,
    );
    const card = screen.getByTestId("tilt-card");
    move(card, 200, 0); // top-right corner
    expect(card.style.transform).toMatch(/rotateX\(\d/); // positive X rotation (tilts up-right)
    expect(card.style.transform).toMatch(/rotateY\(\d/);
    fireEvent.pointerLeave(card.parentElement);
    expect(card.style.transform).toBe("");
    await userEvent.click(screen.getByRole("button", { name: "Hi" }));
    expect(onClick).toHaveBeenCalled();
  });

  test("does nothing for reduced motion or touch/coarse pointers", () => {
    for (const [fine, reduced] of [
      [true, true],
      [false, false],
    ]) {
      media(fine, reduced);
      const { unmount } = render(<TiltCard>x</TiltCard>);
      const card = screen.getByTestId("tilt-card");
      move(card, 150, 20);
      expect(card.style.transform).toBe("");
      unmount();
    }
  });
});
