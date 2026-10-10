import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { PartyPopper } from "lucide-react";
import { toast } from "sonner";
import { TopBar } from "../../components/TopBar/TopBar";
import { ThreeBackdrop } from "../../components/Backdrop/ThreeBackdrop";
import { TiltCard } from "../../components/TiltCard";
import { Button } from "../../components/Buttons/Button";
import { Spinner } from "../../components/Loader";
import { StatusScreen } from "../../components/StatusScreen";
import { useAuth } from "../../context/AuthContext";
import roomService from "../../services/roomService";

export function CreatePage() {
  const { status, principal, isUser } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Hosting needs an account: send signed-out visitors to sign in, then bring them back here.
  useEffect(() => {
    if (status === "ready" && !principal)
      navigate({ to: "/auth", search: { returnTo: "/create" }, replace: true });
  }, [status, principal, navigate]);

  const create = async () => {
    setBusy(true);
    setError("");
    try {
      const { roomId } = await roomService.createRoom();
      navigate({ to: "/room/$roomId", params: { roomId } });
    } catch (err) {
      setError(
        err.code === "RATE_LIMITED"
          ? `Slow down a little. Try again in ${err.retryAfterSeconds || 60}s.`
          : err.message,
      );
      toast.error("Couldn't create the room");
      setBusy(false);
    }
  };

  let body;
  if (status === "loading" || (status === "ready" && !principal)) {
    body = (
      <div className="flex justify-center py-10" role="status" aria-label="Loading">
        <Spinner />
      </div>
    );
  } else if (status === "unreachable") {
    body = (
      <StatusScreen
        title="Can't reach the server"
        actions={<Button onClick={() => window.location.reload()}>Try again</Button>}
      />
    );
  } else if (!isUser) {
    body = (
      <StatusScreen
        title="Guests can't host"
        actions={
          <Button onClick={() => navigate({ to: "/auth", search: { returnTo: "/create" } })}>
            Sign in to host
          </Button>
        }
      >
        You joined as a guest, which is great for watching. To host a room, sign in with Google or
        email.
      </StatusScreen>
    );
  } else {
    body = (
      <div className="space-y-5 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl gradient-hero text-white shadow-glow">
          <PartyPopper className="h-6 w-6" aria-hidden="true" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Ready, {principal.displayName}?</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            You'll be the host. Share the invite link and friends can join with just a name.
          </p>
        </div>
        {error && (
          <p
            role="alert"
            className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {error}
          </p>
        )}
        <Button size="lg" className="w-full" onClick={create} loading={busy}>
          Create room
        </Button>
      </div>
    );
  }

  return (
    <div className="relative min-h-dvh">
      <ThreeBackdrop variant="calm" interactive={false} className="fixed" />
      <TopBar returnTo="/create" />
      <main className="relative z-10 mx-auto flex max-w-md flex-col items-center px-4 py-12 sm:py-20">
        <TiltCard className="w-full" innerClassName="glass rounded-3xl p-6 shadow-elevated sm:p-8">
          <div className="tilt-lift">{body}</div>
        </TiltCard>
      </main>
    </div>
  );
}
export default CreatePage;
