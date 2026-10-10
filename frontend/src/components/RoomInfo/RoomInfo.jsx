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
      <dl className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div>
          <dt className="text-[11px] uppercase tracking-widest text-muted-foreground">Room code</dt>
          <dd className="font-mono text-lg font-semibold tracking-wider">{roomId}</dd>
        </div>
        <div>
          <dt className="text-[11px] uppercase tracking-widest text-muted-foreground">Your role</dt>
          <dd className="mt-1">
            <RoleBadge role={role} />
          </dd>
        </div>
        <div>
          <dt className="text-[11px] uppercase tracking-widest text-muted-foreground">Watching</dt>
          <dd className="flex items-center gap-1.5 text-sm font-semibold">
            <Users className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            {userCount} {userCount === 1 ? "person" : "people"}
          </dd>
        </div>
      </dl>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={() => copy(link)}>
          {copied ? (
            <Check className="h-4 w-4" aria-hidden="true" />
          ) : (
            <Copy className="h-4 w-4" aria-hidden="true" />
          )}
          {copied ? "Link copied" : "Copy invite link"}
        </Button>
        <Button variant="danger" size="sm" onClick={onLeave}>
          <LogOut className="h-4 w-4" aria-hidden="true" />
          Leave
        </Button>
      </div>
    </Card>
  );
}
export default RoomInfo;
