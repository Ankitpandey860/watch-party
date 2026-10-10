import axios from "axios";

const env = import.meta.env;

// REST base URL.
//  - Production (Vercel): "/api". Vercel rewrites /api/* to the Render backend, so the browser sees
//    ONE origin and the session cookie is first-party (see docs/DEPLOYMENT.md).
//  - Development: the backend on http://localhost:4000 (same-site as the Vite dev server).
export const API_BASE_URL =
  env.VITE_API_BASE_URL || (env.PROD ? "/api" : "http://localhost:4000/api");

// Socket.IO connects straight to the backend (Vercel rewrites do not carry WebSockets). It does not
// use cookies: it presents a one-time ticket obtained over REST.
export const SOCKET_URL =
  env.VITE_SOCKET_URL ||
  (/^https?:/.test(API_BASE_URL)
    ? API_BASE_URL.replace(/\/api\/?$/, "")
    : typeof window !== "undefined"
      ? window.location.origin
      : "");

export const api = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true, // send/receive the HttpOnly session cookie
  timeout: 30_000, // a free Render instance can take ~1 minute to wake; reads are retried below
  headers: { "X-Requested-With": "watchparty" }, // required by the backend's CSRF guard
});

const RETRYABLE = new Set([502, 503, 504]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

api.interceptors.response.use(
  (r) => r,
  async (error) => {
    const config = error?.config;
    const status = error?.response?.status;
    // Idempotent reads are retried while the backend wakes up (network error / gateway timeout).
    if (
      config &&
      (config.method || "get").toLowerCase() === "get" &&
      (!error.response || RETRYABLE.has(status))
    ) {
      config.__retries = (config.__retries || 0) + 1;
      if (config.__retries <= 2) {
        await sleep(config.__retries * 1500);
        return api(config);
      }
    }
    const body = error?.response?.data?.error;
    if (body?.message) {
      // Normalise { error: { code, message } } into a plain Error callers can toast directly.
      const normalized = new Error(body.message);
      normalized.code = body.code;
      normalized.status = status;
      if (body.retryAfterSeconds) normalized.retryAfterSeconds = body.retryAfterSeconds;
      return Promise.reject(normalized);
    }
    const generic = new Error(
      error.response
        ? "Something went wrong. Please try again."
        : "Can't reach the server. Check your connection and try again.",
    );
    generic.status = status;
    generic.code = error.response ? "SERVER_ERROR" : "NETWORK_ERROR";
    return Promise.reject(generic);
  },
);

/** Pings the backend early so a sleeping free-tier instance starts waking before the user acts. */
export function warmUpBackend() {
  return api.get("/health", { timeout: 75_000 }).catch(() => {});
}

export default api;
