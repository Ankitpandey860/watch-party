import { Avatar } from "../Avatar";
import { cn } from "../../utils/cn";

// Mirrors the tone colors already used by Badge/RoleBadge, so a message's
// sender name reads consistently with their role badge everywhere else in
// the UI (host = rose, moderator = violet, participant = blue).
const ROLE_NAME_CLASSES = {
  host: "text-[oklch(0.78_0.18_15)]",
  moderator: "text-[oklch(0.78_0.16_280)]",
  participant: "text-[oklch(0.78_0.14_235)]",
};

const ROLE_ACCENT_CLASSES = {
  host: "border-l-[oklch(0.65_0.22_15/0.6)]",
  moderator: "border-l-[oklch(0.62_0.2_280/0.6)]",
  participant: "border-l-[oklch(0.6_0.16_235/0.5)]",
};

function formatLocalTime(timestamp) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function ChatMessage({ message, isSelf }) {
  const { senderName, role, message: text, timestamp } = message;

  return (
    <div
      className={cn(
        "flex gap-2.5 rounded-lg border-l-2 px-2.5 py-2 transition-colors hover:bg-white/[0.03]",
        ROLE_ACCENT_CLASSES[role] || ROLE_ACCENT_CLASSES.participant,
      )}
    >
      <Avatar name={senderName} size={28} className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span
            className={cn(
              "truncate text-xs font-semibold",
              ROLE_NAME_CLASSES[role] || ROLE_NAME_CLASSES.participant,
            )}
          >
            {senderName}
            {isSelf && <span className="ml-1 font-normal text-muted-foreground">(you)</span>}
          </span>
          <span className="shrink-0 text-[10px] text-muted-foreground">
            {formatLocalTime(timestamp)}
          </span>
        </div>
        <p className="mt-0.5 whitespace-pre-wrap break-words text-sm leading-snug text-foreground/90">
          {text}
        </p>
      </div>
    </div>
  );
}

export default ChatMessage;
