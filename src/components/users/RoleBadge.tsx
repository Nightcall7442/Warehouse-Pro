import { ROLE_COLORS, ROLE_LABELS, type Lang } from "./types";

interface RoleBadgeProps {
  role: string;
  lang: Lang;
}

export function RoleBadge({ role, lang }: RoleBadgeProps) {
  return (
    <span className={`status-badge ${ROLE_COLORS[role] ?? ""}`}>
      {ROLE_LABELS[role]?.[lang] ?? role}
    </span>
  );
}
