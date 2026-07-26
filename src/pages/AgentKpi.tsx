import { useState, useCallback } from "react";
import { trpc } from "@/providers/trpc";
import { useLang } from "@/i18n";
import { useCurrency } from "@/hooks/useCurrency";
import { notify } from "@/lib/toast";
import { COLORS, F } from "@/components/products/constants";
import { exportToExcel } from "@/lib/excel";
import { Settings, Loader2, FileDown, Target, ShoppingCart, DollarSign, Users, Package, Star, MapPin, AlertTriangle } from "lucide-react";
import { ProgressRing } from "@/components/ProgressRing";
import { RadarChart, PolarGrid, PolarAngleAxis, Radar } from "recharts";

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
  suspiciousVisits: number; fraudRate: number; avgVisitDuration: number;
  targetRevenue: number; targetProgress: number;
}

interface SalaryData {
  agentId: number; agentName: string; period: string;
  baseSalary: number; commissionRate: number; salesAmount: number;
  commissionAmount: number; kpiScore: number; bonusAmount: number; totalSalary: number;
  breakdown: { base: number; commission: number; bonus: number; fraudDeduction: number };
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
  const t = useCallback((ru: string, uz: string) => lang === "uz" ? uz : ru, [lang]);
  const [period, setPeriod] = useState<"week" | "month" | "quarter">("month");
  const { data: user } = trpc.auth.me.useQuery();

  const isSupervisor = user?.role === "ceo" || user?.role === "operator" || user?.role === "supervisor";

  const { data: myKpi, isLoading: myLoading } = trpc.kpi.agentKpi.useQuery({ period }, { enabled: !isSupervisor });
  const { data: allKpi, isLoading: allLoading } = trpc.kpi.supervisorKpi.useQuery({ period }, { enabled: isSupervisor });
  const { data: salaryReport } = trpc.kpi.salaryReport.useQuery({ period }, { enabled: isSupervisor });
  const { data: mySalary } = trpc.kpi.salary.useQuery({ period }, { enabled: !isSupervisor });

  const isLoading = isSupervisor ? allLoading : myLoading;

  const handleExport = useCallback(async () => {
    if (!isSupervisor || !allKpi) return;
    const rows = allKpi.map((a, i) => ({
      "#": i + 1, "Агент": a.agentName, "Балл": a.kpiScore, "Грейд": a.kpiGrade,
      "Заказы": a.orderCount, "Выручка": a.revenue, "Средний чек": a.avgOrderValue,
      "Визиты": `${a.visitedPlans}/${a.totalPlans}`, "Фрод %": a.fraudRate,
      "Таргет": a.targetRevenue, "Прогресс %": a.targetProgress,
    }));
    await exportToExcel(rows, `kpi-agents-${period}`, "KPI Агентов", `KPI ${period}`);
  }, [allKpi, isSupervisor, period]);

