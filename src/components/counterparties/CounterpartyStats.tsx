import { Users, Wallet, AlertTriangle, TrendingDown } from "lucide-react";
import { F, COLORS, money } from "./constants";

/**
 * Плитка сводки. Две валюты умещаются в одну плитку намеренно: долг в сумах и
 * в долларах — не два разных показателя, а один, просто в разных деньгах.
 * Разносить их по отдельным плиткам значило бы удвоить строку KPI и заставить
 * читателя складывать глазами то, что складывать нельзя.
 */
function DebtCard({ label, uzs, usd, icon, gradient, delay, danger }: {
  label: string; uzs: number; usd: number;
  icon: React.ReactNode; gradient: string; delay: number; danger?: boolean;
}) {
  const color = danger && (uzs > 0 || usd > 0) ? COLORS.dangerText : COLORS.textPrimary;
  return (
    <div className="kpi-hero" style={{
      borderRadius: "24px", padding: "24px", position: "relative", overflow: "hidden",
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
      <div style={{ fontFamily: F.display, fontSize: "26px", fontWeight: 700, color, lineHeight: 1.1, letterSpacing: "-0.03em" }}>
        {money(uzs, "UZS")}
      </div>
      {/* Долларовая строка появляется, только если такие долги вообще есть:
          у большинства организаций их нет, и вечный «0 USD» был бы шумом. */}
      {usd > 0 && (
        <div style={{ fontFamily: F.display, fontSize: "16px", fontWeight: 600, color, marginTop: "6px" }}>
          {money(usd, "USD")}
        </div>
      )}
    </div>
  );
}

function CountCard({ label, value, hint, icon, gradient, delay }: {
  label: string; value: string; hint?: string;
  icon: React.ReactNode; gradient: string; delay: number;
}) {
  return (
    <div className="kpi-hero" style={{
      borderRadius: "24px", padding: "24px", position: "relative", overflow: "hidden",
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
      {hint && (
        <div style={{ fontSize: "12px", color: COLORS.textTertiary, marginTop: "10px", fontFamily: F.body }}>
          {hint}
        </div>
      )}
    </div>
  );
}

export interface CounterpartyStatsData {
  suppliersTotal: number; debtorsCount: number;
  debtUzs: number; debtUsd: number;
  overdueUzs: number; overdueUsd: number;
  paid30Uzs: number; paid30Usd: number;
}

export function CounterpartyStats({ stats, lang }: { stats: CounterpartyStatsData; lang: string }) {
  const t = (ru: string, uz: string) => lang === "uz" ? uz : ru;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "16px" }}>
      <CountCard
        label={t("КОНТРАГЕНТОВ", "KONTRAGENTLAR")}
        value={String(stats.suppliersTotal)}
        hint={stats.debtorsCount > 0 ? t(`с долгом: ${stats.debtorsCount}`, `qarzdor: ${stats.debtorsCount}`) : undefined}
        icon={<Users size={20} color="#fff" />}
        gradient="var(--color-primary)"
        delay={0}
      />
      <DebtCard
        label={t("МЫ ДОЛЖНЫ", "BIZ QARZDORMIZ")}
        uzs={stats.debtUzs} usd={stats.debtUsd}
        icon={<Wallet size={20} color="#fff" />}
        gradient="linear-gradient(135deg, #fb923c, #f97316)"
        delay={0.05}
      />
      <DebtCard
        label={t("ПРОСРОЧЕНО", "MUDDATI O'TGAN")}
        uzs={stats.overdueUzs} usd={stats.overdueUsd}
        icon={<AlertTriangle size={20} color="#fff" />}
        gradient="linear-gradient(135deg, var(--color-danger), var(--color-danger))"
        delay={0.1}
        danger
      />
      <DebtCard
        label={t("ОПЛАЧЕНО ЗА 30 ДНЕЙ", "30 KUNDA TO'LANGAN")}
        uzs={stats.paid30Uzs} usd={stats.paid30Usd}
        icon={<TrendingDown size={20} color="#fff" />}
        gradient="linear-gradient(135deg, #16a34a, #22c47a)"
        delay={0.15}
      />
    </div>
  );
}
