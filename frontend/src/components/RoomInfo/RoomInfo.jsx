import { Copy, Check, LogOut, Users } from "lucide-react";
import { Card } from "../Card";
import { Button } from "../Buttons/Button";
import { RoleBadge } from "../RoleBadge/RoleBadge";
import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";

export function RoomInfo({ roomId, role, userCount, onLeave }) {
  const { copied, copy } = useCopyToClipboard();
  const link = typeof window !== "undefined" ? `${window.location.origin}/room/${roomId}` : "";

  return (
    <Card className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
      <div className="flex flex-wrap items-center gap-4">
        <div>
          <p className="text-[11px] uppercase tracking-widest text-muted-foreground">
            Room ID
          </p>
          <p className="font-mono text-lg font-semibold tracking-wider">{roomId}</p>
        </div>
        <div className="h-8 w-px bg-white/10 hidden sm:block" />
        <div>
          <p className="text-[11px] uppercase tracking-widest text-muted-foreground">
            Your Role
          </p>
          <div className="mt-1">
            <RoleBadge role={role} />
          </div>
        </div>
        <div className="h-8 w-px bg-white/10 hidden sm:block" />
        <div>
          <p className="text-[11px] uppercase tracking-widest text-muted-foreground">
            Connected
          </p>
          <p className="flex items-center gap-1.5 text-sm font-semibold">
            <Users className="h-4 w-4 text-muted-foreground" />
            {userCount} {userCount === 1 ? "user" : "users"}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={() => copy(link)}>
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          {copied ? "Copied!" : "Copy link"}
        </Button>
        <Button variant="danger" size="sm" onClick={onLeave}>
          <LogOut className="h-4 w-4" />
          Leave
        </Button>
      </div>
    </Card>
  );
}

export default RoomInfo;