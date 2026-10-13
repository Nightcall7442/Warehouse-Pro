import type { ReactNode } from "react";
import { F, COLORS } from "./styles";

/**
 * Шапка раздела P&L: заголовок, пояснение и место справа под календарь
 * раздела. Была написана в каждом разделе заново — четыре одинаковых h2 и p.
 */
export function SectionHeader({ title, hint, action }: { title: ReactNode; hint: ReactNode; action?: ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "12px", flexWrap: "wrap", marginBottom: "20px" }}>
      <div style={{ minWidth: 0 }}>
        <h2 style={{ fontFamily: F.display, fontSize: "16px", fontWeight: 600, color: COLORS.textPrimary, margin: "0 0 4px" }}>
          {title}
        </h2>
        <p style={{ margin: 0, fontSize: "12px", color: COLORS.textTertiary }}>{hint}</p>
      </div>
      {action}
    </div>
  );
}
