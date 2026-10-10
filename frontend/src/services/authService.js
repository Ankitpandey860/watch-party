import api, { API_BASE_URL } from "./api";

// Auth calls. The session itself is an HttpOnly cookie the browser manages; nothing secret is ever
// readable from JavaScript, and no auth token is stored in localStorage/sessionStorage.
export const authService = {
  /** -> { principal: { id, kind, displayName } | null, providers: { google, email } } */
  async me() {
    const { data } = await api.get("/auth/me");
    return data;
  },

  /** Invite-link identity (watch + chat only). */
  async guest(displayName) {
    const { data } = await api.post("/auth/guest", { displayName });
    return data.principal;
  },

  async rename(displayName) {
    const { data } = await api.patch("/auth/me", { displayName });
    return data.principal;
  },

  async requestOtp(email) {
    const { data } = await api.post("/auth/otp/request", { email });
    return data; // { ok, resendAfterSeconds }
  },

  async verifyOtp(email, code) {
    const { data } = await api.post("/auth/otp/verify", { email, code });
    return data.principal;
  },

  async logout() {
    await api.post("/auth/logout");
  },

  /** Google sign-in is a full-page navigation (the backend runs the OAuth redirect flow). */
  googleStartUrl(returnTo = "/") {
    return `${API_BASE_URL}/auth/google/start?returnTo=${encodeURIComponent(returnTo)}`;
  },
};

export default authService;
