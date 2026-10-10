import { Badge } from "../Badge";
import { Crown, Shield, User } from "lucide-react";

const map = {
  host: { tone: "host", label: "Host", Icon: Crown },
  moderator: { tone: "moderator", label: "Moderator", Icon: Shield },
  participant: { tone: "participant", label: "Participant", Icon: User },
};

export function RoleBadge({ role = "participant" }) {
  const { tone, label, Icon } = map[role] || map.participant;
  return (
    <Badge tone={tone}>
      <Icon className="h-3 w-3" />
      {label}
    </Badge>
  );
}

export default RoleBadge;
