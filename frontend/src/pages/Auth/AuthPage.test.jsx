import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const h = vi.hoisted(() => ({
  nav: vi.fn(),
  search: { returnTo: "/create", error: undefined },
  auth: null,
}));
vi.mock("@tanstack/react-router", async () =>
  (await import("../../test/routerMock")).makeRouterMock({
    navigate: h.nav,
    search: () => h.search,
  }),
);
vi.mock("../../context/AuthContext", () => ({ useAuth: () => h.auth }));

import { AuthPage } from "./AuthPage";

const baseAuth = () => ({
  status: "ready",
  slow: false,
  principal: null,
  isUser: false,
  isGuest: false,
  providers: { google: true, email: true },
  requestOtp: vi.fn().mockResolvedValue({ ok: true, resendAfterSeconds: 60 }),
  verifyOtp: vi.fn().mockResolvedValue({ id: "u", kind: "user", displayName: "U" }),
  refresh: vi.fn(),
  logout: vi.fn(),
  rename: vi.fn(),
  googleStartUrl: (r) => `http://api.test/auth/google/start?returnTo=${encodeURIComponent(r)}`,
});

beforeEach(() => {
  h.nav.mockReset();
  h.search = { returnTo: "/create", error: undefined };
  h.auth = baseAuth();
});
afterEach(() => vi.useRealTimers());

const setup = () => ({ user: userEvent.setup() });

