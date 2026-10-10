import { MoreHorizontal, Crown, ShieldPlus, ShieldMinus, UserX } from "lucide-react";
import { Avatar } from "../Avatar";
import { Badge } from "../Badge";
import { RoleBadge } from "../RoleBadge/RoleBadge";
import { Dropdown } from "../Dropdown";
import { cn } from "../../utils/cn";

const GUEST_HINT = "Guests can't be moderators or host. They need to sign in first.";

export function ParticipantCard({
  participant,
  isSelf,
  canManage,
  onPromote,
  onDemote,
  onRemove,
  onTransferHost,
}) {
  const { username, role, online, kind } = participant;
  const isGuest = kind === "guest";
  return (
    <li
      className={cn(
        "group flex items-center gap-3 rounded-xl border border-transparent p-2.5",
        "transition-colors hover:border-white/10 hover:bg-white/[0.03] focus-within:border-white/10",
      )}
    >
      <Avatar name={username} online={online} size={40} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">
          {username} {isSelf && <span className="text-muted-foreground">(you)</span>}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <RoleBadge role={role} />
          {isGuest && <Badge tone="neutral">Guest</Badge>}
          {!online && <span className="text-[11px] text-muted-foreground">offline</span>}
        </div>
      </div>
      {/* Only the HOST manages people (the server enforces this too). Always visible on touch screens. */}
      {canManage && !isSelf && (
        <Dropdown
          label={`Manage ${username}`}
          trigger={
            <button
              type="button"
              className="rounded-lg p-2 opacity-100 transition-opacity hover:bg-white/10 sm:opacity-0 sm:group-hover:opacity-100 sm:focus:opacity-100"
              aria-label={`Manage ${username}`}
            >
              <MoreHorizontal className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            </button>
          }
          items={[
            {
              label: "Promote to Moderator",
              icon: <ShieldPlus className="h-4 w-4" />,
              onClick: onPromote,
              disabled: role !== "participant" || isGuest,
              hint: isGuest ? GUEST_HINT : undefined,
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
              disabled: isGuest || !online,
              hint: isGuest ? GUEST_HINT : !online ? "They must be online." : undefined,
            },
            { divider: true },
            {
              label: "Remove & ban",
              icon: <UserX className="h-4 w-4" />,
              onClick: onRemove,
              danger: true,
            },
          ]}
        />
      )}
    </li>
  );
}

export default ParticipantCard;
