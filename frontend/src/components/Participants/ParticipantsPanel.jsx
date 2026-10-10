import { Users } from "lucide-react";
import { Sidebar } from "../Sidebar/Sidebar";
import { ParticipantCard } from "./ParticipantCard";
import { EmptyState } from "../EmptyState";

export function ParticipantsPanel({
  participants = [],
  currentUserId,
  role,
  onPromote,
  onDemote,
  onRemove,
  onTransferHost,
}) {
  const canManage = role === "host"; // moderators control playback only; people management is host-only
  const online = participants.filter((p) => p.online).length;

  return (
    <Sidebar className="p-4">
      <div className="mb-3 flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/[0.06]">
            <Users className="h-4 w-4" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-sm font-semibold">People</h2>
            <p className="text-[11px] uppercase tracking-widest text-muted-foreground">
              {online} online · {participants.length} in room
            </p>
          </div>
        </div>
      </div>

      {participants.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No one else is here yet"
          description="Share the invite link to watch together."
        />
      ) : (
        <ul className="flex-1 space-y-1 overflow-y-auto pr-1" aria-label="Participants">
          {participants.map((p) => (
            <ParticipantCard
              key={p.id}
              participant={p}
              isSelf={p.id === currentUserId}
              canManage={canManage}
              onPromote={() => onPromote?.(p.id)}
              onDemote={() => onDemote?.(p.id)}
              onRemove={() => onRemove?.(p.id)}
              onTransferHost={() => onTransferHost?.(p.id)}
            />
          ))}
        </ul>
      )}
    </Sidebar>
  );
}

export default ParticipantsPanel;
