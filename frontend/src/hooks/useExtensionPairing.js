import { useCallback, useEffect, useRef, useState } from "react";
import extensionService from "../services/extensionService";

const POLL_MS = 5000;

/**
 * Pairing state for the signed-in seat in `roomId`: { status, code, expiresIn, busy, error } plus
 * pair() / revoke(). `status` is polled while the panel is mounted so the UI reflects the extension
 * connecting, dropping or being revoked. All failures become a message; nothing throws into React.
 */
export function useExtensionPairing(roomId, { enabled = true } = {}) {
  const [status, setStatus] = useState({
    paired: false,
    connected: false,
    label: null,
    expiresAt: null,
  });
  const [code, setCode] = useState(null); // { code, expiresAt(ms) }
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    if (!roomId) return;
    try {
      const s = await extensionService.status(roomId);
      if (alive.current) setStatus(s);
    } catch {
      /* transient; the next poll retries */
    }
  }, [roomId]);

  useEffect(() => {
    if (!enabled || !roomId) return undefined;
    refresh();
    const id = setInterval(refresh, POLL_MS);
    return () => clearInterval(id);
  }, [enabled, roomId, refresh]);

  // Countdown for the displayed code; it disappears when it expires (codes are single-use + short-lived).
  useEffect(() => {
    if (!code) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [code]);
  useEffect(() => {
    if (code && now >= code.expiresAt) setCode(null);
  }, [code, now]);
  // Once the extension has used the code (status flips to paired) the code is spent: stop showing it.
  useEffect(() => {
    if (status.paired && code) setCode(null);
  }, [status.paired]);

  const pair = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const out = await extensionService.createPairingCode(roomId);
      if (!alive.current) return;
      setNow(Date.now());
      setCode({ code: out.code, expiresAt: Date.now() + (out.expiresInSeconds || 120) * 1000 });
    } catch (e) {
      if (alive.current) setError(e?.message || "Couldn't create a pairing code.");
    } finally {
      if (alive.current) setBusy(false);
    }
  }, [roomId]);

  const revoke = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      await extensionService.revoke(roomId);
      if (!alive.current) return;
      setCode(null);
      await refresh();
    } catch (e) {
      if (alive.current) setError(e?.message || "Couldn't revoke the pairing.");
    } finally {
      if (alive.current) setBusy(false);
    }
  }, [roomId, refresh]);

  return {
    status,
    code: code?.code || null,
    expiresIn: code ? Math.max(0, Math.round((code.expiresAt - now) / 1000)) : 0,
    busy,
    error,
    pair,
    revoke,
    refresh,
  };
}

export default useExtensionPairing;
