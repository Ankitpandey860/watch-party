import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import socketService from "../services/socketService";
import roomService from "../services/roomService";
import providerRegistry from "../providers";

/**
 * Live room state, mirrored from the server (the single source of truth). Identity and roles are
 * NEVER taken from the client: `you` in the server's room_state is authoritative.
 *
 * connectionStatus:
 *   idle | connecting | connected | reconnecting          (normal lifecycle)
 *   room_not_found | room_full | banned | auth_expired | unauthorized   (terminal: UI shows a screen)
 */
const RoomContext = createContext(null);

const MAX_STORED_MESSAGES = 100;
const DEFAULT_PLAYBACK = { playing: false, currentTime: 0, duration: 0, volume: 60, rate: 1 };
const DEFAULT_SETTINGS = { maxModerators: 3, moderatorsCanControl: true };
const TERMINAL = new Set(["room_not_found", "room_full", "banned", "auth_expired", "unauthorized"]);

// Server error code -> terminal screen (only when we are not already in the room).
const CODE_TO_STATUS = {
  ROOM_NOT_FOUND: "room_not_found",
  ROOM_FULL: "room_full",
  BANNED: "banned",
  NOT_AUTHORIZED: "unauthorized",
};

export function RoomProvider({ children }) {
  const [roomId, setRoomId] = useState("");
  const [userId, setUserId] = useState("");
  const [username, setUsername] = useState("");
  const [role, setRole] = useState("participant");
  const [hostId, setHostId] = useState("");
  const [participants, setParticipants] = useState([]);
  const [messages, setMessages] = useState([]);
  const [videoUrl, setVideoUrl] = useState("");
  const [provider, setProvider] = useState(null);
  const [mediaParams, setMediaParams] = useState(null);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [playback, setPlayback] = useState(DEFAULT_PLAYBACK);
  const [connectionStatus, setConnectionStatus] = useState("idle");
  const [roomError, setRoomError] = useState("");
  const [syncSeq, setSyncSeq] = useState(0);
  const [driftSeq, setDriftSeq] = useState(0);

  const lastSeqRef = useRef(-1);
  // Which title the room is on RIGHT NOW. Sent with commands so the server can refuse one that was
  // meant for a previous title (stale-command protection).
  const mediaRefRef = useRef(null);
  const statusRef = useRef("idle");
  const userIdRef = useRef("");
  const unsubscribersRef = useRef([]);

  const setStatus = useCallback((next) => {
    statusRef.current = next;
    setConnectionStatus(next);
  }, []);

  const bumpSync = useCallback(() => setSyncSeq((n) => n + 1), []);
  const bumpDrift = useCallback(() => setDriftSeq((n) => n + 1), []);

  const applyVideo = useCallback((providerId, videoId, params) => {
    const id = videoId ? providerId || "youtube" : null;
    setProvider(id);
    setMediaParams(videoId ? params || null : null);
    setVideoUrl(videoId ? providerRegistry.urlFor(providerId, videoId, params) : "");
    mediaRefRef.current = id ? { provider: id, mediaId: videoId } : null;
  }, []);

  const clearListeners = useCallback(() => {
    unsubscribersRef.current.forEach((off) => off());
    unsubscribersRef.current = [];
  }, []);

  const resetRoomState = useCallback(() => {
    setRoomId("");
    setUserId("");
    userIdRef.current = "";
    setUsername("");
    setRole("participant");
    setHostId("");
    setParticipants([]);
    setMessages([]);
    setVideoUrl("");
    setProvider(null);
    setMediaParams(null);
    setSettings(DEFAULT_SETTINGS);
    mediaRefRef.current = null;
    setPlayback(DEFAULT_PLAYBACK);
    lastSeqRef.current = -1;
    setStatus("idle");
    setRoomError("");
  }, [setStatus]);

  const disconnectSocket = useCallback(() => {
    clearListeners();
    socketService.disconnect();
  }, [clearListeners]);

  /** Opens the socket for a room. `principal` is only used to label the UI until room_state arrives. */
  const connectSocket = useCallback(
    (targetRoomId, principal) => {
      clearListeners();
      setRoomId(targetRoomId);
      if (principal) {
        setUserId(principal.id);
        userIdRef.current = principal.id;
        setUsername(principal.displayName);
      }
      lastSeqRef.current = -1;
      setStatus("connecting");
      socketService.connect(targetRoomId);

      const on = (event, handler) =>
        unsubscribersRef.current.push(socketService.on(event, handler));
      const setRoster = (data) => setParticipants(data?.participants || []);

      // ---- connection lifecycle -------------------------------------------------------------
      on("disconnect", (reason) => {
        if (TERMINAL.has(statusRef.current) || reason === "io client disconnect") return;
        setStatus("reconnecting");
      });
      on("connect_error", () => {
        if (TERMINAL.has(statusRef.current)) return;
        const failure = socketService.lastTicketFailure;
        if (failure?.status === 404) return setStatus("room_not_found");
        if (failure?.status === 403)
          return setStatus(failure.code === "BANNED" ? "banned" : "unauthorized");
        if (failure?.status === 401) return setStatus("auth_expired");
        setStatus(
          statusRef.current === "connected" || statusRef.current === "reconnecting"
            ? "reconnecting"
            : "connecting",
        );
      });
      on("auth_expired", ({ reason } = {}) => {
        if (reason === "rotated") {
          // The user signed in again (new session): quietly reconnect with a fresh ticket.
          setStatus("reconnecting");
          setTimeout(() => socketService.reconnect(), 150);
          return;
        }
        setStatus("auth_expired");
      });

      // ---- room state ---------------------------------------------------------------------------
      on("room_state", (data) => {
        setRoster(data);
        setMessages(data.messages || []);
        setHostId(data.hostId || "");
        if (data.you) {
          setRole(data.you.role);
          setUserId(data.you.id);
          userIdRef.current = data.you.id;
          setUsername(data.you.username);
        }
        if (data.settings) setSettings((s) => ({ ...s, ...data.settings }));
        const cv = data.currentVideo;
        if (cv) {
          applyVideo(cv.provider, cv.videoId, cv.mediaParams);
          setPlayback((p) => ({
            ...p,
            playing: cv.playing,
            currentTime: cv.currentTime,
            rate: typeof cv.rate === "number" ? cv.rate : 1,
          }));
          if (typeof cv.seq === "number") lastSeqRef.current = cv.seq;
        }
        setStatus("connected");
        setRoomError("");
        bumpSync();
      });

      on("participants_updated", setRoster);
      on("user_joined", setRoster);
      on("user_left", setRoster);
      on("participant_removed", setRoster);

      on("role_assigned", (data) => {
        setRoster(data);
        if (data.userId === userIdRef.current) setRole(data.role);
      });

      on("host_changed", (data) => {
        setRoster(data);
        setHostId(data.hostId || "");
        const me = (data.participants || []).find((p) => p.id === userIdRef.current);
        if (me) setRole(me.role); // the server's roster is authoritative
      });

      on("removed_from_room", () => {
        setStatus("banned");
      });

      // ---- playback ---------------------------------------------------------------------------
      on("sync_state", (data) => {
        // Drop anything not newer than what we already applied (reordered / duplicate events).
        if (typeof data.seq === "number") {
          if (data.seq <= lastSeqRef.current) return;
          lastSeqRef.current = data.seq;
        }
        applyVideo(data.provider, data.videoId, data.mediaParams);
        setPlayback((p) => ({
          ...p,
          playing: data.playing,
          currentTime: data.currentTime,
          rate: typeof data.rate === "number" ? data.rate : 1,
        }));
        // "periodic" pings only nudge drift; every other reason is a command to apply immediately.
        if (data.reason === "periodic") bumpDrift();
        else bumpSync();
      });

      on("room_settings", (data) => {
        if (data?.settings) setSettings((s) => ({ ...s, ...data.settings }));
      });

      on("new_message", (message) => {
        if (!message) return;
        setMessages((prev) => [...prev, message].slice(-MAX_STORED_MESSAGES));
      });

      on("error_event", (err) => {
        const code = err?.code;
        const terminal = CODE_TO_STATUS[code];
        // Before we are in the room these mean "you can't be here"; afterwards they are just a toast.
        if (terminal && statusRef.current !== "connected") {
          setStatus(terminal);
          return;
        }
        if (code === "RATE_LIMITED") {
          setRoomError("You're doing that too fast. Slow down for a moment.");
          return;
        }
        setRoomError(err?.message || "Something went wrong.");
      });
    },
    [applyVideo, bumpDrift, bumpSync, clearListeners, setStatus],
  );

  const retryConnection = useCallback(() => {
    if (!roomId) return;
    connectSocket(roomId);
  }, [roomId, connectSocket]);

  const leaveRoom = useCallback(() => {
    disconnectSocket();
    resetRoomState();
  }, [disconnectSocket, resetRoomState]);

  useEffect(() => () => clearListeners(), [clearListeners]);

  // ---- outgoing actions (event names + payload shapes are the wire contract) --------------------
  // Playback commands carry the title they were issued for (`ref`) once one is loaded; the server
  // rejects a command whose ref is not the room's current title. With no title they stay bare.
  const withRef = (payload) =>
    mediaRefRef.current ? { ...payload, ref: mediaRefRef.current } : payload;
  const play = useCallback(
    () =>
      mediaRefRef.current ? socketService.emit("play", withRef({})) : socketService.emit("play"),
    [],
  );
  const pause = useCallback(
    () =>
      mediaRefRef.current ? socketService.emit("pause", withRef({})) : socketService.emit("pause"),
    [],
  );
  const seek = useCallback((time) => socketService.emit("seek", withRef({ time })), []);
  const setRate = useCallback((rate) => socketService.emit("set_rate", withRef({ rate })), []);
  // Position reports carry the sequence number they were based on; the server drops stale ones.
  const syncTime = useCallback(
    (time) => socketService.emit("time_sync", { time, seq: lastSeqRef.current }),
    [],
  );
  // `providerHint` (optional) pins the provider, which also makes bare ids (e.g. a Vimeo number) unambiguous.
  const changeVideo = useCallback(
    (url, providerHint) =>
      socketService.emit("change_video", providerHint ? { url, provider: providerHint } : { url }),
    [],
  );
  // Host-only on the server: { moderatorsCanControl?: boolean, maxModerators?: 0..10 }.
  const updateSettings = useCallback(
    (patch) => socketService.emit("update_room_settings", patch),
    [],
  );
  // Informational: tells the room whether THIS player is ready / blocked / on the wrong title.
  const reportPlayerStatus = useCallback(
    (status) => socketService.emit("player_status", withRef({ status })),
    [],
  );
  const assignRole = useCallback(
    (id, newRole) => socketService.emit("assign_role", { userId: id, role: newRole }),
    [],
  );
  const removeParticipant = useCallback(
    (id) => socketService.emit("remove_participant", { userId: id }),
    [],
  );
  const transferHost = useCallback((id) => socketService.emit("transfer_host", { userId: id }), []);
  const sendMessage = useCallback((message) => socketService.emit("send_message", { message }), []);

  // Local-only playback fields (volume, duration, ticking position) that never go over the wire.
  const updatePlayback = useCallback((patch) => setPlayback((p) => ({ ...p, ...patch })), []);

  const value = useMemo(
    () => ({
      roomId,
      userId,
      username,
      role,
      hostId,
      participants,
      messages,
      videoUrl,
      provider,
      mediaParams,
      settings,
      playback,
      connectionStatus,
      roomError,
      syncSeq,
      driftSeq,
      setRoomError,
      connectSocket,
      retryConnection,
      disconnectSocket,
      leaveRoom,
      play,
      pause,
      seek,
      setRate,
      syncTime,
      changeVideo,
      updateSettings,
      reportPlayerStatus,
      assignRole,
      removeParticipant,
      transferHost,
      sendMessage,
      updatePlayback,
      createRoom: roomService.createRoom,
    }),
    [
      roomId,
      userId,
      username,
      role,
      hostId,
      participants,
      messages,
      videoUrl,
      provider,
      mediaParams,
      settings,
      playback,
      connectionStatus,
      roomError,
      syncSeq,
      driftSeq,
      connectSocket,
      retryConnection,
      disconnectSocket,
      leaveRoom,
      play,
      pause,
      seek,
      setRate,
      syncTime,
      changeVideo,
      updateSettings,
      reportPlayerStatus,
      assignRole,
      removeParticipant,
      transferHost,
      sendMessage,
      updatePlayback,
    ],
  );

  return <RoomContext.Provider value={value}>{children}</RoomContext.Provider>;
}

export function useRoom() {
  const ctx = useContext(RoomContext);
  if (!ctx) throw new Error("useRoom must be used inside <RoomProvider>");
  return ctx;
}

export default RoomContext;
