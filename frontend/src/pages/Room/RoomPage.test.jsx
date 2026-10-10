import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const h = vi.hoisted(() => ({
  nav: vi.fn(),
  auth: null,
  room: null,
  svc: { getRoom: vi.fn(), joinRoom: vi.fn() },
  toast: { error: vi.fn(), success: vi.fn() },
}));
vi.mock("@tanstack/react-router", async () =>
  (await import("../../test/routerMock")).makeRouterMock({
    navigate: h.nav,
    params: () => ({ roomId: "abc234" }),
  }),
);
vi.mock("../../context/AuthContext", () => ({ useAuth: () => h.auth }));
vi.mock("../../context/RoomContext", () => ({ useRoom: () => h.room }));
vi.mock("../../services/roomService", () => ({ default: h.svc, roomService: h.svc }));
vi.mock("sonner", () => ({ toast: h.toast }));
vi.mock("../../components/Player/PlayerHost", async () => {
  const React = await import("react");
  return {
    PlayerHost: (p) =>
      React.createElement("div", {
        "data-testid": "player",
        "data-provider": String(p.provider),
        "data-playing": String(p.playing),
      }),
  };
});

import { RoomPage } from "./RoomPage";

const U = (id, over = {}) => ({
  id,
  username: id,
  role: "participant",
  kind: "user",
  online: true,
  ...over,
});
const principal = { id: "me", kind: "user", displayName: "Me" };

function makeRoom(over = {}) {
  return {
    roomId: "ABC234",
    userId: "me",
    username: "Me",
    role: "participant",
    hostId: "host",
    participants: [U("host", { role: "host" }), U("me")],
    messages: [],
    videoUrl: "",
    provider: null,
    playback: { playing: false, currentTime: 0, duration: 0, volume: 60 },
    connectionStatus: "connected",
    roomError: "",
    connectSocket: vi.fn(),
    disconnectSocket: vi.fn(),
    leaveRoom: vi.fn(),
    setRoomError: vi.fn(),
    retryConnection: vi.fn(),
    play: vi.fn(),
    pause: vi.fn(),
    seek: vi.fn(),
    changeVideo: vi.fn(),
    assignRole: vi.fn(),
    removeParticipant: vi.fn(),
    transferHost: vi.fn(),
    sendMessage: vi.fn(),
    updatePlayback: vi.fn(),
    ...over,
  };
}
const authOf = (over = {}) => ({
  status: "ready",
  slow: false,
  principal,
  isUser: true,
  providers: {},
  refresh: vi.fn().mockResolvedValue(principal),
  logout: vi.fn(),
  rename: vi.fn(),
  ...over,
});

beforeEach(() => {
  h.nav.mockReset();
  h.svc.getRoom.mockReset();
  h.svc.joinRoom.mockReset();
  h.toast.error.mockReset();
  h.auth = authOf();
  h.room = makeRoom();
  h.svc.getRoom.mockResolvedValue({
    roomId: "ABC234",
    participantCount: 2,
    maxParticipants: 30,
    full: false,
  });
  h.svc.joinRoom.mockResolvedValue({ roomId: "ABC234", principal });
});

