import { Users } from "lucide-react";
import { Sidebar } from "../Sidebar/Sidebar";
import { ParticipantCard } from "./ParticipantCard";
import { EmptyState } from "../EmptyState";

export function ParticipantsPanel({
  participants = [],
  currentUsername,
  role,
  onPromote,
  onDemote,
  onRemove,
  onTransferHost,
}) {
  const canManage = role === "host" || role === "moderator";

  return (
    <Sidebar className="p-4">
      <div className="mb-3 flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/[0.06]">
            <Users className="h-4 w-4" />
          </div>
          <div>
            <p className="text-sm font-semibold">Participants</p>
            <p className="text-[11px] uppercase tracking-widest text-muted-foreground">
              {participants.length} in room
            </p>
          </div>
        </div>
      </div>

      <div className="flex-1 space-y-1 overflow-y-auto pr-1">
        {participants.length === 0 ? (
          <EmptyState
            icon={Users}
            title="No participants yet"
            description="Share the room link to invite people to watch with you."
          />
        ) : (
          participants.map((p) => (
            <ParticipantCard
              key={p.id}
              participant={p}
              isSelf={p.username === currentUsername}
              canManage={canManage}
              onPromote={() => onPromote?.(p.id)}
              onDemote={() => onDemote?.(p.id)}
              onRemove={() => onRemove?.(p.id)}
              onTransferHost={() => onTransferHost?.(p.id)}
            />
          ))
        )}
      </div>
    </Sidebar>
  );
}

export default ParticipantsPanel;