  return (
    <div className="space-y-5">
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
        <div className="flex gap-1.5 items-center">
          {PERIODS.map(p => (
            <button key={p.value} onClick={() => setPeriod(p.value)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${period === p.value ? "bg-[#5b6d8a] text-white" : "bg-[var(--color-surface-light)] text-[var(--color-text-secondary)]"}`}>
              {lang === "uz" ? p.uz : p.ru}
            </button>
          ))}
          {isSupervisor && allKpi && allKpi.length > 0 && (
            <button onClick={handleExport} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-[var(--color-surface-light)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface)]">
              <FileDown size={14} /> Excel
            </button>
          )}
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
      {/* Hero KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 stagger-children">
        <KpiHero label={t("Общий балл", "Umumiy ball")} value={`${kpi.kpiScore}`} sub={grade[lang]} color={grade.color} progress={kpi.kpiScore / 100} icon={<Star size={20} color={grade.color} />} />
        <KpiHero label={t("План", "Reja")} value={`${kpi.visitCompletionRate}%`} sub={`${kpi.visitedPlans}/${kpi.totalPlans}`} color="#5b6d8a" progress={kpi.visitCompletionRate / 100} icon={<Target size={20} color="#5b6d8a" />} />
        <KpiHero label={t("Заказы", "Buyurtma")} value={String(kpi.orderCount)} sub={fmt(kpi.revenue)} color="#34c473" progress={Math.min(1, kpi.orderCount / 50)} icon={<ShoppingCart size={20} color="#34c473" />} />
        <KpiHero label={t("Средний чек", "O'rtacha")} value={fmt(kpi.avgOrderValue)} color="#d4973a" progress={Math.min(1, kpi.avgOrderValue / 100000)} icon={<DollarSign size={20} color="#d4973a" />} />
        <KpiHero label={t("Возвраты", "Qaytarish")} value={`${kpi.returnRate}%`} sub={`${kpi.returnCount} шт`} color={kpi.returnRate > 10 ? "#d45050" : "#34c473"} progress={1 - kpi.returnRate / 100} icon={<AlertTriangle size={20} color={kpi.returnRate > 10 ? "#d45050" : "#34c473"} />} />
        <KpiHero label={t("Магазины", "Do'kon")} value={String(kpi.assignedShops)} sub={fmt(kpi.totalDebt) + " долг"} color="#7a6db5" progress={Math.min(1, kpi.assignedShops / 20)} icon={<Package size={20} color="#7a6db5" />} />
      </div>

      {/* Score Breakdown + KPI Radar */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
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

        {/* KPI Radar Chart */}
        <div className="neo-card p-5">
          <h3 style={{ fontFamily: F.display, fontSize: "14px", fontWeight: 600, color: COLORS.textPrimary, marginBottom: "14px" }}>
            {t("Профиль агента", "Agent profili")}
          </h3>
          <ResponsiveContainer width="100%" height={220}>
            <RadarChart data={[
              { metric: t("План", "Reja"), value: kpi.visitCompletionRate },
              { metric: t("Выручка", "Tushum"), value: Math.min(100, Math.round((kpi.revenue / 10_000_000) * 100)) },
              { metric: t("Конверсия", "Konversiya"), value: kpi.orderCount > 0 && kpi.totalPlans > 0 ? Math.round((kpi.orderCount / kpi.totalPlans) * 100) : 0 },
              { metric: t("Возвраты", "Qaytarish"), value: 100 - kpi.returnRate },
              { metric: t("Долги", "Qarz"), value: kpi.debtCollectionRate },
              { metric: t("Фрод", "Frod"), value: 100 - kpi.fraudRate },
            ]}>
              <PolarGrid stroke="var(--color-border)" />
              <PolarAngleAxis dataKey="metric" tick={{ fontSize: 11, fill: "var(--color-text-secondary)" }} />
              <Radar name="KPI" dataKey="value" stroke="#5b6d8a" fill="#5b6d8a" fillOpacity={0.15} strokeWidth={2} />
            </RadarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Revenue Target */}
      {kpi.targetRevenue > 0 && (
        <div className="neo-card p-5">
          <h3 style={{ fontFamily: F.display, fontSize: "14px", fontWeight: 600, color: COLORS.textPrimary, marginBottom: "14px" }}>
            {t("Таргет по выручке", "Tushum maqsadi")}
          </h3>
          <div className="flex items-center gap-4">
            <ProgressRing value={kpi.targetProgress} size={80} strokeWidth={6} color={kpi.targetProgress >= 100 ? "#34c473" : kpi.targetProgress >= 70 ? "#d4973a" : "#d45050"} />
            <div className="flex-1">
              <div className="flex justify-between mb-1">
                <span className="text-xs" style={{ color: COLORS.textSecondary }}>{fmt(kpi.revenue)} / {fmt(kpi.targetRevenue)}</span>
                <span className="text-xs font-bold" style={{ color: kpi.targetProgress >= 100 ? "#34c473" : kpi.targetProgress >= 70 ? "#d4973a" : "#d45050" }}>
                  {kpi.targetProgress}%
                </span>
              </div>
              <div className="h-2.5 rounded-full" style={{ background: "var(--color-surface-light)" }}>
                <div className="h-full rounded-full transition-all" style={{
                  width: `${Math.min(100, kpi.targetProgress)}%`,
                  background: kpi.targetProgress >= 100 ? "#34c473" : kpi.targetProgress >= 70 ? "#d4973a" : "#d45050",
                }} />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Fraud Alerts */}
      {kpi.suspiciousVisits > 0 && (
        <div className="neo-card p-5" style={{ borderLeft: "4px solid #d45050" }}>
          <h3 style={{ fontFamily: F.display, fontSize: "14px", fontWeight: 600, color: "#d45050", marginBottom: "14px" }}>
            {t("⚠ Подозрительная активность", "⚠ Shubhali faoliyat")}
          </h3>
          <div className="grid grid-cols-3 gap-3">
            <StatCard label={t("Подозр. визитов", "Shubhali tashrif")} value={String(kpi.suspiciousVisits)} />
            <StatCard label={t("Уровень фрода", "Daraja")} value={`${kpi.fraudRate}%`} />
            <StatCard label={t("Ср. время визита", "O'rtacha vaqt")} value={`${kpi.avgVisitDuration} мин`} />
          </div>
        </div>
      )}

      {/* Salary */}
      {salary && <SalarySection salary={salary} fmt={fmt} t={t} />}

      {/* Visits + GPS + Reports */}
      <div className="grid grid-cols-3 gap-3">
        <StatCard label={t("Всего визитов", "Jami tashrif")} value={String(kpi.totalPlans)} sub={`${kpi.visitedPlans} ${t("посещено", "tashrif")}`} />
        <StatCard label={t("GPS пингов", "GPS ping")} value={String(kpi.gpsPings)} sub={kpi.isOnline ? t("Онлайн", "Onlayn") : t("Оффлайн", "Oflayn")} />
        <StatCard label={t("Фотоотчёты", "Foto hisobot")} value={String(kpi.visitReportCount)} sub={kpi.lastReportTime ? "✓" : "—"} />
      </div>

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

// ── Salary Section ─────────────────────────────────────────────────────────────

function SalarySection({ salary, fmt, t }: { salary: SalaryData; fmt: (v: number) => string; t: (r: string, u: string) => string }) {
  return (
    <div className="neo-card p-5">
      <h3 style={{ fontFamily: F.display, fontSize: "14px", fontWeight: 600, color: COLORS.textPrimary, marginBottom: "14px" }}>
        {t("Зарплата", "Oylik")}
      </h3>
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-4">
        <SalaryItem label={t("Оклад", "Oylik")} value={fmt(salary.baseSalary)} />
        <SalaryItem label={t("Комиссия", "Komissiya")} value={`${fmt(salary.commissionAmount)} (${salary.commissionRate}%)`} />
        <SalaryItem label={t("Бонус", "Bonus")} value={fmt(salary.bonusAmount)} />
        {salary.breakdown.fraudDeduction < 0 && (
          <SalaryItem label={t("Штраф фрод", "Jazo")} value={fmt(salary.breakdown.fraudDeduction)} danger />
        )}
        <SalaryItem label={t("ИТОГО", "JAMI")} value={fmt(salary.totalSalary)} bold />
      </div>
      <div className="p-3 rounded-xl" style={{ background: "var(--color-surface-light)", border: "1px solid var(--color-border)" }}>
        <p className="text-[10px] font-semibold tracking-wider uppercase mb-2" style={{ color: COLORS.textTertiary }}>
          {t("Детализация расчёта", "Hisoblash tafsilotlari")}
        </p>
        <div className="space-y-1.5 text-xs" style={{ color: COLORS.textSecondary }}>
          <div className="flex justify-between"><span>{t("Выручка за период", "Davr uchun tushum")}</span><span className="font-semibold" style={{ color: COLORS.textPrimary }}>{fmt(salary.salesAmount)}</span></div>
          <div className="flex justify-between"><span>{t("Ставка комиссии", "Komissiya stavkasi")}</span><span className="font-semibold" style={{ color: COLORS.textPrimary }}>{salary.commissionRate}%</span></div>
          <div className="flex justify-between"><span>{t("Расчёт комиссии", "Komissiya hisoblash")}</span><span className="font-semibold" style={{ color: COLORS.textPrimary }}>{fmt(salary.salesAmount)} × {salary.commissionRate}% = {fmt(salary.commissionAmount)}</span></div>
          <div className="flex justify-between"><span>{t("KPI балл", "KPI bali")}</span><span className="font-semibold" style={{ color: COLORS.textPrimary }}>{salary.kpiScore}/100</span></div>
          <div className="flex justify-between"><span>{t("Расчёт бонуса", "Bonus hisoblash")}</span><span className="font-semibold" style={{ color: COLORS.textPrimary }}>2% × {fmt(salary.salesAmount)} × {salary.kpiScore}/100 = {fmt(salary.bonusAmount)}</span></div>
          {salary.breakdown.fraudDeduction < 0 && (
            <div className="flex justify-between"><span>{t("Штраф за фрод", "Frod uchun jazo")}</span><span className="font-semibold" style={{ color: "#d45050" }}>{fmt(salary.baseSalary)} × {Math.round((Math.abs(salary.breakdown.fraudDeduction) / salary.baseSalary) * 100)}% = {fmt(salary.breakdown.fraudDeduction)}</span></div>
          )}
          <div className="flex justify-between pt-1.5 mt-1.5" style={{ borderTop: "1px solid var(--color-border)" }}>
            <span className="font-semibold" style={{ color: COLORS.textPrimary }}>{t("ИТОГО К ВЫПЛАТЕ", "JAMI TO'LOV")}</span>
            <span className="font-bold" style={{ color: "#34c473", fontSize: "14px" }}>{fmt(salary.totalSalary)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Supervisor View ───────────────────────────────────────────────────────────

function SupervisorView({ kpi, salaries, fmt, t, lang }: { kpi: KpiData[]; salaries: SalaryData[]; fmt: (v: number) => string; t: (r: string, u: string) => string; lang: string }) {
  const [selected, setSelected] = useState<number | null>(null);
  const [showSalaryConfig, setShowSalaryConfig] = useState(false);
  const [territoryFilter, setTerritoryFilter] = useState<string>("all");
  const { data: territories } = trpc.territory.list.useQuery();

  const selectedKpi = selected ? kpi.find(a => a.agentId === selected) : null;
  const selectedSalary = selected ? salaries.find(s => s.agentId === selected) : null;

  const filteredKpi = territoryFilter === "all" ? kpi : kpi.filter(() => true);

  const totalRevenue = filteredKpi.reduce((s, k) => s + k.revenue, 0);
  const totalOrders = filteredKpi.reduce((s, k) => s + k.orderCount, 0);
  const totalVisits = filteredKpi.reduce((s, k) => s + k.visitedPlans, 0);
  const totalSalary = salaries.reduce((s, r) => s + r.totalSalary, 0);
  const avgScore = filteredKpi.length > 0 ? Math.round(filteredKpi.reduce((s, k) => s + k.kpiScore, 0) / filteredKpi.length) : 0;
  const suspiciousTotal = filteredKpi.reduce((s, k) => s + k.suspiciousVisits, 0);

  return (
    <>
      {/* Filters */}
      <div className="neo-card p-4">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium" style={{ color: COLORS.textSecondary }}>{t("Территория", "Territoriya")}</label>
            <select value={territoryFilter} onChange={e => setTerritoryFilter(e.target.value)}
              className="neo-input text-xs py-1.5 px-3" style={{ width: "160px" }}>
              <option value="all">{t("Все территории", "Barcha territoriyalar")}</option>
              {(territories ?? []).map((ter: { id: number; name: string }) => (
                <option key={ter.id} value={String(ter.id)}>{ter.name}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 stagger-children">
        <KpiHero label={t("Агентов", "Agentlar")} value={String(filteredKpi.length)} color="#5b6d8a" progress={1} icon={<Users size={20} color="#5b6d8a" />} />
        <KpiHero label={t("Средний балл", "O'rtacha")} value={String(avgScore)} color="#5b6d8a" progress={avgScore / 100} icon={<Star size={20} color="#5b6d8a" />} />
        <KpiHero label={t("Выручка", "Tushum")} value={fmt(totalRevenue)} color="#34c473" progress={Math.min(1, totalRevenue / 10_000_000)} icon={<DollarSign size={20} color="#34c473" />} />
        <KpiHero label={t("Заказы", "Buyurtma")} value={String(totalOrders)} color="#5b6d8a" progress={Math.min(1, totalOrders / 500)} icon={<ShoppingCart size={20} color="#5b6d8a" />} />
        <KpiHero label={t("Визиты", "Tashrif")} value={String(totalVisits)} color="#d4973a" progress={Math.min(1, totalVisits / 200)} icon={<MapPin size={20} color="#d4973a" />} />
        <KpiHero label={t("ФОТ", "Oylik")} value={fmt(totalSalary)} color="#d4973a" progress={Math.min(1, totalSalary / 5_000_000)} icon={<DollarSign size={20} color="#d4973a" />} />
      </div>

      {suspiciousTotal > 0 && (
        <div className="neo-card p-4" style={{ borderLeft: "4px solid #d45050" }}>
          <span className="text-sm font-semibold" style={{ color: "#d45050" }}>
            ⚠ {t("Подозрительная активность", "Shubhali faoliyat")}: {suspiciousTotal} {t("визитов", "tashrif")}
          </span>
        </div>
      )}

      {/* Agent Table */}
      <div className="neo-card overflow-hidden">
        <div className="flex items-center justify-between p-4 border-b" style={{ borderColor: "var(--color-border)" }}>
          <h3 style={{ fontFamily: F.display, fontSize: "14px", fontWeight: 600, color: COLORS.textPrimary }}>
            {t("Дашборд агентов", "Agentlar dashboard")}
          </h3>
          <button onClick={() => setShowSalaryConfig(!showSalaryConfig)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
            style={{ background: showSalaryConfig ? "rgba(75,108,246,.10)" : "var(--color-surface-light)", color: showSalaryConfig ? "#5b6d8a" : COLORS.textSecondary }}>
            <Settings size={14} /> {t("Настройка ЗП", "Oylik sozlash")}
          </button>
        </div>

        {showSalaryConfig && <div className="p-4 border-b" style={{ borderColor: "var(--color-border)" }}><SalaryConfig t={t} /></div>}

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: "var(--color-surface-light)" }}>
                {["", t("Агент", "Agent"), t("Балл", "Ball"), t("Заказы", "Buyurtma"), t("Выручка", "Tushum"), t("Визиты", "Tashrif"), t("Фрод", "Frod"), t("Зарплата", "Oylik")].map((h, i) => (
                  <th key={i} className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider" style={{ color: COLORS.textTertiary }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredKpi.map((a, i) => {
                const grade = GRADES[a.kpiGrade] ?? GRADES.F;
                const salary = salaries.find(s => s.agentId === a.agentId);
                return (
                  <tr key={a.agentId} onClick={() => setSelected(selected === a.agentId ? null : a.agentId)}
                    className="cursor-pointer transition-all hover:bg-[var(--color-surface-light)]"
                    style={{ borderBottom: "1px solid var(--color-border)", background: selected === a.agentId ? "var(--color-surface-light)" : "transparent" }}>
                    <td className="px-3 py-2.5">
                      <div className="w-6 h-6 rounded-md flex items-center justify-center text-[10px] font-bold"
                        style={{ background: i < 3 ? ["#d4973a", "#9ca3af", "#cd7f32"][i] : "var(--color-surface-light)", color: i < 3 ? "#fff" : COLORS.textSecondary }}>
                        {i + 1}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 font-semibold" style={{ color: COLORS.textPrimary }}>{a.agentName}</td>
                    <td className="px-3 py-2.5"><span className="px-2 py-0.5 rounded text-xs font-bold" style={{ background: `${grade.color}15`, color: grade.color }}>{a.kpiScore} • {a.kpiGrade}</span></td>
                    <td className="px-3 py-2.5" style={{ color: COLORS.textPrimary }}>{a.orderCount}</td>
                    <td className="px-3 py-2.5 font-semibold" style={{ color: COLORS.textPrimary }}>{fmt(a.revenue)}</td>
                    <td className="px-3 py-2.5" style={{ color: COLORS.textPrimary }}>{a.visitedPlans}/{a.totalPlans}</td>
                    <td className="px-3 py-2.5">
                      {a.suspiciousVisits > 0 ? (
                        <span className="px-2 py-0.5 rounded text-xs font-bold" style={{ background: "rgba(212,80,80,.10)", color: "#d45050" }}>{a.suspiciousVisits} ({a.fraudRate}%)</span>
                      ) : <span className="text-xs" style={{ color: COLORS.textTertiary }}>✓</span>}
                    </td>
                    <td className="px-3 py-2.5 font-semibold" style={{ color: COLORS.textPrimary }}>{fmt(salary?.totalSalary ?? 0)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {selectedKpi && <AgentView kpi={selectedKpi} salary={selectedSalary} fmt={fmt} t={t} lang={lang} />}
    </>
  );
}

// ── Salary Config ─────────────────────────────────────────────────────────────

function SalaryConfig({ t }: { t: (r: string, u: string) => string }) {
  const { data: usersData } = trpc.user.list.useQuery({ page: 1, pageSize: 100 });
  const { data: commissionData } = trpc.commission.list.useQuery();
  const utils = trpc.useContext();
  const [rates, setRates] = useState<Record<number, number>>({});

  const agents = (usersData?.data ?? []).filter((u: { role: string; status: string }) => u.role === "agent" && u.status === "active");

  const setRateMutation = trpc.commission.setRate.useMutation({
    onSuccess: () => { utils.commission.list.invalidate(); notify.success(t("Комиссия сохранена", "Komissiya saqlandi")); },
    onError: (e) => notify.error(e.message),
  });

  const calcMutation = trpc.commission.calculate.useMutation({
    onSuccess: () => { utils.commission.list.invalidate(); notify.success(t("Комиссия рассчитана", "Komissiya hisoblandi")); },
    onError: (e) => notify.error(e.message),
  });

  const getRate = (agentId: number) => {
    if (rates[agentId] !== undefined) return rates[agentId];
    const record = (commissionData ?? []).find((c: { userId: number; commissionRate: string | number }) => c.userId === agentId);
    return record ? Math.round(Number(record.commissionRate) * 10) / 10 : 0;
  };

  const handleCalc = () => {
    const now = new Date();
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split("T")[0];
    const periodEnd = now.toISOString().split("T")[0];
    calcMutation.mutate({ periodType: "monthly", periodStart, periodEnd });
  };

  return (
    <div className="p-4 rounded-xl" style={{ background: "var(--color-surface-light)", border: "1px solid var(--color-border)" }}>
      <p className="text-xs mb-3" style={{ color: COLORS.textSecondary }}>
        {t("Настройте комиссию (%) для каждого агента", "Har bir agent uchun komissiya (%) ni sozlang")}
      </p>
      <div className="space-y-2">
        {agents.map((agent: { id: number; name: string }) => {
          const rate = getRate(agent.id);
          return (
            <div key={agent.id} className="flex items-center gap-3 p-2 rounded-lg" style={{ background: "var(--color-surface, #fff)", border: "1px solid var(--color-border)" }}>
              <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: "rgba(75,108,246,.10)" }}>
                <span className="text-xs font-bold" style={{ color: "#5b6d8a" }}>{agent.name.charAt(0).toUpperCase()}</span>
              </div>
              <span className="text-sm flex-1 truncate" style={{ color: COLORS.textPrimary }}>{agent.name}</span>
              <div className="flex items-center gap-2">
                <input type="number" min="0" max="50" step="0.5" value={rate}
                  onChange={(e) => setRates(prev => ({ ...prev, [agent.id]: parseFloat(e.target.value) || 0 }))}
                  onBlur={(e) => { const val = parseFloat(e.target.value) || 0; if (val >= 0 && val <= 50) setRateMutation.mutate({ userId: agent.id, commissionRate: val }); }}
                  className="w-20 text-center text-sm py-1.5 px-2 rounded-lg outline-none"
                  style={{ background: "var(--color-surface, #fff)", border: "1.5px solid var(--color-border)", color: COLORS.textPrimary, fontFamily: F.display, fontWeight: 600 }} />
                <span className="text-xs font-medium" style={{ color: COLORS.textSecondary }}>%</span>
              </div>
            </div>
          );
        })}
      </div>
      <p className="text-xs mb-2" style={{ color: COLORS.textTertiary }}>
        {t("Комиссии рассчитываются автоматически при просмотре зарплаты", "Ko'rish vaqtida komissiyalar avtomatik hisoblanadi")}
      </p>
      <button onClick={handleCalc} disabled={calcMutation.isPending}
        className="mt-2 w-full py-2.5 rounded-xl text-sm font-semibold flex items-center justify-center gap-2"
        style={{ background: "linear-gradient(135deg, #5b6d8a, #4a5c78)", color: "#fff", boxShadow: "0 4px 12px rgba(91,109,138,0.3)" }}>
        {calcMutation.isPending && <Loader2 size={14} className="animate-spin" />}
        {t("Пересчитать комиссии", "Komissiyalarni qayta hisoblash")}
      </button>
    </div>
  );
}

// ── Shared Components ─────────────────────────────────────────────────────────

function KpiHero({ label, value, sub, color, progress, icon }: {
  label: string; value: string; sub?: string; color: string; progress: number; icon: React.ReactNode;
}) {
  return (
    <div className="kpi-hero stagger-children">
      <div style={{ display: "flex", gap: "6px", marginBottom: "12px" }}>
        <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: color, boxShadow: "var(--shadow-xs)" }} />
        <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: color, opacity: 0.5, boxShadow: "var(--shadow-xs)" }} />
        <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: color, opacity: 0.3, boxShadow: "var(--shadow-xs)" }} />
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ flex: 1 }}>
          <p className="kpi-hero-label">{label}</p>
          <p className="kpi-hero-value" style={{ fontSize: "24px", marginTop: "8px" }}>{value}</p>
          {sub && <p style={{ fontSize: "12px", color: "var(--color-text-secondary)", marginTop: "4px" }}>{sub}</p>}
        </div>
        <div className="neo-progress-ring" style={{ width: "56px", height: "56px", flexShrink: 0 }}>
          <svg width="48" height="48" viewBox="0 0 48 48" style={{ transform: "rotate(-90deg)" }}>
            <circle cx="24" cy="24" r="20" fill="none" stroke="var(--color-border)" strokeWidth="4" />
            <circle cx="24" cy="24" r="20" fill="none" stroke={color} strokeWidth="4" strokeLinecap="round"
              strokeDasharray={2 * Math.PI * 20}
              strokeDashoffset={2 * Math.PI * 20 * (1 - Math.min(1, progress))}
              style={{ transition: "stroke-dashoffset 0.6s cubic-bezier(0.16,1,0.3,1)" }} />
          </svg>
          <div style={{ position: "absolute", display: "flex", alignItems: "center", justifyContent: "center" }}>
            {icon}
          </div>
        </div>
      </div>
    </div>
  );
}

function ScoreBar({ label, value, weight, color }: { label: string; value: number; weight: number; color: string }) {
  return (
    <div>
      <div className="flex justify-between mb-1">
        <span className="text-xs" style={{ color: COLORS.textSecondary }}>{label} ({weight}%)</span>
        <span className="text-xs font-semibold" style={{ color: COLORS.textPrimary }}>{value}%</span>
      </div>
      <div className="h-2 rounded-full" style={{ background: "var(--color-surface-light)" }}>
        <div className="h-full rounded-full transition-all" style={{ width: `${value}%`, background: color }} />
      </div>
    </div>
  );
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="neo-card p-4">
      <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: COLORS.textTertiary }}>{label}</p>
      <p style={{ fontFamily: F.display, fontSize: "20px", fontWeight: 700, color: COLORS.textPrimary, marginTop: "6px" }}>{value}</p>
      {sub && <p style={{ fontSize: "11px", color: COLORS.textSecondary, marginTop: "2px" }}>{sub}</p>}
    </div>
  );
}

function SalaryItem({ label, value, bold, danger }: { label: string; value: string; bold?: boolean; danger?: boolean }) {
  return (
    <div className="p-3 rounded-xl" style={{ background: danger ? "rgba(212,80,80,.08)" : "var(--color-surface-light)", borderLeft: `3px solid ${danger ? "#d45050" : COLORS.border}` }}>
      <p className="text-[11px]" style={{ color: danger ? "#d45050" : COLORS.textSecondary }}>{label}</p>
      <p style={{ fontFamily: F.display, fontSize: bold ? "16px" : "14px", fontWeight: bold ? 700 : 600, color: danger ? "#d45050" : COLORS.textPrimary }}>{value}</p>
    </div>
  );
}
