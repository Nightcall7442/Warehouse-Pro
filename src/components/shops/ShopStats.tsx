import { Store, Users, AlertCircle, DollarSign, ArrowUpRight, ArrowDownRight, Minus } from "lucide-react";
import { F, COLORS } from "./constants";

function KpiCard({ label, value, delta, icon, gradient, delay }: {
  label: string; value: string; delta: number | null;
  icon: React.ReactNode; gradient: string; delay: number;
}) {
  const isPositive = delta !== null && delta > 0;
  const isNegative = delta !== null && delta < 0;
  return (
    <div className="kpi-hero" style={{
      borderRadius: "24px", padding: "24px",
      position: "relative", overflow: "hidden",
      animation: `slideUp ${0.5 + delay}s ease forwards`,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "16px" }}>
        <span style={{ fontFamily: F.display, fontSize: "10px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: COLORS.textTertiary }}>
          {label}
        </span>
        <div style={{ width: "44px", height: "44px", borderRadius: "12px", background: gradient, display: "flex", alignItems: "center", justifyContent: "center" }}>
          {icon}
        </div>
      </div>
      <div style={{ fontFamily: F.display, fontSize: "32px", fontWeight: 700, color: COLORS.textPrimary, lineHeight: 1, letterSpacing: "-0.03em" }}>
        {value}
      </div>
      {delta !== null && (
        <div style={{
          display: "flex", alignItems: "center", gap: "4px", marginTop: "10px",
          fontSize: "12px", fontWeight: 600, fontFamily: F.body,
          color: isPositive ? "#34c473" : isNegative ? "#d45050" : COLORS.textTertiary,
        }}>
          {isPositive ? <ArrowUpRight size={14} /> : isNegative ? <ArrowDownRight size={14} /> : <Minus size={14} />}
          {Math.abs(delta).toFixed(1)}%
        </div>
      )}
    </div>
  );
}

export interface ShopKpiStats { total: number; activeCount: number; debtCount: number; totalDebt: number; }

export function ShopStats({ stats, lang, fmt }: { stats: ShopKpiStats; lang: string; fmt: (v: number | string | null | undefined, opts?: { decimals?: number }) => string }) {
  const t = (ru: string, uz: string) => lang === "uz" ? uz : ru;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "16px" }}>
      <KpiCard
        label={t("ВСЕГО МАГАЗИНОВ", "JAMI DO'KONLAR")}
        value={String(stats.total)}
        delta={null}
        icon={<Store size={20} color="#fff" />}
        gradient="linear-gradient(135deg, #5b6d8a, #5b6d8a)"
        delay={0}
      />
      <KpiCard
        label={t("АКТИВНЫЕ", "FAOLLAR")}
        value={String(stats.activeCount)}
        delta={null}
        icon={<Users size={20} color="#fff" />}
        gradient="linear-gradient(135deg, #16a34a, #22c47a)"
        delay={0.05}
      />
      <KpiCard
        label={t("С ДОЛГОМ", "QARZDOR")}
        value={String(stats.debtCount)}
        delta={null}
        icon={<AlertCircle size={20} color="#fff" />}
        gradient="linear-gradient(135deg, #fb923c, #f97316)"
        delay={0.1}
      />
      <KpiCard
        label={t("ОБЩИЙ ДОЛГ", "UMUMIY QARZ")}
        value={fmt(stats.totalDebt, { decimals: 0 })}
        delta={null}
        icon={<DollarSign size={20} color="#fff" />}
        gradient="linear-gradient(135deg, #d45050, #d45050)"
        delay={0.15}
      />
    </div>
  );
}
