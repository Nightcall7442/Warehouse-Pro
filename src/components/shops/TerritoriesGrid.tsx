import { Store, MapPin, AlertCircle } from "lucide-react";
import { F, COLORS, SHADOW } from "./constants";

interface Territory { city: string; district: string | null; count: number; totalDebt: string | null; }

export function TerritoriesGrid({ territories, totalShops, lang, fmt, onSelectAll, onSelectTerritory }: {
  territories: Territory[]; totalShops: number; lang: string;
  fmt: (v: number | string | null | undefined, opts?: { decimals?: number }) => string;
  onSelectAll: () => void; onSelectTerritory: (city: string, district?: string) => void;
}) {
  const t = (ru: string, uz: string) => lang === "uz" ? uz : ru;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "16px" }}>
      {/* All shops card */}
      <div className="kpi-hero" style={{
        borderRadius: "24px", padding: "24px", cursor: "pointer",
        animation: "slideUp 0.4s ease forwards",
        display: "flex", flexDirection: "column", justifyContent: "space-between",
      }}
      onClick={onSelectAll}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.transform = "translateY(-2px)"; (e.currentTarget as HTMLElement).style.boxShadow = "0 4px 20px rgba(0,0,0,0.08)"; }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.transform = "translateY(0)"; (e.currentTarget as HTMLElement).style.boxShadow = SHADOW; }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "16px" }}>
          <span style={{ fontFamily: F.display, fontSize: "10px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: COLORS.textTertiary }}>
            {t("ВСЕ МАГАЗИНЫ", "BARCHA DO'KONLAR")}
          </span>
          <div style={{ width: "44px", height: "44px", borderRadius: "12px", background: "linear-gradient(135deg, #5b6d8a, #5b6d8a)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Store size={20} color="#fff" />
          </div>
        </div>
        <div style={{ fontFamily: F.display, fontSize: "32px", fontWeight: 700, color: COLORS.textPrimary, lineHeight: 1, letterSpacing: "-0.03em" }}>
          {totalShops}
        </div>
        <span style={{ fontSize: "12px", color: COLORS.textSecondary, marginTop: "6px" }}>
          {t("магазинов", "do'kon")}
        </span>
      </div>

      {/* Territory cards */}
      {territories.map((t_: Territory, i: number) => {
        const debt = Number(t_.totalDebt ?? 0);
        return (
          <div key={`${t_.city}-${t_.district}`} className="kpi-hero" style={{
            borderRadius: "24px", padding: "24px", cursor: "pointer",
            animation: `slideUp ${0.4 + (i + 1) * 0.05}s ease forwards`,
            display: "flex", flexDirection: "column", justifyContent: "space-between",
          }}
          onClick={() => onSelectTerritory(t_.city, t_.district || undefined)}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.transform = "translateY(-2px)"; (e.currentTarget as HTMLElement).style.boxShadow = "0 4px 20px rgba(0,0,0,0.08)"; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.transform = "translateY(0)"; (e.currentTarget as HTMLElement).style.boxShadow = SHADOW; }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "16px" }}>
              <span style={{ fontFamily: F.display, fontSize: "10px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: COLORS.textTertiary }}>
                {[t_.city, t_.district].filter(Boolean).join(", ").toUpperCase()}
              </span>
              <div style={{ width: "44px", height: "44px", borderRadius: "12px", background: debt > 0 ? "linear-gradient(135deg, #d45050, #d45050)" : "linear-gradient(135deg, #34c473, #22c47a)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <MapPin size={20} color="#fff" />
              </div>
            </div>
            <div style={{ fontFamily: F.display, fontSize: "32px", fontWeight: 700, color: COLORS.textPrimary, lineHeight: 1, letterSpacing: "-0.03em" }}>
              {t_.count}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "6px" }}>
              <span style={{ fontSize: "12px", color: COLORS.textSecondary }}>
                {t("магазинов", "do'kon")}
              </span>
              {debt > 0 && (
                <span style={{
                  display: "inline-flex", alignItems: "center", gap: "4px", fontSize: "11px", fontWeight: 600,
                  padding: "2px 8px", borderRadius: "9999px", background: "rgba(232,80,80,.15)",
                  color: "#d45050", fontFamily: F.body, marginLeft: "auto",
                }}>
                  <AlertCircle size={10} />{fmt(debt, { decimals: 0 })}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
