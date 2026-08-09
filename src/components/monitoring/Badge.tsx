import { CheckCircle2, XCircle } from "lucide-react";
import { COLORS, F } from "./theme";

interface BadgeProps {
  status: string;
  label: string;
}

const STATUS_MAP: Record<string, { fg: string; bg: string }> = {
  ok: { fg: COLORS.success, bg: "rgba(74,222,128,.12)" },
  connected: { fg: COLORS.success, bg: "rgba(74,222,128,.12)" },
  degraded: { fg: COLORS.warning, bg: "rgba(251,191,36,.12)" },
  error: { fg: COLORS.danger, bg: "rgba(232,80,80,.12)" },
  disconnected: { fg: COLORS.danger, bg: "rgba(232,80,80,.12)" },
};

export function Badge({ status, label }: BadgeProps) {
  const s = STATUS_MAP[status] ?? STATUS_MAP.error;
  const Icon = status === "ok" || status === "connected" ? CheckCircle2 : XCircle;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: "6px", padding: "4px 10px",
      borderRadius: "24px", fontSize: "11px", fontWeight: 600, fontFamily: F.body,
      color: s.fg, background: s.bg,
    }}>
      <Icon size={12} /> {label}
    </span>
  );
}
