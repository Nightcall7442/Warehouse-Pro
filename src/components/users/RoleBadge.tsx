import { ROLE_COLORS, type Lang } from "./types";
import { labelled, ROLE_LABEL } from "@/lib/entity-labels";

interface RoleBadgeProps {
  role: string;
  lang: Lang;
}

export function RoleBadge({ role, lang }: RoleBadgeProps) {
  return (
    <span className={`status-badge ${ROLE_COLORS[role] ?? ""}`}>
      {labelled(ROLE_LABEL, role, lang)}
    </span>
  );
}
