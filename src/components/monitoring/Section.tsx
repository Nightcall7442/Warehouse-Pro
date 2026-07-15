import { COLORS, F, SHADOW } from "./theme";

interface SectionProps {
  title: string;
  icon: React.ComponentType<{ size: number }>;
  children: React.ReactNode;
  className?: string;
  actions?: React.ReactNode;
  delay?: number;
}

export function Section({ title, icon: Icon, children, className = "", actions, delay = 0 }: SectionProps) {
  return (
    <div style={{
      background: COLORS.surface, borderRadius: "24px", overflow: "hidden",
      boxShadow: SHADOW, animation: `slideUp ${0.5 + delay}s ease forwards`,
    }}>
      <div style={{
        padding: "16px 20px", display: "flex", alignItems: "center", justifyContent: "space-between",
        borderBottom: `1px solid ${COLORS.border}`,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <div style={{
            width: "28px", height: "28px", borderRadius: "8px",
            display: "flex", alignItems: "center", justifyContent: "center",
            background: "rgba(75,108,246,.10)", color: COLORS.primary,
          }}>
            <Icon size={14} />
          </div>
          <h3 style={{ fontFamily: F.display, fontSize: "13px", fontWeight: 600, color: COLORS.textPrimary }}>{title}</h3>
        </div>
        {actions}
      </div>
      <div style={{ padding: "20px" }}>{children}</div>
    </div>
  );
}
