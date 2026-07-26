import { useEffect, useState } from "react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { toast } from "sonner";
import { Badge } from "../../components/Badge";
import { Dropdown } from "../../components/Dropdown";
import { Navbar } from "../../components/Navbar/Navbar";
import { RoomInfo } from "../../components/RoomInfo/RoomInfo";
import { Player } from "../../components/Player/Player";
import { Controls } from "../../components/Controls/Controls";
import { VideoInput } from "../../components/VideoInput/VideoInput";
import { ParticipantsPanel } from "../../components/Participants/ParticipantsPanel";
import { ChatPanel } from "../../components/Chat/ChatPanel";
import { useRoom } from "../../context/RoomContext";
import { cn } from "../../utils/cn";
import { ChevronDown, Users, MessageCircle } from "lucide-react";

const CONNECTION_BADGE = {
  connecting: { tone: "warning", label: "Connecting…" },
  connected: { tone: "online", label: "Connected" },
  error: { tone: "offline", label: "Disconnected" },
  idle: { tone: "offline", label: "Disconnected" },
};

export function RoomPage() {
  const navigate = useNavigate();
  const params = useParams({ strict: false });
  const {
    username,
    roomId,
    userId,
    role,
    participants,
    videoUrl,
    playback,
    updatePlayback,
    messages,
    connectionStatus,
    roomError,
    setRoomError,
    setJoinCodePrefill,
    restoreSession,
    connectSocket,
    disconnectSocket,
    leaveRoom,
    play,
    pause,
    seek,
    changeVideo,
    assignRole,
    removeParticipant,
    transferHost,
    sendMessage,
  } = useRoom();

  // Which panel the right-hand sidebar shows — purely local UI state, doesn't
  // need to live in RoomContext.
  const [sidebarTab, setSidebarTab] = useState("participants");

  // Enter the room: reuse in-memory identity from create/join, or — on a hard
  // refresh landing straight on this URL — restore it from sessionStorage.
  // With neither, there's no username to join with, so send the user home.
  useEffect(() => {
    const targetRoomId = params?.roomId;
    if (!targetRoomId) return;

    const ok = restoreSession(targetRoomId);
    if (!ok) {
      toast.error("Enter a username to join this room.");
      setJoinCodePrefill(targetRoomId);
      navigate({ to: "/" });
    }
  }, [params?.roomId, restoreSession, setJoinCodePrefill, navigate]);

  // Once identity (roomId/userId/username) is in context — either from the
  // create/join flow or just restored above — open the socket and join_room.
  useEffect(() => {
    if (roomId && userId && username && connectionStatus === "idle") {
      connectSocket(roomId, userId, username);
    }
  }, [roomId, userId, username, connectionStatus, connectSocket]);

  // Close the socket (and notify the backend via leave_room) when the room
  // screen unmounts, e.g. the user navigates away or closes the tab.
  useEffect(() => {
    return () => disconnectSocket();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (roomError) {
      toast.error(roomError);
      if (roomError.toLowerCase().includes("removed")) {
        navigate({ to: "/" });
      }
      setRoomError("");
    }
  }, [roomError, navigate, setRoomError]);

  const canControl = role === "host" || role === "moderator";

  const handleVolume = (v) => updatePlayback({ volume: v });

  const handleLeave = () => {
    leaveRoom();
    navigate({ to: "/" });
  };

  const connectionBadge = CONNECTION_BADGE[connectionStatus] || CONNECTION_BADGE.idle;

  return (
    <div className="min-h-screen">
      <Navbar
        right={
          <div className="flex items-center gap-2">
            <Badge tone={connectionBadge.tone} dot>
              {connectionBadge.label}
            </Badge>
            <Dropdown
              trigger={
                <button className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm hover:bg-white/[0.08]">
                  <span className="max-w-[120px] truncate">{username || "You"}</span>
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                </button>
              }
              items={[
                {
                  label: "Copy room link",
                  onClick: () => {
                    if (typeof window !== "undefined") {
                      navigator.clipboard?.writeText(window.location.href);
                      toast.success("Room link copied");
                    }
                  },
                },
                { divider: true },
                { label: "Leave room", onClick: handleLeave, danger: true },
              ]}
            />
          </div>
        }
      />

      <main className="mx-auto grid max-w-7xl gap-4 px-4 py-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-4">
          <RoomInfo
            roomId={roomId || params?.roomId}
            role={role}
            userCount={participants.filter((p) => p.online).length}
            onLeave={handleLeave}
          />
          <Player videoUrl={videoUrl} playing={playback.playing} />
          <Controls
            playing={playback.playing}
            currentTime={playback.currentTime}
            duration={playback.duration}
            volume={playback.volume}
            disabled={!canControl}
            onPlay={play}
            onPause={pause}
            onSeek={seek}
            onVolume={handleVolume}
          />
          <VideoInput disabled={!canControl} onChangeVideo={changeVideo} />
        </div>

        <div className="flex flex-col gap-3 lg:sticky lg:top-20 lg:h-[calc(100vh-6rem)]">
          <div className="flex gap-1 rounded-xl border border-white/10 bg-white/[0.02] p-1">
            <button
              onClick={() => setSidebarTab("participants")}
              className={cn(
                "flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition-colors",
                sidebarTab === "participants"
                  ? "bg-white/[0.08] text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Users className="h-3.5 w-3.5" />
              Participants
            </button>
            <button
              onClick={() => setSidebarTab("chat")}
              className={cn(
                "flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition-colors",
                sidebarTab === "chat"
                  ? "bg-white/[0.08] text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <MessageCircle className="h-3.5 w-3.5" />
              Chat
            </button>
          </div>

          <div className="min-h-0 flex-1">
            {sidebarTab === "participants" ? (
              <ParticipantsPanel
                participants={participants}
                currentUsername={username}
                role={role}
                onPromote={(id) => assignRole(id, "moderator")}
                onDemote={(id) => assignRole(id, "participant")}
                onRemove={removeParticipant}
                onTransferHost={transferHost}
              />
            ) : (
              <ChatPanel
                messages={messages}
                currentUserId={userId}
                connected={connectionStatus === "connected"}
                onSend={sendMessage}
              />
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

export default RoomPage;
