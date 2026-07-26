import { MoreHorizontal, Crown, ShieldPlus, ShieldMinus, UserX } from "lucide-react";
import { Avatar } from "../Avatar";
import { RoleBadge } from "../RoleBadge/RoleBadge";
import { Dropdown } from "../Dropdown";
import { cn } from "../../utils/cn";

export function ParticipantCard({
  participant,
  isSelf,
  canManage,
  onPromote,
  onDemote,
  onRemove,
  onTransferHost,
}) {
  const { username, role, online } = participant;
  return (
    <div
      className={cn(
        "group flex items-center gap-3 rounded-xl border border-transparent p-2.5",
        "transition-colors hover:border-white/10 hover:bg-white/[0.03]",
      )}
    >
      <Avatar name={username} online={online} size={40} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-medium">
            {username} {isSelf && <span className="text-muted-foreground">(you)</span>}
          </p>
        </div>
        <div className="mt-1">
          <RoleBadge role={role} />
        </div>
      </div>
      {canManage && !isSelf && (
        <Dropdown
          trigger={
            <button
              className="opacity-0 group-hover:opacity-100 transition-opacity rounded-lg p-1.5 hover:bg-white/10"
              aria-label="Manage participant"
            >
              <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
            </button>
          }
          items={[
            {
              label: "Promote to Moderator",
              icon: <ShieldPlus className="h-4 w-4" />,
              onClick: onPromote,
              disabled: role !== "participant",
            },
            {
              label: "Demote",
              icon: <ShieldMinus className="h-4 w-4" />,
              onClick: onDemote,
              disabled: role !== "moderator",
            },
            {
              label: "Transfer Host",
              icon: <Crown className="h-4 w-4" />,
              onClick: onTransferHost,
            },
            { divider: true },
            {
              label: "Remove User",
              icon: <UserX className="h-4 w-4" />,
              onClick: onRemove,
              danger: true,
            },
          ]}
        />
      )}
    </div>
  );
}

export default ParticipantCard;