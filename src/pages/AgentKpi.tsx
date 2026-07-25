import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { useLang } from "@/i18n";
import { useCurrency } from "@/hooks/useCurrency";
import { notify } from "@/lib/toast";
import { COLORS, F, SHADOW } from "@/components/products/constants";

interface KpiData {
  agentId: number; agentName: string; period: string;
  totalPlans: number; visitedPlans: number; skippedPlans: number; visitCompletionRate: number;
  orderCount: number; revenue: number; avgOrderValue: number;
  returnCount: number; returnRate: number;
  deliveryCount: number; deliveredCount: number; failedCount: number; deliverySuccessRate: number; cashCollected: number;
  assignedShops: number; totalDebt: number; debtCollectionRate: number;
  kpiScore: number; kpiGrade: string;
  gpsPings: number; lastGpsTime: string | null; isOnline: boolean;
  visitReportCount: number; lastReportTime: string | null;
}

interface SalaryData {
  agentId: number; agentName: string; period: string;
  baseSalary: number; commissionRate: number; salesAmount: number;
  commissionAmount: number; kpiScore: number; bonusAmount: number; totalSalary: number;
}

const PERIODS = [
  { value: "week" as const, ru: "Неделя", uz: "Hafta" },
  { value: "month" as const, ru: "Месяц", uz: "Oy" },
  { value: "quarter" as const, ru: "Квартал", uz: "Chorak" },
];

const GRADES: Record<string, { color: string; ru: string; uz: string }> = {
  A: { color: "#34c473", ru: "Отлично", uz: "Ajoyib" },
  B: { color: "#5b6d8a", ru: "Хорошо", uz: "Yaxshi" },
  C: { color: "#d4973a", ru: "Удовл.", uz: "Qoniqarli" },
  D: { color: "#d45050", ru: "Плохо", uz: "Yomon" },
  F: { color: "#d45050", ru: "Критично", uz: "Juda yomon" },
};

