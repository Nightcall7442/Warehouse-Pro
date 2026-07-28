import { Store, MapPin, AlertCircle, ChevronRight } from "lucide-react";
import { F, COLORS } from "./constants";

interface Territory { id: number; name: string; color: string | null; shopCount: number; totalDebt: string | null; }

export function TerritoriesGrid({ territories, totalShops, lang, fmt, onSelectAll, onSelectTerritory }: {
  territories: Territory[]; totalShops: number; lang: string;
  fmt: (v: number | string | null | undefined, opts?: { decimals?: number }) => string;
  onSelectAll: () => void; onSelectTerritory: (territoryId: number) => void;
}) {
  const t = (ru: string, uz: string) => lang === "uz" ? uz : ru;

  const rowStyle = (isHover: boolean) => ({
    display: "flex",
    alignItems: "center",
    gap: "12px",
    padding: "10px 14px",
    borderRadius: "10px",
    cursor: "pointer" as const,
    background: isHover ? COLORS.surfaceHover : "transparent",
    transition: "background 0.15s",
  });

  return (
    <div style={{ background: COLORS.surface, borderRadius: "16px", boxShadow: "0 1px 3px rgba(0,0,0,0.06)", overflow: "hidden" }}>
      {/* All shops row */}
      <div
        style={rowStyle(false)}
        onClick={onSelectAll}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = COLORS.surfaceHover; }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
      >
        <div style={{ width: "28px", height: "28px", borderRadius: "8px", background: "#5b6d8a", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <Store size={14} color="#fff" />
        </div>
        <span style={{ flex: 1, fontSize: "13px", fontWeight: 600, color: COLORS.textPrimary, fontFamily: F.body }}>
          {t("Все магазины", "Barcha do'konlar")}
        </span>
        <span style={{ fontSize: "13px", fontWeight: 600, color: COLORS.textSecondary, fontFamily: F.body }}>
          {totalShops}
        </span>
        <ChevronRight size={14} style={{ color: COLORS.textTertiary }} />
      </div>

      {/* Territory rows */}
      {territories.map((t_: Territory) => {
        const debt = Number(t_.totalDebt ?? 0);
        const dotColor = t_.color || "#5b6d8a";
        return (
          <div
            key={t_.id}
            style={rowStyle(false)}
            onClick={() => onSelectTerritory(t_.id)}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = COLORS.surfaceHover; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
          >
            <div style={{ width: "10px", height: "10px", borderRadius: "50%", background: dotColor, flexShrink: 0, marginLeft: "9px" }} />
            <span style={{ flex: 1, fontSize: "13px", color: COLORS.textPrimary, fontFamily: F.body }}>
              {t_.name}
            </span>
            {debt > 0 && (
              <span style={{
                display: "inline-flex", alignItems: "center", gap: "3px", fontSize: "11px", fontWeight: 600,
                padding: "2px 7px", borderRadius: "9999px", background: "rgba(232,80,80,.12)",
                color: "#d45050", fontFamily: F.body,
              }}>
                <AlertCircle size={9} />{fmt(debt, { decimals: 0 })}
              </span>
            )}
            <span style={{ fontSize: "13px", color: COLORS.textSecondary, fontFamily: F.body }}>
              {t_.shopCount}
            </span>
            <ChevronRight size={14} style={{ color: COLORS.textTertiary }} />
          </div>
        );
      })}

      {territories.length === 0 && (
        <div style={{ padding: "20px", textAlign: "center", color: COLORS.textTertiary, fontSize: "13px" }}>
          {t("Нет территорий", "Territoriyalar yo'q")}
        </div>
      )}
    </div>
  );
}
