import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { LogIn } from "lucide-react";
import { toast } from "sonner";
import { Card } from "../../components/Card";
import { Input } from "../../components/Input";
import { Button } from "../../components/Buttons/Button";
import { useRoom } from "../../context/RoomContext";

export function JoinRoomCard() {
  const [username, setUsername] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { joinRoomAndEnter, joinCodePrefill, setJoinCodePrefill } = useRoom();

  // Pre-fill the room code when we were redirected here from an invalid/expired
  // /room/:roomId visit (see RoomPage), then clear it so it doesn't linger.
  useEffect(() => {
    if (joinCodePrefill) {
      setCode(joinCodePrefill);
      setJoinCodePrefill("");
    }
  }, [joinCodePrefill, setJoinCodePrefill]);

  const handleJoinRoom = async (e) => {
    e.preventDefault();
    if (!username.trim() || !code.trim()) return;
    setLoading(true);
    try {
      const roomId = await joinRoomAndEnter(username.trim(), code.trim().toUpperCase());
      navigate({ to: "/room/$roomId", params: { roomId } });
    } catch (err) {
      toast.error(err.message || "Couldn't join that room. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="relative overflow-hidden">
      <div className="pointer-events-none absolute -left-16 -bottom-16 h-40 w-40 rounded-full bg-accent/25 blur-3xl" />
      <div className="mb-5 flex items-center gap-2">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/[0.06] border border-white/10">
          <LogIn className="h-4 w-4" />
        </div>
        <div>
          <h3 className="text-base font-semibold">Join a Room</h3>
          <p className="text-xs text-muted-foreground">Got a code from a friend?</p>
        </div>
      </div>
      <form onSubmit={handleJoinRoom} className="space-y-4">
        <Input
          id="join-username"
          label="Your username"
          placeholder="e.g. Kai"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          maxLength={20}
        />
        <Input
          id="join-code"
          label="Room code"
          placeholder="ABC123"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          maxLength={8}
          className="tracking-[0.4em] font-mono uppercase"
        />
        <Button
          type="submit"
          variant="outline"
          className="w-full"
          loading={loading}
          disabled={!username.trim() || !code.trim()}
        >
          Join Room
        </Button>
      </form>
    </Card>
  );
}

export default JoinRoomCard;