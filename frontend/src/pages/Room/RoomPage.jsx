import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  Hourglass,
  Link2Off,
  LogIn,
  MessageCircle,
  ServerCrash,
  ShieldAlert,
  UserX,
  Users,
  WifiOff,
} from "lucide-react";
import { Badge } from "../../components/Badge";
import { Button } from "../../components/Buttons/Button";
import { Input } from "../../components/Input";
import { Spinner } from "../../components/Loader";
import { StatusScreen } from "../../components/StatusScreen";
import { TiltCard } from "../../components/TiltCard";
import { TopBar } from "../../components/TopBar/TopBar";
import { ThreeBackdrop } from "../../components/Backdrop/ThreeBackdrop";
import { RoomInfo } from "../../components/RoomInfo/RoomInfo";
import { PlayerHost } from "../../components/Player/PlayerHost";
import { Controls } from "../../components/Controls/Controls";
import { VideoInput } from "../../components/VideoInput/VideoInput";
import { ParticipantsPanel } from "../../components/Participants/ParticipantsPanel";
import { ChatPanel } from "../../components/Chat/ChatPanel";
import { useAuth } from "../../context/AuthContext";
import { useRoom } from "../../context/RoomContext";
import roomService from "../../services/roomService";
import { cn } from "../../utils/cn";

const CONNECTION_BADGE = {
  connecting: { tone: "warning", label: "Connecting…" },
  connected: { tone: "online", label: "Connected" },
  reconnecting: { tone: "warning", label: "Reconnecting…" },
};

/** Full-screen shell used by every non-room state (invite, errors, loading). */
function Shell({ children, backdrop = "calm" }) {
  const roomId = useParams({ strict: false })?.roomId;
  return (
    <div className="relative min-h-dvh">
      <ThreeBackdrop variant={backdrop} interactive={false} className="fixed" />
      <TopBar returnTo={roomId ? `/room/${roomId}` : "/"} />
      <main className="relative z-10">{children}</main>
    </div>
  );
}

function InviteJoin({ roomId, info, onJoin, error, busy }) {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const submit = (e) => {
    e.preventDefault();
    if (name.trim()) onJoin(name.trim());
  };
  return (
    <div className="mx-auto flex max-w-md flex-col items-center px-4 py-12 sm:py-20">
      <TiltCard className="w-full" innerClassName="glass rounded-3xl p-6 shadow-elevated sm:p-8">
        <div className="tilt-lift">
          <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
            You're invited
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">
            Join room <span className="font-mono tracking-wider">{roomId}</span>
          </h1>
          {info && (
            <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
              <Users className="h-4 w-4" aria-hidden="true" />
              {info.participantCount === 0
                ? "Be the first one in"
                : `${info.participantCount} watching now`}
            </p>
          )}
          <form onSubmit={submit} className="mt-6 space-y-4" noValidate>
            <Input
              id="guest-name"
              label="Your display name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={20}
              autoComplete="nickname"
              placeholder="e.g. Alex"
              autoFocus
              error={error}
            />
            <Button
              type="submit"
              size="lg"
              className="w-full"
              loading={busy}
              disabled={!name.trim()}
            >
              Join as guest
            </Button>
          </form>
          <p className="mt-3 text-center text-xs text-muted-foreground">
            Guests can watch and chat. Hosting and moderating need an account.
          </p>
          <div className="my-5 h-px bg-white/10" role="separator" />
          <Button
            variant="ghost"
            className="w-full"
            onClick={() => navigate({ to: "/auth", search: { returnTo: `/room/${roomId}` } })}
          >
            <LogIn className="h-4 w-4" aria-hidden="true" /> I have an account — sign in
          </Button>
        </div>
      </TiltCard>
    </div>
  );
}