describe("entry gate", () => {
  test("unknown room -> 'doesn't exist or has ended' with next steps", async () => {
    h.svc.getRoom.mockRejectedValue(Object.assign(new Error("x"), { status: 404 }));
    render(<RoomPage />);
    expect(await screen.findByText(/doesn't exist or has ended/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /create a room/i })).toBeInTheDocument();
    expect(h.svc.joinRoom).not.toHaveBeenCalled();
  });

  test("backend unreachable -> a retryable error, not an endless spinner", async () => {
    h.svc.getRoom.mockRejectedValue(Object.assign(new Error("x"), { status: 500 }));
    render(<RoomPage />);
    expect(await screen.findByText(/can't reach the server/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
  });

  test("auth service unreachable -> the same retryable error", async () => {
    h.auth = authOf({ status: "unreachable", principal: null });
    render(<RoomPage />);
    expect(await screen.findByText(/can't reach the server/i)).toBeInTheDocument();
  });

  test("a signed-in user is admitted WITHOUT a form: server admission first, then the socket", async () => {
    render(<RoomPage />);
    await waitFor(() => expect(h.room.connectSocket).toHaveBeenCalledWith("ABC234", principal));
    expect(h.svc.joinRoom).toHaveBeenCalledWith("ABC234", undefined);
    expect(h.svc.joinRoom.mock.invocationCallOrder[0]).toBeLessThan(
      h.room.connectSocket.mock.invocationCallOrder[0],
    );
    expect(h.room.connectSocket).toHaveBeenCalledTimes(1);
  });
});

describe("invite link (guest) flow", () => {
  beforeEach(() => {
    h.auth = authOf({ principal: null, isUser: false });
  });

  test("shows the invite with the live head-count and a name field; Join is disabled until a name is typed", async () => {
    render(<RoomPage />);
    expect(await screen.findByText(/you're invited/i)).toBeInTheDocument();
    expect(screen.getByText("ABC234")).toBeInTheDocument();
    expect(screen.getByText(/2 watching now/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /join as guest/i })).toBeDisabled();
    expect(screen.getByText(/guests can watch and chat/i)).toBeInTheDocument();
  });

  test("name -> Join: admission with the display name, then the socket; the auth state is refreshed", async () => {
    const guest = { id: "g1", kind: "guest", displayName: "Alex" };
    h.svc.joinRoom.mockResolvedValue({ roomId: "ABC234", principal: guest });
    render(<RoomPage />);
    await userEvent.type(await screen.findByLabelText(/your display name/i), "Alex");
    await userEvent.click(screen.getByRole("button", { name: /join as guest/i }));
    await waitFor(() => expect(h.svc.joinRoom).toHaveBeenCalledWith("ABC234", "Alex"));
    await waitFor(() => expect(h.room.connectSocket).toHaveBeenCalledWith("ABC234", guest));
    expect(h.auth.refresh).toHaveBeenCalled();
  });

  test("Enter in the name field submits (one-step join)", async () => {
    render(<RoomPage />);
    await userEvent.type(await screen.findByLabelText(/your display name/i), "Sam{Enter}");
    await waitFor(() => expect(h.svc.joinRoom).toHaveBeenCalledWith("ABC234", "Sam"));
  });

  test("a refusal (rate limit) is shown and the form stays so they can retry", async () => {
    h.svc.joinRoom.mockRejectedValueOnce(
      Object.assign(new Error("x"), { code: "RATE_LIMITED", retryAfterSeconds: 45 }),
    );
    render(<RoomPage />);
    await userEvent.type(await screen.findByLabelText(/your display name/i), "Alex");
    await userEvent.click(screen.getByRole("button", { name: /join as guest/i }));
    expect(await screen.findByText(/try again in 45s/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/your display name/i)).toBeInTheDocument();
    expect(h.room.connectSocket).not.toHaveBeenCalled();
  });

  test("offers sign-in instead, returning to this room afterwards", async () => {
    render(<RoomPage />);
    await userEvent.click(await screen.findByRole("button", { name: /i have an account/i }));
    expect(h.nav).toHaveBeenCalledWith({ to: "/auth", search: { returnTo: "/room/ABC234" } });
  });

  test("a full room shows 'full' instead of the form", async () => {
    h.svc.getRoom.mockResolvedValue({
      roomId: "ABC234",
      participantCount: 30,
      maxParticipants: 30,
      full: true,
    });
    render(<RoomPage />);
    expect(await screen.findByText(/this room is full/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/display name/i)).toBeNull();
  });

  test.each([
    ["BANNED", /can't join this room/i],
    ["ROOM_FULL", /this room is full/i],
  ])("admission refused with %s -> the matching screen", async (code, text) => {
    h.svc.joinRoom.mockRejectedValueOnce(Object.assign(new Error("x"), { code, status: 403 }));
    render(<RoomPage />);
    await userEvent.type(await screen.findByLabelText(/your display name/i), "Alex");
    await userEvent.click(screen.getByRole("button", { name: /join as guest/i }));
    expect(await screen.findByText(text)).toBeInTheDocument();
  });
});

describe("connection states while in the room", () => {
  test("first connect shows a spinner until the room state arrives", async () => {
    h.room = makeRoom({ connectionStatus: "connecting", participants: [] });
    render(<RoomPage />);
    expect(await screen.findByText(/connecting to the room/i)).toBeInTheDocument();
  });

  test("reconnecting keeps the room visible with a banner and a working 'Retry now'", async () => {
    h.room = makeRoom({ connectionStatus: "reconnecting" });
    render(<RoomPage />);
    const banner = await screen.findByText(/connection lost/i);
    expect(banner).toBeInTheDocument();
    expect(screen.getByTestId("player")).toBeInTheDocument();
    expect(screen.getByText("Reconnecting…")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /retry now/i }));
    expect(h.room.retryConnection).toHaveBeenCalled();
  });

  test.each([
    ["auth_expired", /your session ended/i],
    ["banned", /can't join this room/i],
    ["room_not_found", /doesn't exist or has ended/i],
    ["room_full", /this room is full/i],
    ["unauthorized", /not allowed in this room/i],
  ])("terminal state %s -> its own screen", async (status, text) => {
    h.room = makeRoom({ connectionStatus: status });
    render(<RoomPage />);
    expect(await screen.findByText(text)).toBeInTheDocument();
    expect(screen.queryByTestId("player")).toBeNull();
  });

  test("an expired session offers to sign in again and return to this room", async () => {
    h.room = makeRoom({ connectionStatus: "auth_expired" });
    render(<RoomPage />);
    await userEvent.click(await screen.findByRole("button", { name: /sign in again/i }));
    expect(h.nav).toHaveBeenCalledWith({ to: "/auth", search: { returnTo: "/room/ABC234" } });
  });

  test("server messages surface as a toast exactly once", async () => {
    h.room = makeRoom({ roomError: "Only the host can do that." });
    render(<RoomPage />);
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith("Only the host can do that."));
    expect(h.room.setRoomError).toHaveBeenCalledWith("");
  });
});

describe("the room", () => {
  test("shows the code, your role, head-count, and passes the provider/playing state to the player", async () => {
    h.room = makeRoom({
      provider: "youtube",
      videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      playback: { playing: true, currentTime: 5, duration: 100, volume: 60 },
    });
    render(<RoomPage />);
    expect(await screen.findByText("ABC234")).toBeInTheDocument();
    expect(screen.getByText(/2 people/i)).toBeInTheDocument();
    expect(screen.getByTestId("player")).toHaveAttribute("data-provider", "youtube");
    expect(screen.getByTestId("player")).toHaveAttribute("data-playing", "true");
    expect(screen.getByText("Connected")).toBeInTheDocument();
  });

  test("a participant cannot control playback or load videos (controls are disabled, with an explanation)", async () => {
    render(<RoomPage />);
    expect(await screen.findByRole("button", { name: /^play$/i })).toBeDisabled();
    expect(screen.getByLabelText(/video link/i)).toBeDisabled();
    expect(screen.getByText(/controlled by the host/i)).toBeInTheDocument();
  });

  test("the host (and moderators) can use the controls", async () => {
    for (const role of ["host", "moderator"]) {
      h.room = makeRoom({ role });
      const { unmount } = render(<RoomPage />);
      const play = await screen.findByRole("button", { name: /^play$/i });
      expect(play).toBeEnabled();
      await userEvent.click(play);
      expect(h.room.play).toHaveBeenCalled();
      expect(screen.getByLabelText(/video link/i)).toBeEnabled();
      unmount();
    }
  });

  test("only the HOST gets people-management menus (moderators do not)", async () => {
    h.room = makeRoom({ role: "host" });
    const { unmount } = render(<RoomPage />);
    await screen.findByText("ABC234");
    expect(screen.queryByRole("button", { name: /manage me/i })).toBeNull(); // never on yourself
    expect(screen.getByRole("button", { name: /manage host/i })).toBeInTheDocument();
    unmount();
    h.room = makeRoom({ role: "moderator" });
    render(<RoomPage />);
    await screen.findByText("ABC234");
    expect(screen.queryByRole("button", { name: /manage/i })).toBeNull();
  });

  test("People / Chat tabs switch panels and expose tab semantics", async () => {
    render(<RoomPage />);
    const people = await screen.findByRole("tab", { name: /people/i });
    const chat = screen.getByRole("tab", { name: /chat/i });
    expect(people).toHaveAttribute("aria-selected", "true");
    await userEvent.click(chat);
    expect(chat).toHaveAttribute("aria-selected", "true");
    expect(people).toHaveAttribute("aria-selected", "false");
    expect(screen.getByRole("tabpanel")).toBeInTheDocument();
  });

  test("Leave closes the connection and returns home", async () => {
    render(<RoomPage />);
    await userEvent.click(await screen.findByRole("button", { name: /^leave$/i }));
    expect(h.room.leaveRoom).toHaveBeenCalled();
    expect(h.nav).toHaveBeenCalledWith({ to: "/" });
  });

  test("leaving the page disconnects the socket", async () => {
    const { unmount } = render(<RoomPage />);
    await screen.findByText("ABC234");
    unmount();
    expect(h.room.disconnectSocket).toHaveBeenCalled();
  });
});
