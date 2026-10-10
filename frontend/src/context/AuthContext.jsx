import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import authService from "../services/authService";
import { warmUpBackend } from "../services/api";

const AuthContext = createContext(null);

/**
 * Who is signed in. The session is an HttpOnly cookie, so the only thing the page can learn is
 * the public principal returned by GET /auth/me. status: "loading" | "ready" | "unreachable".
 */
export function AuthProvider({ children }) {
  const [status, setStatus] = useState("loading");
  const [principal, setPrincipal] = useState(null);
  const [providers, setProviders] = useState({ google: false, email: false });
  const [slow, setSlow] = useState(false); // true while a (free-tier) backend is probably waking up
  const started = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const data = await authService.me();
      setPrincipal(data.principal);
      setProviders(data.providers || { google: false, email: false });
      setStatus("ready");
      return data.principal;
    } catch {
      setStatus("unreachable");
      return null;
    } finally {
      setSlow(false);
    }
  }, []);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    warmUpBackend();
    const t = setTimeout(() => setSlow(true), 3000);
    refresh().finally(() => clearTimeout(t));
  }, [refresh]);

  const verifyOtp = useCallback(async (email, code) => {
    const p = await authService.verifyOtp(email, code);
    setPrincipal(p);
    return p;
  }, []);

  const continueAsGuest = useCallback(async (displayName) => {
    const p = await authService.guest(displayName);
    setPrincipal(p);
    return p;
  }, []);

  const rename = useCallback(async (displayName) => {
    const p = await authService.rename(displayName);
    setPrincipal(p);
    return p;
  }, []);

  const logout = useCallback(async () => {
    try {
      await authService.logout();
    } finally {
      setPrincipal(null);
    }
  }, []);

  const value = useMemo(
    () => ({
      status,
      slow,
      principal,
      providers,
      isUser: principal?.kind === "user",
      isGuest: principal?.kind === "guest",
      refresh,
      setPrincipal,
      requestOtp: authService.requestOtp,
      verifyOtp,
      continueAsGuest,
      rename,
      logout,
      googleStartUrl: authService.googleStartUrl,
    }),
    [status, slow, principal, providers, refresh, verifyOtp, continueAsGuest, rename, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}

export default AuthContext;
