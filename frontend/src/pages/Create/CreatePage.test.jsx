import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const h = vi.hoisted(() => ({ nav: vi.fn(), auth: null, create: vi.fn() }));
vi.mock("@tanstack/react-router", async () =>
  (await import("../../test/routerMock")).makeRouterMock({ navigate: h.nav }),
);
vi.mock("../../context/AuthContext", () => ({ useAuth: () => h.auth }));
vi.mock("../../services/roomService", () => ({
  default: { createRoom: h.create },
  roomService: { createRoom: h.create },
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { CreatePage } from "./CreatePage";

const user = { id: "u", kind: "user", displayName: "Una" };
beforeEach(() => {
  h.nav.mockReset();
  h.create.mockReset();
  h.auth = {
    status: "ready",
    principal: user,
    isUser: true,
    logout: vi.fn(),
    rename: vi.fn(),
    providers: {},
  };
});

describe("CreatePage", () => {
  test("signed in: creates the room and opens it as host", async () => {
    h.create.mockResolvedValue({ roomId: "ABC234" });
    render(<CreatePage />);
    expect(screen.getByRole("heading", { name: /ready, una/i })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /create room/i }));
    await waitFor(() =>
      expect(h.nav).toHaveBeenCalledWith({ to: "/room/$roomId", params: { roomId: "ABC234" } }),
    );
  });

  test("signed out: bounced to sign-in with a return path (replace, so Back works)", async () => {
    h.auth.principal = null;
    h.auth.isUser = false;
    render(<CreatePage />);
    await waitFor(() =>
      expect(h.nav).toHaveBeenCalledWith({
        to: "/auth",
        search: { returnTo: "/create" },
        replace: true,
      }),
    );
  });

  test("a guest cannot host: explains why and offers sign-in", async () => {
    h.auth.principal = { id: "g", kind: "guest", displayName: "G" };
    h.auth.isUser = false;
    render(<CreatePage />);
    expect(screen.getByText(/guests can't host/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /sign in to host/i }));
    expect(h.nav).toHaveBeenCalledWith({ to: "/auth", search: { returnTo: "/create" } });
    expect(screen.queryByRole("button", { name: /create room/i })).toBeNull();
  });

  test("server refusals are shown (open-room cap, rate limit) and the button recovers", async () => {
    h.create.mockRejectedValueOnce(
      Object.assign(new Error("You already have the maximum number of open rooms."), {
        code: "ROOM_LIMIT",
      }),
    );
    render(<CreatePage />);
    await userEvent.click(screen.getByRole("button", { name: /create room/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/maximum number of open rooms/i);
    expect(screen.getByRole("button", { name: /create room/i })).toBeEnabled();
    h.create.mockRejectedValueOnce(
      Object.assign(new Error("x"), { code: "RATE_LIMITED", retryAfterSeconds: 30 }),
    );
    await userEvent.click(screen.getByRole("button", { name: /create room/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/try again in 30s/i);
  });

  test("loading and unreachable states", () => {
    h.auth.status = "loading";
    h.auth.principal = null;
    h.auth.isUser = false;
    const { rerender } = render(<CreatePage />);
    expect(screen.getByRole("status", { name: /loading/i })).toBeInTheDocument();
    h.auth.status = "unreachable";
    rerender(<CreatePage />);
    expect(screen.getByText(/can't reach the server/i)).toBeInTheDocument();
  });
});