export default function AgentKpi() {
  const { lang } = useLang();
  const { fmt } = useCurrency();
  const t = (ru: string, uz: string) => lang === "uz" ? uz : ru;
  const [period, setPeriod] = useState<"week" | "month" | "quarter">("month");
  const { data: user } = trpc.auth.me.useQuery();

  const isSupervisor = user?.role === "ceo" || user?.role === "operator" || user?.role === "supervisor";

  const { data: myKpi, isLoading: myLoading } = trpc.kpi.agentKpi.useQuery({ period }, { enabled: !isSupervisor });
  const { data: allKpi, isLoading: allLoading } = trpc.kpi.supervisorKpi.useQuery({ period }, { enabled: isSupervisor });
  const { data: salaryReport } = trpc.kpi.salaryReport.useQuery({ period }, { enabled: isSupervisor });
  const { data: mySalary } = trpc.kpi.salary.useQuery({ period }, { enabled: !isSupervisor });

  const isLoading = isSupervisor ? allLoading : myLoading;

  return (
    <div className="space-y-5 animate-fade-up">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 style={{ fontFamily: F.display, fontSize: "24px", fontWeight: 700, color: COLORS.textPrimary, letterSpacing: "-0.02em" }}>
            {isSupervisor ? t("KPI Агентов", "Agentlar KPI") : t("KPI Агента", "Agent KPI")}
          </h1>
          <p style={{ fontSize: "13px", color: COLORS.textSecondary, marginTop: "4px" }}>
            {isSupervisor ? `${allKpi?.length ?? 0} ${t("агентов", "agentlar")}` : myKpi?.agentName}
          </p>
        </div>
        <div className="flex gap-1.5">
          {PERIODS.map(p => (
            <button key={p.value} onClick={() => setPeriod(p.value)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${period === p.value ? "bg-[#5b6d8a] text-white" : "bg-[var(--color-surface-light)] text-[var(--color-text-secondary)]"}`}>
              {lang === "uz" ? p.uz : p.ru}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 rounded-full border-3 border-[var(--color-border)] border-t-[#5b6d8a] animate-spin" />
        </div>
      ) : isSupervisor ? (
        <SupervisorView kpi={allKpi ?? []} salaries={salaryReport ?? []} fmt={fmt} t={t} lang={lang} />
      ) : myKpi ? (
        <AgentView kpi={myKpi} salary={mySalary} fmt={fmt} t={t} lang={lang} />
      ) : null}
    </div>
  );
}

// ── Agent View ────────────────────────────────────────────────────────────────

function AgentView({ kpi, salary, fmt, t, lang }: { kpi: KpiData; salary?: SalaryData; fmt: (v: number) => string; t: (r: string, u: string) => string; lang: string }) {
  const grade = GRADES[kpi.kpiGrade] ?? GRADES.F;
  return (
    <>
      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <KpiCard label={t("Балл", "Ball")} value={`${kpi.kpiScore}`} sub={grade[lang]} color={grade.color} icon="★" />
        <KpiCard label={t("План", "Reja")} value={`${kpi.visitCompletionRate}%`} sub={`${kpi.visitedPlans}/${kpi.totalPlans}`} color="#5b6d8a" icon="◎" />
        <KpiCard label={t("Заказы", "Buyurtma")} value={String(kpi.orderCount)} sub={fmt(kpi.revenue)} color="#34c473" icon="🛒" />
        <KpiCard label={t("Средний чек", "O'rtacha")} value={fmt(kpi.avgOrderValue)} color="#d4973a" icon="$" />
        <KpiCard label={t("Возвраты", "Qaytarish")} value={`${kpi.returnRate}%`} sub={`${kpi.returnCount} шт`} color={kpi.returnRate > 10 ? "#d45050" : "#34c473"} icon="⚠" />
        <KpiCard label={t("Магазины", "Do'kon")} value={String(kpi.assignedShops)} sub={fmt(kpi.totalDebt) + " долг"} color="#7a6db5" icon="🏪" />
      </div>

      {/* Score Breakdown */}
      <div className="neo-card p-5">
        <h3 style={{ fontFamily: F.display, fontSize: "14px", fontWeight: 600, color: COLORS.textPrimary, marginBottom: "14px" }}>
          {t("Детализация балла", "Ball tafsilotlari")}
        </h3>
        <div className="space-y-3">
          <ScoreBar label={t("План", "Reja")} value={kpi.visitCompletionRate} weight={30} color="#5b6d8a" />
          <ScoreBar label={t("Выручка", "Tushum")} value={Math.min(100, Math.round((kpi.revenue / 10_000_000) * 100))} weight={25} color="#34c473" />
          <ScoreBar label={t("Конверсия", "Konversiya")} value={kpi.orderCount > 0 && kpi.totalPlans > 0 ? Math.round((kpi.orderCount / kpi.totalPlans) * 100) : 0} weight={20} color="#d4973a" />
          <ScoreBar label={t("Без возвратов", "Qaytarishsiz")} value={100 - kpi.returnRate} weight={15} color="#7a6db5" />
          <ScoreBar label={t("Долги", "Qarz")} value={kpi.debtCollectionRate} weight={10} color="#3a9a8a" />
        </div>
      </div>

      {/* Salary */}
      {salary && (
        <div className="neo-card p-5">
          <h3 style={{ fontFamily: F.display, fontSize: "14px", fontWeight: 600, color: COLORS.textPrimary, marginBottom: "14px" }}>
            {t("Зарплата", "Oylik")}
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <SalaryItem label={t("Оклад", "Oylik")} value={fmt(salary.baseSalary)} />
            <SalaryItem label={t("Комиссия", "Komissiya")} value={`${fmt(salary.commissionAmount)} (${salary.commissionRate}%)`} />
            <SalaryItem label={t("Бонус", "Bonus")} value={fmt(salary.bonusAmount)} />
            <SalaryItem label={t("ИТОГО", "JAMI")} value={fmt(salary.totalSalary)} bold />
          </div>
        </div>
      )}

      {/* Visits + GPS + Reports */}
      <div className="grid grid-cols-3 gap-3">
        <StatCard label={t("Всего визитов", "Jami tashrif")} value={String(kpi.totalPlans)} sub={`${kpi.visitedPlans} ${t("посещено", "tashrif")}`} />
        <StatCard label={t("GPS пингов", "GPS ping")} value={String(kpi.gpsPings)} sub={kpi.isOnline ? t("Онлайн", "Onlayn") : t("Оффлайн", "Oflayn")} />
        <StatCard label={t("Фотоотчёты", "Foto hisobot")} value={String(kpi.visitReportCount)} sub={kpi.lastReportTime ? "✓" : "—"} />
      </div>

      {/* Delivery (for couriers) */}
      {kpi.deliveryCount > 0 && (
        <div className="neo-card p-5">
          <h3 style={{ fontFamily: F.display, fontSize: "14px", fontWeight: 600, color: COLORS.textPrimary, marginBottom: "14px" }}>
            {t("Доставки", "Yetkazish")}
          </h3>
          <div className="grid grid-cols-4 gap-3">
            <StatCard label={t("Всего", "Jami")} value={String(kpi.deliveryCount)} />
            <StatCard label={t("Доставлено", "Yetkazilgan")} value={String(kpi.deliveredCount)} />
            <StatCard label={t("Ошибки", "Xato")} value={String(kpi.failedCount)} />
            <StatCard label={t("Собрано", "Yig'ilgan")} value={fmt(kpi.cashCollected)} />
          </div>
        </div>
      )}
    </>
  );
}

// ── Supervisor View ───────────────────────────────────────────────────────────

function SupervisorView({ kpi, salaries, fmt, t, lang }: { kpi: KpiData[]; salaries: SalaryData[]; fmt: (v: number) => string; t: (r: string, u: string) => string; lang: string }) {
  const [selected, setSelected] = useState<number | null>(null);
  const selectedKpi = selected ? kpi.find(a => a.agentId === selected) : null;
  const selectedSalary = selected ? salaries.find(s => s.agentId === selected) : null;

  return (
    <>
      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard label={t("Агентов", "Agentlar")} value={String(kpi.length)} color="#5b6d8a" icon="👥" />
        <KpiCard label={t("Средний балл", "O'rtacha")} value={String(Math.round(kpi.reduce((s, k) => s + k.kpiScore, 0) / (kpi.length || 1)))} color="#5b6d8a" icon="★" />
        <KpiCard label={t("Выручка", "Tushum")} value={fmt(kpi.reduce((s, k) => s + k.revenue, 0))} color="#34c473" icon="$" />
        <KpiCard label={t("ФОТ", "Oylik")} value={fmt(salaries.reduce((s, r) => s + r.totalSalary, 0))} color="#d4973a" icon="💰" />
      </div>

      {/* Agents ranking */}
      <div className="neo-card p-5">
        <h3 style={{ fontFamily: F.display, fontSize: "14px", fontWeight: 600, color: COLORS.textPrimary, marginBottom: "14px" }}>
          {t("Рейтинг", "Reyting")}
        </h3>
        <div className="space-y-2">
          {kpi.map((a, i) => {
            const grade = GRADES[a.kpiGrade] ?? GRADES.F;
            return (
              <div key={a.agentId} onClick={() => setSelected(selected === a.agentId ? null : a.agentId)}
                className={`flex items-center gap-3 p-3 rounded-xl cursor-pointer transition-all border ${selected === a.agentId ? "border-[#5b6d8a] bg-[var(--color-surface-light)]" : "border-transparent hover:bg-[var(--color-surface-light)]"}`}>
                <div className="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold"
                  style={{ background: i < 3 ? ["#d4973a", "#9ca3af", "#cd7f32"][i] : "var(--color-surface-light)", color: i < 3 ? "#fff" : COLORS.textSecondary }}>
                  {i + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate" style={{ color: COLORS.textPrimary }}>{a.agentName}</p>
                  <p className="text-xs" style={{ color: COLORS.textSecondary }}>{a.orderCount} {t("заказов", "buyurtma")} • {fmt(a.revenue)}</p>
                </div>
                <span className="px-2.5 py-1 rounded-lg text-xs font-bold" style={{ background: `${grade.color}15`, color: grade.color }}>
                  {a.kpiScore} • {a.kpiGrade}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Selected agent details */}
      {selectedKpi && <AgentView kpi={selectedKpi} salary={selectedSalary} fmt={fmt} t={t} lang={lang} />}
    </>
  );
}

// ── Shared Components ─────────────────────────────────────────────────────────

function KpiCard({ label, value, sub, color, icon }: { label: string; value: string; sub?: string; color: string; icon: string }) {
  return (
    <div className="neo-card p-4 flex items-center justify-between" style={{ borderLeft: `4px solid ${color}` }}>
      <div>
        <p className="text-[11px] font-medium" style={{ color: COLORS.textSecondary }}>{label}</p>
        <p style={{ fontFamily: F.display, fontSize: "22px", fontWeight: 700, color: COLORS.textPrimary }}>{value}</p>
        {sub && <p className="text-[11px]" style={{ color: COLORS.textTertiary }}>{sub}</p>}
      </div>
      <span className="text-xl opacity-40">{icon}</span>
    </div>
  );
}

function ScoreBar({ label, value, weight, color }: { label: string; value: number; weight: number; color: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-32 text-xs shrink-0" style={{ color: COLORS.textSecondary }}>{label} ({weight}%)</span>
      <div className="flex-1 h-2 rounded-full" style={{ background: "var(--color-surface-light)" }}>
        <div className="h-full rounded-full transition-all" style={{ width: `${value}%`, background: color }} />
      </div>
      <span className="w-10 text-right text-xs font-semibold" style={{ color: COLORS.textPrimary }}>{value}</span>
    </div>
  );
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="neo-card p-4 text-center">
      <p style={{ fontFamily: F.display, fontSize: "20px", fontWeight: 700, color: COLORS.textPrimary }}>{value}</p>
      <p className="text-xs font-medium" style={{ color: COLORS.textSecondary }}>{label}</p>
      {sub && <p className="text-[11px] mt-0.5" style={{ color: COLORS.textTertiary }}>{sub}</p>}
    </div>
  );
}

function SalaryItem({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="p-3 rounded-xl" style={{ background: "var(--color-surface-light)", borderLeft: `3px solid ${COLORS.border}` }}>
      <p className="text-[11px]" style={{ color: COLORS.textSecondary }}>{label}</p>
      <p style={{ fontFamily: F.display, fontSize: bold ? "16px" : "14px", fontWeight: bold ? 700 : 600, color: COLORS.textPrimary }}>{value}</p>
    </div>
  );
}
