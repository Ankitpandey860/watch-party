import axios from "axios";

// Base URL of the Express backend's REST API (see /backend).
// In dev this defaults to http://localhost:4000/api; override with
// VITE_API_BASE_URL for staging/production deployments.
const DEFAULT_API_BASE_URL = "http://localhost:4000/api";

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || DEFAULT_API_BASE_URL;

// Base URL of the Socket.IO server. Usually the same host as the API, minus
// the /api suffix, since both are served by the same backend process.
export const SOCKET_URL =
  import.meta.env.VITE_SOCKET_URL || API_BASE_URL.replace(/\/api\/?$/, "");

export const api = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: false,
  timeout: 15000,
});

api.interceptors.response.use(
  (r) => r,
  (error) => {
    // Normalize backend error shape ({ error: { code, message } }) into a
    // plain Error so callers can just do `catch (e) { toast(e.message) }`.
    const backendMessage = error?.response?.data?.error?.message;
    if (backendMessage) {
      const normalized = new Error(backendMessage);
      normalized.code = error.response.data.error.code;
      normalized.status = error.response.status;
      return Promise.reject(normalized);
    }
    return Promise.reject(error);
  },
);

export default api;
