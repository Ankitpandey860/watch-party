import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const h = vi.hoisted(() => ({ nav: vi.fn(), auth: null }));
vi.mock("@tanstack/react-router", async () =>
  (await import("../../test/routerMock")).makeRouterMock({ navigate: h.nav }),
);
vi.mock("../../context/AuthContext", () => ({ useAuth: () => h.auth }));

import { LandingPage } from "./LandingPage";

beforeEach(() => {
  h.nav.mockReset();
  h.auth = {
    status: "ready",
    principal: null,
    isUser: false,
    isGuest: false,
    providers: {},
    logout: vi.fn(),
    rename: vi.fn(),
  };
});

describe("LandingPage", () => {
  test("renders the hero, how-it-works steps, and the safe CSS fallback backdrop (no WebGL in this environment)", () => {
    render(<LandingPage />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/watch together/i);
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getByTestId("backdrop")).toHaveAttribute("data-mode", "off");
  });

  test("signed out: the CTA goes to sign-in and returns to /create afterwards", async () => {
    render(<LandingPage />);
    await userEvent.click(screen.getByRole("button", { name: /start a party/i }));
    expect(h.nav).toHaveBeenCalledWith({ to: "/auth", search: { returnTo: "/create" } });
  });

  test("signed in: the CTA creates a room", async () => {
    h.auth.isUser = true;
    h.auth.principal = { id: "u", kind: "user", displayName: "Una" };
    render(<LandingPage />);
    await userEvent.click(screen.getByRole("button", { name: /create a room/i }));
    expect(h.nav).toHaveBeenCalledWith({ to: "/create" });
  });

  test("join by code: normalises the code and opens the room (no account needed)", async () => {
    render(<LandingPage />);
    await userEvent.type(screen.getByLabelText(/room code/i), "ab-c 234");
    await userEvent.click(screen.getByRole("button", { name: /^join$/i }));
    expect(h.nav).toHaveBeenCalledWith({ to: "/room/$roomId", params: { roomId: "ABC234" } });
  });

  test("join by code: too-short codes show an inline error and do not navigate", async () => {
    render(<LandingPage />);
    await userEvent.type(screen.getByLabelText(/room code/i), "ab");
    await userEvent.click(screen.getByRole("button", { name: /^join$/i }));
    expect(screen.getByText(/enter the room code/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/room code/i)).toHaveAttribute("aria-invalid", "true");
    expect(h.nav).not.toHaveBeenCalled();
  });

  test("the top bar offers sign in when signed out and the account menu when signed in", () => {
    const { unmount } = render(<LandingPage />);
    expect(screen.getByRole("button", { name: /sign in/i })).toBeInTheDocument();
    unmount();
    h.auth.principal = { id: "u", kind: "user", displayName: "Una" };
    render(<LandingPage />);
    expect(screen.getByRole("button", { name: /account menu/i })).toHaveTextContent("Una");
  });
});
