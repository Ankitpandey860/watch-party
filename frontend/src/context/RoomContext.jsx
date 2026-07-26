import { createContext, useContext, useMemo, useState, useCallback, useRef } from "react";
import { roomService } from "../services/roomService";
import { socketService } from "../services/socketService";

const RoomContext = createContext(null);

const SESSION_PREFIX = "watchparty:";

function saveSession(roomId, session) {
  try {
    sessionStorage.setItem(`${SESSION_PREFIX}${roomId}`, JSON.stringify(session));
  } catch {
    // sessionStorage can throw in private-browsing/quota-exceeded edge cases — non-fatal.
  }
}

function readSession(roomId) {
  try {
    const raw = sessionStorage.getItem(`${SESSION_PREFIX}${roomId}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function clearSession(roomId) {
  try {
    sessionStorage.removeItem(`${SESSION_PREFIX}${roomId}`);
  } catch {
    // ignore
  }
}

function videoIdToUrl(videoId) {
  return videoId ? `https://www.youtube.com/watch?v=${videoId}` : "";
}

export function RoomProvider({ children }) {
  const [username, setUsername] = useState("");
  const [roomId, setRoomId] = useState("");
  const [userId, setUserId] = useState("");
  const [role, setRole] = useState("participant"); // 'host' | 'moderator' | 'participant'
  const [participants, setParticipants] = useState([]);
  const [videoUrl, setVideoUrl] = useState("");
  const [playback, setPlayback] = useState({
    playing: false,
    currentTime: 0,
    duration: 0, // set from the real YouTube player once it loads (see Player.jsx)
    volume: 60,
  });
  // Bumped every time an *authoritative* playback update arrives from the
  // server (room_state on join, sync_state on play/pause/seek/change_video).
  // Player.jsx watches this (not `playback.currentTime` directly) to know
  // when to imperatively seek/play/pause the real IFrame player — local
  // progress-tick updates to `playback.currentTime` do NOT bump this, so they
  // never cause a feedback loop.
  const [syncSeq, setSyncSeq] = useState(0);
  // Chat history for the room, oldest first. Seeded from `room_state` on
  // join/reconnect (the server includes the last 100 messages there) and
  // appended to as `new_message` events arrive.
  const [messages, setMessages] = useState([]);
  // Bumped only for periodic time_sync pings (see Player.jsx) — a *soft*
  // signal meaning "re-check drift", as opposed to syncSeq which means
  // "apply this play/pause/seek command". Kept separate so a periodic ping
  // never triggers a redundant playVideo()/pauseVideo() call.
  const [driftSeq, setDriftSeq] = useState(0);
  // Tracks the highest playback `seq` we've applied so a stale sync_state
  // (delivered out of order, e.g. over a polling-transport fallback) can be
  // detected and ignored instead of overwriting newer state (Bug 1).
  const lastSeqRef = useRef(-1);
  const [connectionStatus, setConnectionStatus] = useState("idle"); // idle|connecting|connected|error
  const [roomError, setRoomError] = useState("");
  // Set when RoomPage redirects home due to no valid session for the room in
  // the URL — lets JoinRoomCard pre-fill the room code the user tried to open.
  const [joinCodePrefill, setJoinCodePrefill] = useState("");

  // Guards against double-subscribing socket listeners (e.g. React StrictMode
  // double-invoking effects in dev, or a fast unmount/remount).
  const listenersBoundRef = useRef(false);

  const updatePlayback = useCallback((patch) => {
    setPlayback((p) => ({ ...p, ...patch }));
  }, []);

  // Marks the *next* playback values as an authoritative command the real
  // player must apply (as opposed to a local progress tick).
  const bumpSync = useCallback(() => setSyncSeq((s) => s + 1), []);
  const bumpDrift = useCallback(() => setDriftSeq((s) => s + 1), []);

  const applyRoomState = useCallback((state) => {
    setParticipants(state.participants || []);
    setMessages(Array.isArray(state.messages) ? state.messages : []);
    setVideoUrl(videoIdToUrl(state.currentVideo?.videoId));
    updatePlayback({
      playing: Boolean(state.currentVideo?.playing),
      currentTime: state.currentVideo?.currentTime || 0,
    });
    if (typeof state.currentVideo?.seq === "number") {
      lastSeqRef.current = state.currentVideo.seq;
    }
    bumpSync();
    if (state.you) setRole(state.you.role);
  }, [updatePlayback, bumpSync]);

  // ---- Identity: create or join a room via REST, before ever touching the socket ----

  const createRoomAndEnter = useCallback(async (name) => {
    const result = await roomService.createRoom({ username: name });
    setUsername(result.username);
    setRoomId(result.roomId);
    setUserId(result.userId);
    setRole(result.role);
    saveSession(result.roomId, result);
    return result.roomId;
  }, []);

  const joinRoomAndEnter = useCallback(async (name, code) => {
    const result = await roomService.joinRoom({ roomId: code, username: name });
    setUsername(result.username);
    setRoomId(result.roomId);
    setUserId(result.userId);
    setRole(result.role);
    saveSession(result.roomId, result);
    return result.roomId;
  }, []);

  /**
   * Called when RoomPage mounts. If we already have identity in memory (the
   * normal create/join -> navigate flow) it's a no-op; otherwise (a hard
   * refresh landed directly on /room/:roomId) it restores userId/username/role
   * from sessionStorage. Returns false if neither source has an identity —
   * the caller should send the user back to the join screen.
   */
  const restoreSession = useCallback(
    (paramsRoomId) => {
      if (userId && roomId === paramsRoomId) return true;
      const session = readSession(paramsRoomId);
      if (!session) return false;
      setUsername(session.username);
      setRoomId(session.roomId);
      setUserId(session.userId);
      setRole(session.role);
      return true;
    },
    [userId, roomId],
  );

  // ---- Socket lifecycle ----

  const connectSocket = useCallback(
    (currentRoomId, currentUserId, currentUsername) => {
      setConnectionStatus("connecting");
      setRoomError("");
      socketService.connect(currentRoomId, currentUserId, currentUsername);

      if (listenersBoundRef.current) return;
      listenersBoundRef.current = true;

      socketService.on("room_state", (state) => {
        setConnectionStatus("connected");
        applyRoomState(state);
      });

      socketService.on("participants_updated", ({ participants: list }) => {
        setParticipants(list);
      });

      socketService.on("user_joined", ({ participants: list }) => {
        setParticipants(list);
      });

      socketService.on("user_left", ({ participants: list }) => {
        setParticipants(list);
      });

      socketService.on("role_assigned", ({ participants: list, userId: changedId, role: newRole }) => {
        setParticipants(list);
        setUserId((currentId) => {
          if (changedId === currentId) setRole(newRole);
          return currentId;
        });
      });

      socketService.on("host_changed", ({ participants: list, hostId }) => {
        setParticipants(list);
        setUserId((currentId) => {
          if (currentId) {
            setRole((prevRole) => (currentId === hostId ? "host" : prevRole === "host" ? "moderator" : prevRole));
          }
          return currentId;
        });
      });

      socketService.on("participant_removed", ({ participants: list }) => {
        setParticipants(list);
      });

      socketService.on("removed_from_room", () => {
        setRoomError("You were removed from this room by the host.");
        setConnectionStatus("error");
      });

      socketService.on("sync_state", ({ videoId, playing, currentTime, seq, reason }) => {
        // Newest authoritative state always wins: a lower-or-equal seq means
        // this event is stale (arrived out of order) and must be dropped
        // rather than overwriting the more current state we already applied.
        if (typeof seq === "number") {
          if (seq <= lastSeqRef.current) return;
          lastSeqRef.current = seq;
        }

        setVideoUrl(videoIdToUrl(videoId));
        updatePlayback({ playing: Boolean(playing), currentTime: currentTime || 0 });

        if (reason === "periodic") {
          // Continuous-sync ping: only ask Player.jsx to re-check drift, never
          // force a play/pause/seek — avoids jitter and feedback loops.
          bumpDrift();
        } else {
          // Discrete play/pause/seek/change_video command: apply it for real.
          bumpSync();
        }
      });

      socketService.on("new_message", (chatMessage) => {
        if (!chatMessage) return;
        setMessages((prev) => {
          const next = [...prev, chatMessage];
          return next.length > 100 ? next.slice(next.length - 100) : next;
        });
      });

      socketService.on("error_event", ({ message }) => {
        setRoomError(message || "Something went wrong.");
      });
    },
    [applyRoomState, updatePlayback, bumpSync, bumpDrift],
  );

  const disconnectSocket = useCallback(() => {
    socketService.disconnect();
    listenersBoundRef.current = false;
    setConnectionStatus("idle");
  }, []);

  const leaveRoom = useCallback(() => {
    disconnectSocket();
    if (roomId) clearSession(roomId);
    setUsername("");
    setRoomId("");
    setUserId("");
    setRole("participant");
    setParticipants([]);
    setVideoUrl("");
    setPlayback({ playing: false, currentTime: 0, duration: 0, volume: 60 });
    setMessages([]);
    setRoomError("");
  }, [disconnectSocket, roomId]);

  // ---- Playback + management actions (server validates permissions; UI already
  // disables controls for non-privileged roles, this is defense in depth) ----

  const play = useCallback(() => socketService.emit("play"), []);
  const pause = useCallback(() => socketService.emit("pause"), []);
  const seek = useCallback((time) => socketService.emit("seek", { time }), []);
  // Lightweight periodic ping (Bug 3) — does not toggle playing state, just
  // keeps the server's authoritative clock fresh between discrete commands.
  const syncTime = useCallback((time) => socketService.emit("time_sync", { time }), []);
  const changeVideo = useCallback((url) => socketService.emit("change_video", { url }), []);
  const assignRole = useCallback(
    (targetUserId, nextRole) => socketService.emit("assign_role", { userId: targetUserId, role: nextRole }),
    [],
  );
  const removeParticipant = useCallback(
    (targetUserId) => socketService.emit("remove_participant", { userId: targetUserId }),
    [],
  );
  const transferHost = useCallback(
    (targetUserId) => socketService.emit("transfer_host", { userId: targetUserId }),
    [],
  );
  const sendMessage = useCallback(
    (message) => socketService.emit("send_message", { message }),
    [],
  );

  const value = useMemo(
    () => ({
      username,
      setUsername,
      roomId,
      setRoomId,
      userId,
      role,
      setRole,
      participants,
      setParticipants,
      videoUrl,
      setVideoUrl,
      playback,
      updatePlayback,
      syncSeq,
      driftSeq,
      messages,
      connectionStatus,
      roomError,
      setRoomError,
      joinCodePrefill,
      setJoinCodePrefill,
      createRoomAndEnter,
      joinRoomAndEnter,
      restoreSession,
      connectSocket,
      disconnectSocket,
      leaveRoom,
      play,
      pause,
      seek,
      syncTime,
      changeVideo,
      assignRole,
      removeParticipant,
      transferHost,
      sendMessage,
    }),
    [
      username,
      roomId,
      userId,
      role,
      participants,
      videoUrl,
      playback,
      updatePlayback,
      syncSeq,
      driftSeq,
      messages,
      connectionStatus,
      roomError,
      joinCodePrefill,
      createRoomAndEnter,
      joinRoomAndEnter,
      restoreSession,
      connectSocket,
      disconnectSocket,
      leaveRoom,
      play,
      pause,
      seek,
      syncTime,
      changeVideo,
      assignRole,
      removeParticipant,
      transferHost,
      sendMessage,
    ],
  );

  return <RoomContext.Provider value={value}>{children}</RoomContext.Provider>;
}

export function useRoom() {
  const ctx = useContext(RoomContext);
  if (!ctx) throw new Error("useRoom must be used within RoomProvider");
  return ctx;
}
