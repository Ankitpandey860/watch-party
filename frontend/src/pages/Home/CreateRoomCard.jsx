import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Card } from "../../components/Card";
import { Input } from "../../components/Input";
import { Button } from "../../components/Buttons/Button";
import { useRoom } from "../../context/RoomContext";

export function CreateRoomCard() {
  const [username, setUsername] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { createRoomAndEnter } = useRoom();

  const handleCreateRoom = async (e) => {
    e.preventDefault();
    if (!username.trim()) return;
    setLoading(true);
    try {
      const roomId = await createRoomAndEnter(username.trim());
      navigate({ to: "/room/$roomId", params: { roomId } });
    } catch (err) {
      toast.error(err.message || "Couldn't create the room. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="relative overflow-hidden">
      <div className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full bg-primary/20 blur-3xl" />
      <div className="mb-5 flex items-center gap-2">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl gradient-hero shadow-glow">
          <Sparkles className="h-4 w-4 text-white" />
        </div>
        <div>
          <h3 className="text-base font-semibold">Create a Room</h3>
          <p className="text-xs text-muted-foreground">You'll be the host</p>
        </div>
      </div>
      <form onSubmit={handleCreateRoom} className="space-y-4">
        <Input
          id="create-username"
          label="Your username"
          placeholder="e.g. Nova"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          maxLength={20}
        />
        <Button
          type="submit"
          className="w-full"
          loading={loading}
          disabled={!username.trim()}
        >
          Create Room
        </Button>
      </form>
    </Card>
  );
}

export default CreateRoomCard;