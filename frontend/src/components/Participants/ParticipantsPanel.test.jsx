import { describe, test, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ParticipantsPanel } from "./ParticipantsPanel";

const P = (id, role = "participant", extra = {}) => ({
  id,
  username: id,
  role,
  kind: "user",
  online: true,
  ...extra,
});
const roster = [
  P("Host", "host"),
  P("Mod", "moderator"),
  P("Ann"),
  P("Gus", "participant", { kind: "guest" }),
  P("Off", "participant", { online: false }),
];

function setup(role, over = {}) {
  const cb = { onPromote: vi.fn(), onDemote: vi.fn(), onRemove: vi.fn(), onTransferHost: vi.fn() };
  render(
    <ParticipantsPanel participants={roster} currentUserId="Host" role={role} {...cb} {...over} />,
  );
  return cb;
}

describe("ParticipantsPanel", () => {
  test("lists everyone with online counts, role badges, a Guest badge and 'offline' markers; marks you", () => {
    setup("host");
    expect(screen.getByText(/4 online · 5 in room/i)).toBeInTheDocument();
    const list = screen.getByRole("list", { name: /participants/i });
    expect(within(list).getAllByRole("listitem")).toHaveLength(5);
    expect(screen.getByText("(you)")).toBeInTheDocument();
    expect(screen.getByText("Guest")).toBeInTheDocument();
    expect(screen.getByText("offline")).toBeInTheDocument();
  });

  test("empty state", () => {
    render(<ParticipantsPanel participants={[]} currentUserId="x" role="host" />);
    expect(screen.getByText(/no one else is here yet/i)).toBeInTheDocument();
  });

  test.each(["moderator", "participant"])(
    "a %s gets NO management menus (host-only, as the server enforces)",
    (role) => {
      setup(role);
      expect(screen.queryByRole("button", { name: /^manage/i })).toBeNull();
    },
  );

  test("the host gets a menu for everyone except themselves", () => {
    setup("host");
    expect(screen.queryByRole("button", { name: "Manage Host" })).toBeNull();
    for (const n of ["Mod", "Ann", "Gus", "Off"])
      expect(screen.getByRole("button", { name: `Manage ${n}` })).toBeInTheDocument();
  });

  test("the manage button is always visible on touch screens (not hover-only)", () => {
    setup("host");
    const cls = screen.getByRole("button", { name: "Manage Ann" }).className;
    expect(cls).toContain("opacity-100");
    expect(cls).toContain("sm:opacity-0"); // hover-reveal only from the sm breakpoint up
    expect(cls).toContain("sm:focus:opacity-100"); // and always revealed on keyboard focus
  });

  test("host actions call back with the participant id (promote, demote, transfer, remove & ban)", async () => {
    const user = userEvent.setup();
    const cb = setup("host");
    await user.click(screen.getByRole("button", { name: "Manage Ann" }));
    await user.click(screen.getByRole("menuitem", { name: /promote to moderator/i }));
    expect(cb.onPromote).toHaveBeenCalledWith("Ann");
    await user.click(screen.getByRole("button", { name: "Manage Ann" }));
    await user.click(screen.getByRole("menuitem", { name: /transfer host/i }));
    expect(cb.onTransferHost).toHaveBeenCalledWith("Ann");
    await user.click(screen.getByRole("button", { name: "Manage Ann" }));
    await user.click(screen.getByRole("menuitem", { name: /remove & ban/i }));
    expect(cb.onRemove).toHaveBeenCalledWith("Ann");
    await user.click(screen.getByRole("button", { name: "Manage Mod" }));
    expect(screen.getByRole("menuitem", { name: /promote/i })).toBeDisabled(); // already a moderator
    await user.click(screen.getByRole("menuitem", { name: /^demote$/i }));
    expect(cb.onDemote).toHaveBeenCalledWith("Mod");
  });

  test("guests cannot be promoted or made host (disabled, with the reason), but can be removed", async () => {
    const user = userEvent.setup();
    const cb = setup("host");
    await user.click(screen.getByRole("button", { name: "Manage Gus" }));
    const promote = screen.getByRole("menuitem", { name: /promote to moderator/i });
    const transfer = screen.getByRole("menuitem", { name: /transfer host/i });
    expect(promote).toBeDisabled();
    expect(transfer).toBeDisabled();
    expect(promote).toHaveAttribute("title", expect.stringMatching(/guests can't be moderators/i));
    await user.click(promote);
    expect(cb.onPromote).not.toHaveBeenCalled();
    await user.click(screen.getByRole("menuitem", { name: /remove & ban/i }));
    expect(cb.onRemove).toHaveBeenCalledWith("Gus");
  });

  test("an offline participant cannot be made host", async () => {
    const user = userEvent.setup();
    setup("host");
    await user.click(screen.getByRole("button", { name: "Manage Off" }));
    expect(screen.getByRole("menuitem", { name: /transfer host/i })).toBeDisabled();
  });
});