describe("choose a method", () => {
  test("offers Google (a real link carrying the returnTo) and email, as configured by the server", () => {
    render(<AuthPage />);
    const g = screen.getByRole("link", { name: /continue with google/i });
    expect(g).toHaveAttribute("href", "http://api.test/auth/google/start?returnTo=%2Fcreate");
    expect(screen.getByRole("button", { name: /continue with email/i })).toBeInTheDocument();
    expect(screen.getByText(/joining a friend's room never does/i)).toBeInTheDocument();
  });

  test("a method the server does not offer is NOT shown (no fake buttons)", () => {
    h.auth.providers = { google: false, email: true };
    const { rerender } = render(<AuthPage />);
    expect(screen.queryByRole("link", { name: /google/i })).toBeNull();
    h.auth.providers = { google: true, email: false };
    rerender(<AuthPage />);
    expect(screen.queryByRole("button", { name: /email/i })).toBeNull();
    h.auth.providers = { google: false, email: false };
    rerender(<AuthPage />);
    expect(screen.getByRole("alert")).toHaveTextContent(/isn't configured/i);
  });

  test.each([
    ["cancelled", /cancelled/i],
    ["oauth_failed", /didn't complete/i],
    ["email_unverified", /isn't verified/i],
    ["google_unavailable", /isn't available/i],
    ["something_else", /sign-in failed/i],
  ])("?error=%s from the Google redirect is explained", (error, text) => {
    h.search = { returnTo: "/", error };
    render(<AuthPage />);
    expect(screen.getByRole("alert")).toHaveTextContent(text);
  });
});

describe("email code flow", () => {
  async function toEmailStep(user) {
    await user.click(screen.getByRole("button", { name: /continue with email/i }));
    return screen.getByLabelText(/email address/i);
  }

  test("rejects an invalid email locally without calling the server", async () => {
    const { user } = setup();
    render(<AuthPage />);
    await user.type(await toEmailStep(user), "nope");
    await user.click(screen.getByRole("button", { name: /email me a code/i }));
    expect(screen.getByText(/enter a valid email/i)).toBeInTheDocument();
    expect(h.auth.requestOtp).not.toHaveBeenCalled();
  });

  test("requests a code (trimmed email), then shows the code step", async () => {
    const { user } = setup();
    render(<AuthPage />);
    await user.type(await toEmailStep(user), "  me@example.com ");
    await user.click(screen.getByRole("button", { name: /email me a code/i }));
    expect(h.auth.requestOtp).toHaveBeenCalledWith("me@example.com");
    expect(await screen.findByText(/check your email/i)).toBeInTheDocument();
    expect(screen.getByText("me@example.com")).toBeInTheDocument();
  });

  test("the code field is numeric-only, one-time-code autofill, max 6; Verify stays disabled until 6 digits", async () => {
    const { user } = setup();
    render(<AuthPage />);
    await user.type(await toEmailStep(user), "me@example.com");
    await user.click(screen.getByRole("button", { name: /email me a code/i }));
    const code = await screen.findByLabelText(/6-digit code/i);
    expect(code).toHaveAttribute("autocomplete", "one-time-code");
    expect(code).toHaveAttribute("inputmode", "numeric");
    await user.type(code, "12ab34cd56789");
    expect(code).toHaveValue("123456");
    const verify = screen.getByRole("button", { name: /verify/i });
    expect(verify).toBeEnabled();
    await user.clear(code);
    await user.type(code, "123");
    expect(verify).toBeDisabled();
  });

  test("a correct code signs in and continues to returnTo", async () => {
    const { user } = setup();
    h.search = { returnTo: "/room/ABC234" };
    render(<AuthPage />);
    await user.type(await toEmailStep(user), "me@example.com");
    await user.click(screen.getByRole("button", { name: /email me a code/i }));
    await user.type(await screen.findByLabelText(/6-digit code/i), "123456");
    await user.click(screen.getByRole("button", { name: /verify/i }));
    expect(h.auth.verifyOtp).toHaveBeenCalledWith("me@example.com", "123456");
    await waitFor(() => expect(h.nav).toHaveBeenCalledWith({ to: "/room/ABC234" }));
  });

  test("a wrong/expired code shows the server's message, keeps the form, and allows retrying", async () => {
    const { user } = setup();
    h.auth.verifyOtp.mockRejectedValueOnce(
      Object.assign(new Error("That code is incorrect or has expired."), { code: "INVALID_CODE" }),
    );
    render(<AuthPage />);
    await user.type(await toEmailStep(user), "me@example.com");
    await user.click(screen.getByRole("button", { name: /email me a code/i }));
    await user.type(await screen.findByLabelText(/6-digit code/i), "000000");
    await user.click(screen.getByRole("button", { name: /verify/i }));
    expect(await screen.findByText(/incorrect or has expired/i)).toBeInTheDocument();
    expect(h.nav).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /verify/i })).toBeEnabled();
  });

  test("rate limiting is explained with the wait time", async () => {
    const { user } = setup();
    h.auth.requestOtp.mockRejectedValueOnce(
      Object.assign(new Error("x"), { code: "RATE_LIMITED", retryAfterSeconds: 120 }),
    );
    render(<AuthPage />);
    await user.type(await toEmailStep(user), "me@example.com");
    await user.click(screen.getByRole("button", { name: /email me a code/i }));
    expect(await screen.findByText(/try again in 120 seconds/i)).toBeInTheDocument();
  });

  test("an email-delivery failure is shown without leaking details", async () => {
    const { user } = setup();
    h.auth.requestOtp.mockRejectedValueOnce(
      Object.assign(new Error("We couldn't send the email. Please try again shortly."), {
        code: "EMAIL_UNAVAILABLE",
      }),
    );
    render(<AuthPage />);
    await user.type(await toEmailStep(user), "me@example.com");
    await user.click(screen.getByRole("button", { name: /email me a code/i }));
    expect(await screen.findByText(/couldn't send the email/i)).toBeInTheDocument();
  });

  test("resend is disabled during the cooldown, counts down, then re-requests a code", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    h.auth.requestOtp.mockResolvedValue({ ok: true, resendAfterSeconds: 3 });
    render(<AuthPage />);
    await user.type(await toEmailStep(user), "me@example.com");
    await user.click(screen.getByRole("button", { name: /email me a code/i }));
    const resend = await screen.findByRole("button", { name: /resend in 3s/i });
    expect(resend).toBeDisabled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3100);
    });
    const ready = screen.getByRole("button", { name: /resend code/i });
    expect(ready).toBeEnabled();
    await user.click(ready);
    expect(h.auth.requestOtp).toHaveBeenCalledTimes(2);
  });

  test("'use a different email' goes back to the email step", async () => {
    const { user } = setup();
    render(<AuthPage />);
    await user.type(await toEmailStep(user), "me@example.com");
    await user.click(screen.getByRole("button", { name: /email me a code/i }));
    await user.click(await screen.findByRole("button", { name: /use a different email/i }));
    expect(screen.getByLabelText(/email address/i)).toBeInTheDocument();
  });
});

describe("other states", () => {
  test("loading (with a 'waking the server' hint when slow)", () => {
    h.auth.status = "loading";
    const { rerender } = render(<AuthPage />);
    expect(screen.getByRole("status")).toHaveTextContent(/loading/i);
    h.auth.slow = true;
    rerender(<AuthPage />);
    expect(screen.getByRole("status")).toHaveTextContent(/waking up the server/i);
  });

  test("server unreachable offers a retry", async () => {
    const { user } = setup();
    h.auth.status = "unreachable";
    render(<AuthPage />);
    await user.click(screen.getByRole("button", { name: /try again/i }));
    expect(h.auth.refresh).toHaveBeenCalled();
  });

  test("already signed in: shows who you are with Continue / Sign out", async () => {
    const { user } = setup();
    h.auth.isUser = true;
    h.auth.principal = { id: "u", kind: "user", displayName: "Una" };
    render(<AuthPage />);
    expect(screen.getByText(/signed in as/i)).toHaveTextContent("Una");
    await user.click(screen.getByRole("button", { name: /continue/i }));
    expect(h.nav).toHaveBeenCalledWith({ to: "/create" });
    await user.click(screen.getByRole("button", { name: /sign out/i }));
    expect(h.auth.logout).toHaveBeenCalled();
  });
});