export function RoomPage() {
  const navigate = useNavigate();
  const params = useParams({ strict: false });
  const roomId = String(params?.roomId || "").toUpperCase();
  const auth = useAuth();
  const room = useRoom();
  const { connectSocket, disconnectSocket, leaveRoom, setRoomError, retryConnection } = room;

  // Entry gate: checking -> invite (needs a name) | ready -> joining -> in   (or an error step)
  const [gate, setGate] = useState({ step: "checking", error: "" });
  const [info, setInfo] = useState(null);
  const [sidebarTab, setSidebarTab] = useState("participants");
  const admitted = useRef("");
  const principalId = auth.principal?.id;

  // 1) Look the room up as soon as we know who (if anyone) is signed in.
  useEffect(() => {
    if (auth.status === "loading") return undefined;
    if (auth.status === "unreachable") {
      setGate({ step: "unreachable" });
      return undefined;
    }
    let cancelled = false;
    roomService
      .getRoom(roomId)
      .then((i) => {
        if (cancelled) return;
        setInfo(i);
        if (auth.principal)
          setGate((g) => (g.step === "in" || g.step === "joining" ? g : { step: "ready" }));
        else setGate(i.full ? { step: "full" } : { step: "invite" });
      })
      .catch((err) => {
        if (cancelled) return;
        setGate({ step: err.status === 404 ? "not_found" : "unreachable" });
      });
    return () => {
      cancelled = true;
    };
  }, [roomId, auth.status, principalId]);

  // 2) Admission: ask the server (creates the guest identity if needed), then open the socket.
  const admit = useCallback(
    async (displayName) => {
      setGate({ step: "joining", error: "" });
      try {
        const res = await roomService.joinRoom(roomId, displayName);
        if (!auth.principal || res.principal.id !== auth.principal.id) await auth.refresh();
        connectSocket(roomId, res.principal);
        setGate({ step: "in" });
      } catch (err) {
        if (err.code === "BANNED") setGate({ step: "banned" });
        else if (err.code === "ROOM_FULL") setGate({ step: "full" });
        else if (err.status === 404) setGate({ step: "not_found" });
        else
          setGate({
            step: auth.principal ? "unreachable" : "invite",
            error:
              err.code === "RATE_LIMITED"
                ? `Too many attempts. Try again in ${err.retryAfterSeconds || 60}s.`
                : err.message,
          });
      }
    },
    [roomId, auth, connectSocket],
  );

  // Already signed in (account or earlier guest session)? Skip the form and join.
  useEffect(() => {
    if (gate.step === "ready" && auth.principal && admitted.current !== roomId) {
      admitted.current = roomId;
      admit();
    }
  }, [gate.step, auth.principal, roomId, admit]);

  // Leave cleanly when the page goes away.
  useEffect(() => {
    return () => {
      admitted.current = "";
      disconnectSocket();
    };
  }, [roomId, disconnectSocket]);

  useEffect(() => {
    if (room.roomError) {
      toast.error(room.roomError);
      setRoomError("");
    }
  }, [room.roomError, setRoomError]);

  const handleLeave = () => {
    leaveRoom();
    navigate({ to: "/" });
  };

  const canControl = room.role === "host" || room.role === "moderator";
  const homeButton = (
    <Button variant="outline" onClick={() => navigate({ to: "/" })}>
      Back to home
    </Button>
  );

  // ---- non-room screens ------------------------------------------------------------------------
  if (gate.step === "checking" || gate.step === "joining" || gate.step === "ready") {
    return (
      <Shell>
        <div className="flex flex-col items-center gap-3 py-24" role="status">
          <Spinner />
          <p className="text-sm text-muted-foreground">
            {auth.slow
              ? "Waking up the server… this can take up to a minute."
              : gate.step === "joining"
                ? "Joining the room…"
                : "Loading…"}
          </p>
        </div>
      </Shell>
    );
  }
  if (gate.step === "invite") {
    return (
      <Shell>
        <InviteJoin roomId={roomId} info={info} onJoin={admit} error={gate.error} busy={false} />
      </Shell>
    );
  }
  if (gate.step === "not_found" || room.connectionStatus === "room_not_found") {
    return (
      <Shell>
        <StatusScreen
          icon={Link2Off}
          title="This room doesn't exist or has ended"
          actions={
            <>
              {homeButton}
              <Button onClick={() => navigate({ to: "/create" })}>Create a room</Button>
            </>
          }
        >
          Check the code <span className="font-mono">{roomId}</span>, or ask your host for a fresh
          invite. Rooms close shortly after everyone leaves.
        </StatusScreen>
      </Shell>
    );
  }
  if (gate.step === "full" || room.connectionStatus === "room_full") {
    return (
      <Shell>
        <StatusScreen icon={Users} title="This room is full" actions={homeButton}>
          The host's room is at capacity. Try again in a little while.
        </StatusScreen>
      </Shell>
    );
  }
  if (gate.step === "banned" || room.connectionStatus === "banned") {
    return (
      <Shell>
        <StatusScreen
          icon={UserX}
          tone="danger"
          title="You can't join this room"
          actions={homeButton}
        >
          You were removed from this room by the host.
        </StatusScreen>
      </Shell>
    );
  }
  if (room.connectionStatus === "auth_expired") {
    return (
      <Shell>
        <StatusScreen
          icon={Hourglass}
          title="Your session ended"
          actions={
            <Button
              onClick={() => navigate({ to: "/auth", search: { returnTo: `/room/${roomId}` } })}
            >
              Sign in again
            </Button>
          }
        >
          For your security you were signed out. Sign in again to rejoin the room, or open the
          invite link to rejoin as a guest.
        </StatusScreen>
      </Shell>
    );
  }
  if (room.connectionStatus === "unauthorized") {
    return (
      <Shell>
        <StatusScreen
          icon={ShieldAlert}
          tone="danger"
          title="You're not allowed in this room"
          actions={homeButton}
        >
          Your connection wasn't authorised for this room.
        </StatusScreen>
      </Shell>
    );
  }
  if (gate.step === "unreachable") {
    return (
      <Shell>
        <StatusScreen
          icon={ServerCrash}
          title="Can't reach the server"
          actions={<Button onClick={() => window.location.reload()}>Try again</Button>}
        >
          Check your connection. If the server was asleep it can take up to a minute to wake.
        </StatusScreen>
      </Shell>
    );
  }

  // ---- the room --------------------------------------------------------------------------------
  const firstConnect = room.connectionStatus === "connecting" && room.participants.length === 0;
  if (firstConnect) {
    return (
      <Shell backdrop="calm">
        <div className="flex flex-col items-center gap-3 py-24" role="status">
          <Spinner />
          <p className="text-sm text-muted-foreground">Connecting to the room…</p>
        </div>
      </Shell>
    );
  }

  const badge = CONNECTION_BADGE[room.connectionStatus] || CONNECTION_BADGE.connecting;
  const tabClass = (active) =>
    cn(
      "flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition-colors",
      active ? "bg-white/[0.08] text-foreground" : "text-muted-foreground hover:text-foreground",
    );

  return (
    <div className="relative min-h-dvh">
      {/* Decorative 3D backdrop: one orb per person, glow follows play/pause. Sits behind everything; the video stays flat. */}
      <div className="pointer-events-none fixed inset-0 -z-0">
        <ThreeBackdrop
          variant="room"
          interactive={false}
          playing={room.playback.playing}
          participants={room.participants}
        />
        <div className="absolute inset-0 bg-background/70" />
      </div>

      <TopBar returnTo={`/room/${roomId}`}>
        <Badge tone={badge.tone} dot>
          {badge.label}
        </Badge>
      </TopBar>

      {room.connectionStatus === "reconnecting" && (
        <div
          role="status"
          className="relative z-20 border-b border-warning/30 bg-warning/10 px-4 py-2 text-center text-sm text-warning"
        >
          <WifiOff className="mr-2 inline h-4 w-4" aria-hidden="true" />
          Connection lost. Reconnecting… your place in the room is saved.
          <button
            type="button"
            onClick={retryConnection}
            className="ml-3 font-medium underline underline-offset-2"
          >
            Retry now
          </button>
        </div>
      )}

      <main className="relative z-10 mx-auto grid max-w-7xl gap-4 px-4 py-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-4">
          <RoomInfo
            roomId={room.roomId || roomId}
            role={room.role}
            userCount={room.participants.filter((p) => p.online).length}
            onLeave={handleLeave}
          />
          <PlayerHost
            provider={room.provider}
            videoUrl={room.videoUrl}
            playing={room.playback.playing}
          />
          <Controls
            playing={room.playback.playing}
            currentTime={room.playback.currentTime}
            duration={room.playback.duration}
            volume={room.playback.volume}
            disabled={!canControl}
            onPlay={room.play}
            onPause={room.pause}
            onSeek={room.seek}
            onVolume={(v) => room.updatePlayback({ volume: v })}
          />
          <VideoInput disabled={!canControl} onChangeVideo={room.changeVideo} />
        </div>

        <div className="flex h-[32rem] flex-col gap-3 lg:sticky lg:top-20 lg:h-[calc(100dvh-6rem)]">
          <div
            role="tablist"
            aria-label="Room panels"
            className="flex gap-1 rounded-xl border border-white/10 bg-white/[0.02] p-1"
          >
            <button
              type="button"
              role="tab"
              aria-selected={sidebarTab === "participants"}
              onClick={() => setSidebarTab("participants")}
              className={tabClass(sidebarTab === "participants")}
            >
              <Users className="h-3.5 w-3.5" aria-hidden="true" /> People
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={sidebarTab === "chat"}
              onClick={() => setSidebarTab("chat")}
              className={tabClass(sidebarTab === "chat")}
            >
              <MessageCircle className="h-3.5 w-3.5" aria-hidden="true" /> Chat
            </button>
          </div>
          <div className="min-h-0 flex-1" role="tabpanel">
            {sidebarTab === "participants" ? (
              <ParticipantsPanel
                participants={room.participants}
                currentUserId={room.userId}
                role={room.role}
                onPromote={(id) => room.assignRole(id, "moderator")}
                onDemote={(id) => room.assignRole(id, "participant")}
                onRemove={room.removeParticipant}
                onTransferHost={room.transferHost}
              />
            ) : (
              <ChatPanel
                messages={room.messages}
                currentUserId={room.userId}
                connected={room.connectionStatus === "connected"}
                onSend={room.sendMessage}
              />
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

export default RoomPage;
