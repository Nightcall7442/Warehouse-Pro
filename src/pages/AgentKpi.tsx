import { useState, useCallback, useMemo } from "react";
import { useCan } from "@/hooks/useCan";
import { trpc } from "@/providers/trpc";
import { useLang, type Lang } from "@/i18n";
import { useCurrency } from "@/hooks/useCurrency";
import { notify } from "@/lib/toast";
import { COLORS, F } from "@/components/products/constants";
import { exportToExcel } from "@/lib/excel";
import { Settings, Loader2, FileDown, Target, ShoppingCart, DollarSign, Users, Package, PackageCheck, PackageX, Star, MapPin, AlertTriangle, Truck } from "lucide-react";
import { ProgressRing } from "@/components/ProgressRing";
import { RadarChart, PolarGrid, PolarAngleAxis, Radar, ResponsiveContainer } from "recharts";
import { PremiumSelect } from "@/components/PremiumSelect";
import { colorMix } from "@/lib/color-mix";
import { CourierKpiView } from "@/components/kpi/CourierKpiView";
import { CourierDaysChart } from "@/components/kpi/CourierDaysChart";
import { CommissionLedger } from "@/components/kpi/CommissionLedger";

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

interface AgentListEntry {
  agentId: number; agentName: string;
  orderCount: number; revenue: number;
  totalPlans: number; visitedPlans: number;
  kpiScore: number; kpiGrade: string;
  suspiciousVisits: number; fraudRate: number;
}

interface SalaryData {
  agentId: number; agentName: string; period: string;
  baseSalary: number; commissionRate: number; salesAmount: number;
  commissionAmount: number; kpiScore: number; bonusAmount: number;
  deliveryRate: number; deliveredCount: number; deliveryPay: number;
  totalSalary: number;
  breakdown: { base: number; commission: number; bonus: number; fraudDeduction: number; delivery: number };
}

const PERIODS = [
  { value: "week" as const, ru: "Неделя", uz: "Hafta" },
  { value: "month" as const, ru: "Месяц", uz: "Oy" },
  { value: "quarter" as const, ru: "Квартал", uz: "Chorak" },
];

const GRADES: Record<string, { color: string; ru: string; uz: string }> = {
  A: { color: "var(--color-success-text)", ru: "Отлично", uz: "Ajoyib" },
  B: { color: "var(--color-primary-text)", ru: "Хорошо", uz: "Yaxshi" },
  C: { color: "var(--color-warning-text)", ru: "Удовл.", uz: "Qoniqarli" },
  D: { color: "var(--color-danger-text)", ru: "Плохо", uz: "Yomon" },
  F: { color: "var(--color-danger-text)", ru: "Критично", uz: "Juda yomon" },
};

export default function AgentKpi() {
  const { lang } = useLang();
  const { fmt } = useCurrency();
  const t = useCallback((ru: string, uz: string) => lang === "uz" ? uz : ru, [lang]);
  const [period, setPeriod] = useState<"week" | "month" | "quarter">("month");
  const { data: user } = trpc.auth.me.useQuery();

  const isSupervisor = user?.role === "ceo" || user?.role === "operator" || user?.role === "supervisor";
  /*
    Курьер видит свой экран, а не агентский.

    Раньше он попадал в ветку «не начальник», и страница запрашивала ему
    агентский KPI и зарплату. Оба запроса курьеру отвечали отказом, и пункт
    «KPI» в его панели всегда вёл в «не удалось загрузить».

    Пустить его в агентский вид было бы не лучше: там визиты, заказы,
    средний чек, возвраты и магазины — у курьера всего этого нет, он увидел
    бы экран нулей. Считать ему есть что своё: доставки и собранные деньги,
    и то и другое расчёт уже берёт по нему самому.

    Зарплату ему теперь считают по-своему — фиксированной суммой за каждую
    довезённую заявку, а не процентом от оформленного. Раньше запрос был
    отключён именно потому, что агентский расчёт давал «оклад и три нуля».
  */
  const isCourier = user?.role === "courier";
  /*
    Оператор приравнен к директору — решение владельца.

    По правам он теперь видит то же, что руководитель: список агентов и
    разбор по каждому. А своя зарплата у него фиксированная: комиссия
    считается процентом от заказов, которые человек ОФОРМИЛ, а оператор их
    не оформляет — и комиссия, и премия выходят нулём сами собой. Значит его
    итог равен окладу, который заведён ему в плановой сумме.

    Показать оклад нужно отдельно: страница считает оператора начальником, и
    в этой ветке своя зарплата не запрашивалась вовсе — он не видел её ни
    здесь, ни где-либо ещё.
  */
  const isOperator = user?.role === "operator";

  /*
    Курьеру агентский расчёт не запрашивается: все его строки — визиты, планы,
    выручка, средний чек — меряют оформление заказов, которых у курьера нет.
    Ответ был бы полон нулей, и оценка «F» к работе человека отношения не
    имеет. Свои числа он берёт из courierKpi.
  */
  const { data: myKpi, isLoading: myLoading } = trpc.kpi.agentKpi.useQuery({ period }, { enabled: !isSupervisor && !isCourier });
  const { data: agentList, isLoading: listLoading } = trpc.kpi.agentList.useQuery({ period }, { enabled: isSupervisor });
    /*
    Курьеру зарплата теперь считается и показывается.

    Запрос был отключён именно для него — и не зря: агентский расчёт давал ему
    «оклад и три нуля», потому что комиссия считается процентом от заказов,
    которые человек ОФОРМИЛ, а курьер их не оформляет. Теперь у него свой
    расчёт: фиксированная сумма за каждую довезённую заявку.
  */
  const { data: mySalary } = trpc.kpi.salary.useQuery({ period }, { enabled: !isSupervisor || isOperator });
  const { data: courierStats, isLoading: courierLoading } = trpc.kpi.courierKpi.useQuery({ period }, { enabled: isCourier });

  const [selectedAgentId, setSelectedAgentId] = useState<number | null>(null);
  const { data: selectedKpi, isLoading: detailLoading } = trpc.kpi.agentDetail.useQuery(
    { agentId: selectedAgentId!, period },
    { enabled: isSupervisor && selectedAgentId !== null },
  );
  const { data: selectedSalary } = trpc.kpi.salary.useQuery(
    { period },
    { enabled: isSupervisor && selectedAgentId !== null },
  );

  const allKpi = useMemo(() => agentList ?? [], [agentList]);
  const isLoading = isSupervisor ? listLoading : isCourier ? courierLoading : myLoading;

  const handleExport = useCallback(async () => {
    // Роль проверяется молча — кнопки у агента и нет вовсе. А вот пустой
    // список отдаётся выгрузке: она объяснит его словами.
    if (!isSupervisor) return;
    const rows = (allKpi ?? []).map((a, i) => ({
      "#": i + 1, "Агент": a.agentName, "Балл": a.kpiScore, "Грейд": a.kpiGrade,
      "Заказы": a.orderCount, "Выручка": a.revenue,
      "Визиты": `${a.visitedPlans}/${a.totalPlans}`, "Фрод %": a.fraudRate,
    }));
    await exportToExcel(rows, `kpi-agents-${period}`, "KPI Агентов", `KPI ${period}`);
  }, [allKpi, isSupervisor, period]);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 style={{ fontFamily: F.display, fontSize: "24px", fontWeight: 700, color: COLORS.textPrimary, letterSpacing: "-0.02em" }}>
            {isSupervisor ? t("KPI Агентов", "Agentlar KPI") : isCourier ? t("Мои доставки", "Yetkazishlarim") : t("KPI Агента", "Agent KPI")}
          </h1>
          <p style={{ fontSize: "13px", color: COLORS.textSecondary, marginTop: "4px" }}>
            {isSupervisor ? `${allKpi?.length ?? 0} ${t("агентов", "agentlar")}` : isCourier ? courierStats?.courierName : myKpi?.agentName}
          </p>
        </div>
        <div className="flex gap-2 items-center flex-wrap">
          {/*
            Домашний переключатель периода — .range-pills, как на главной и в
            отчётах.

            Здесь была своя пара классов, и выбранная кнопка красилась белым по
            фирменному цвету. В тёмной теме фирменный — золотой, и белым по
            нему выходит 2.42:1 при норме 4.5. Ровно эта же ошибка уже
            разбиралась у кнопки подтверждения: цвет надписи на заливке берут
            из палитры, а не пишут словом «белый».
          */}
          <div role="group" aria-label={t("Период", "Davr")} className="range-pills">
            {PERIODS.map(p => (
              <button key={p.value} type="button" onClick={() => setPeriod(p.value)}
                aria-pressed={period === p.value}
                className={"range-pill tap" + (period === p.value ? " active" : "")}>
                {lang === "uz" ? p.uz : p.ru}
              </button>
            ))}
          </div>
          {isSupervisor && allKpi && allKpi.length > 0 && (
            <button onClick={handleExport} className="neo-btn tap" style={{ padding: "0 14px" }}>
              <FileDown size={14} aria-hidden /> Excel
            </button>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 rounded-full border-3 border-[var(--color-border)] border-t-[var(--color-primary)] animate-spin" />
        </div>
      ) : isCourier ? (
        /*
          У курьера свой экран.

          Агентский показывал ему визиты, планы, выручку и оценку «F» — всё это
          меряет оформление заказов, которых курьер не оформляет. Он не работал
          плохо: его мерили не тем.
        */
        <CourierKpiView
          stats={courierStats ?? { delivered: 0, failed: 0, returned: 0, deliveredAmount: 0, cashCollected: 0, successRate: 0 }}
          salary={mySalary ?? null}
          fmt={fmt}
          t={t}
        />
      ) : isSupervisor ? (
        <>
          {/* Оклад оператора. Показываем, только когда он заведён: карточка
              с нулём выдавала бы за настоящую цифру то, что просто не
              заполнено, — а заводится оклад плановой суммой по сотруднику. */}
          {isOperator && mySalary && mySalary.totalSalary > 0 && (
            <div className="neo-card" style={{ padding: "16px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
              <div>
                <p style={{ margin: 0, fontSize: "11px", letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--color-text-tertiary)" }}>
                  {t("Мой оклад", "Mening maoshim")}
                </p>
                <p style={{ margin: "2px 0 0", fontSize: "13px", color: "var(--color-text-tertiary)" }}>{mySalary.period}</p>
              </div>
              <p data-testid="operator-salary" style={{ margin: 0, fontSize: "22px", fontWeight: 700, color: "var(--color-primary-text)", fontVariantNumeric: "tabular-nums" }}>
                {fmt(mySalary.totalSalary)}
              </p>
            </div>
          )}
          <SupervisorView kpi={allKpi} period={period} selectedKpi={selectedKpi ?? null} selectedSalary={selectedSalary} detailLoading={detailLoading} onSelect={setSelectedAgentId} selectedAgentId={selectedAgentId} fmt={fmt} t={t} lang={lang} />
      </>
      ) : myKpi ? (
        <AgentView kpi={myKpi} salary={mySalary} fmt={fmt} t={t} lang={lang} />
      ) : null}
    </div>
  );
}

// ── Agent View ────────────────────────────────────────────────────────────────

function AgentView({ kpi, salary, fmt, t, lang }: { kpi: KpiData; salary?: SalaryData; fmt: (v: number) => string; t: (r: string, u: string) => string; lang: Lang }) {
  const grade = GRADES[kpi.kpiGrade] ?? GRADES.F;
  return (
    <>
      {/* Hero KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 stagger-children">
        <KpiHero label={t("Общий балл", "Umumiy ball")} value={`${kpi.kpiScore}`} sub={grade[lang]} color={grade.color} progress={kpi.kpiScore / 100} icon={<Star size={20} color={grade.color} />} />
        <KpiHero label={t("План", "Reja")} value={`${kpi.visitCompletionRate}%`} sub={`${kpi.visitedPlans}/${kpi.totalPlans}`} color="var(--color-primary-text)" progress={kpi.visitCompletionRate / 100} icon={<Target size={20} color="var(--color-primary-text)" />} />
        <KpiHero label={t("Заказы", "Buyurtma")} value={String(kpi.orderCount)} sub={fmt(kpi.revenue)} color="var(--color-success-text)" progress={Math.min(1, kpi.orderCount / 50)} icon={<ShoppingCart size={20} color="var(--color-success-text)" />} />
        <KpiHero label={t("Средний чек", "O'rtacha")} value={fmt(kpi.avgOrderValue)} color="var(--color-warning-text)" progress={Math.min(1, kpi.avgOrderValue / 100000)} icon={<DollarSign size={20} color="var(--color-warning-text)" />} />
        <KpiHero label={t("Возвраты", "Qaytarish")} value={`${kpi.returnRate}%`} sub={`${kpi.returnCount} шт`} color={kpi.returnRate > 10 ? "var(--color-danger-text)" : "var(--color-success-text)"} progress={1 - kpi.returnRate / 100} icon={<AlertTriangle size={20} color={kpi.returnRate > 10 ? "var(--color-danger-text)" : "var(--color-success-text)"} />} />
        <KpiHero label={t("Магазины", "Do'kon")} value={String(kpi.assignedShops)} sub={fmt(kpi.totalDebt) + " долг"} color="#7a6db5" progress={Math.min(1, kpi.assignedShops / 20)} icon={<Package size={20} color="#7a6db5" />} />
      </div>

      {/* Score Breakdown + KPI Radar */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="neo-card p-5">
          <h3 style={{ fontFamily: F.display, fontSize: "14px", fontWeight: 600, color: COLORS.textPrimary, marginBottom: "14px" }}>
            {t("Детализация балла", "Ball tafsilotlari")}
          </h3>
          <div className="space-y-3">
            <ScoreBar label={t("План", "Reja")} value={kpi.visitCompletionRate} weight={30} color="var(--color-primary-text)" />
            <ScoreBar label={t("Выручка", "Tushum")} value={Math.min(100, Math.round((kpi.revenue / 10_000_000) * 100))} weight={25} color="var(--color-success-text)" />
            <ScoreBar label={t("Конверсия", "Konversiya")} value={kpi.orderCount > 0 && kpi.totalPlans > 0 ? Math.round((kpi.orderCount / kpi.totalPlans) * 100) : 0} weight={20} color="var(--color-warning-text)" />
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
              <Radar name="KPI" dataKey="value" stroke="var(--color-primary)" fill="var(--color-primary)" fillOpacity={0.15} strokeWidth={2} />
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
            <ProgressRing value={kpi.targetProgress} size={80} strokeWidth={6} color={kpi.targetProgress >= 100 ? "var(--color-success-text)" : kpi.targetProgress >= 70 ? "var(--color-warning-text)" : "var(--color-danger-text)"} />
            <div className="flex-1">
              <div className="flex justify-between mb-1">
                <span className="text-xs" style={{ color: COLORS.textSecondary }}>{fmt(kpi.revenue)} / {fmt(kpi.targetRevenue)}</span>
                <span className="text-xs font-bold" style={{ color: kpi.targetProgress >= 100 ? "var(--color-success-text)" : kpi.targetProgress >= 70 ? "var(--color-warning-text)" : "var(--color-danger-text)" }}>
                  {kpi.targetProgress}%
                </span>
              </div>
              <div className="h-2.5 rounded-full" style={{ background: "var(--color-surface-light)" }}>
                <div className="h-full rounded-full transition-all" style={{
                  width: `${Math.min(100, kpi.targetProgress)}%`,
                  background: kpi.targetProgress >= 100 ? "var(--color-success)" : kpi.targetProgress >= 70 ? "var(--color-warning)" : "var(--color-danger)",
                }} />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Fraud Alerts */}
      {kpi.suspiciousVisits > 0 && (
        <div className="neo-card p-5" style={{ borderLeft: "4px solid #d45050" }}>
          <h3 style={{ fontFamily: F.display, fontSize: "14px", fontWeight: 600, color: "var(--color-danger-text)", marginBottom: "14px" }}>
            {t("⚠ Подозрительная активность", "⚠ Shubhali faoliyat")}
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <StatCard label={t("Подозр. визитов", "Shubhali tashrif")} value={String(kpi.suspiciousVisits)} />
            <StatCard label={t("Уровень фрода", "Daraja")} value={`${kpi.fraudRate}%`} />
            <StatCard label={t("Ср. время визита", "O'rtacha vaqt")} value={`${kpi.avgVisitDuration} мин`} />
          </div>
        </div>
      )}

      {/* Salary */}
      {salary && <SalarySection salary={salary} fmt={fmt} t={t} />}

      {/* Visits + GPS + Reports */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <StatCard label={t("Всего визитов", "Jami tashrif")} value={String(kpi.totalPlans)} sub={`${kpi.visitedPlans} ${t("посещено", "tashrif")}`} />
        <StatCard label={t("GPS пингов", "GPS ping")} value={String(kpi.gpsPings)} sub={kpi.isOnline ? t("Онлайн", "Onlayn") : t("Оффлайн", "Oflayn")} />
        <StatCard label={t("Фотоотчёты", "Foto hisobot")} value={String(kpi.visitReportCount)} sub={kpi.lastReportTime ? "✓" : "—"} />
      </div>

      {kpi.deliveryCount > 0 && (
        <div className="neo-card p-5">
          <h3 style={{ fontFamily: F.display, fontSize: "14px", fontWeight: 600, color: COLORS.textPrimary, marginBottom: "14px" }}>
            {t("Доставки", "Yetkazish")}
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
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
            <div className="flex justify-between"><span>{t("Штраф за фрод", "Frod uchun jazo")}</span><span className="font-semibold" style={{ color: "var(--color-danger-text)" }}>{fmt(salary.baseSalary)} × {Math.round((Math.abs(salary.breakdown.fraudDeduction) / salary.baseSalary) * 100)}% = {fmt(salary.breakdown.fraudDeduction)}</span></div>
          )}
          <div className="flex justify-between pt-1.5 mt-1.5" style={{ borderTop: "1px solid var(--color-border)" }}>
            <span className="font-semibold" style={{ color: COLORS.textPrimary }}>{t("ИТОГО К ВЫПЛАТЕ", "JAMI TO'LOV")}</span>
            <span className="font-bold" style={{ color: "var(--color-success-text)", fontSize: "14px" }}>{fmt(salary.totalSalary)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Supervisor View ───────────────────────────────────────────────────────────

function SupervisorView({ kpi, period, selectedKpi, selectedSalary, detailLoading, onSelect, selectedAgentId, fmt, t, lang }: {
  kpi: AgentListEntry[];
  period: "week" | "month" | "quarter";
  selectedKpi: KpiData | null;
  selectedSalary?: SalaryData;
  detailLoading: boolean;
  onSelect: (id: number | null) => void;
  selectedAgentId: number | null;
  fmt: (v: number) => string;
  t: (r: string, u: string) => string;
  lang: Lang;
}) {
  const { data: viewer } = trpc.auth.me.useQuery();
  const can = useCan();
  /*
    Ставки комиссии ставит тот, кому их разрешает сервер: commission.setRate —
    руководитель и оператор, а список агентов внутри (user.list) и вовсе
    только руководитель. Супервайзер на этот экран заходит по праву — команду
    он и должен видеть, — но настроить оплату не может.
  */
  const canConfigureSalary = (viewer?.role === "ceo" || viewer?.role === "operator") && can("commission.manage");

  /*
    Кого смотрим — агентов или курьеров.

    Курьеров на этом экране не было вовсе. Дописать их строками в агентскую
    таблицу нельзя: там заказы, выручка, визиты и оценка по визитам, а у
    курьера ничего этого нет — вышло бы четыре нуля и «F» на человеке, который
    весь месяц возил. Ровно эту ошибку уже исправляли на его собственном
    экране, и повторять её здесь незачем.
  */
  const [tab, setTab] = useState<"agents" | "couriers">("agents");
  const [selectedCourierId, setSelectedCourierId] = useState<number | null>(null);
  const { data: courierDetail, isLoading: courierDetailLoading } = trpc.kpi.courierDetail.useQuery(
    { courierId: selectedCourierId!, period },
    { enabled: tab === "couriers" && selectedCourierId !== null },
  );
  const { data: couriers, isLoading: couriersLoading } = trpc.kpi.courierList.useQuery(
    { period },
    { enabled: tab === "couriers" },
  );

  const [showSalaryConfig, setShowSalaryConfig] = useState(false);
  const [territoryFilter, setTerritoryFilter] = useState<string>("all");
  const { data: territories } = trpc.territory.list.useQuery();
  const { data: territoryKpiData } = trpc.kpi.territoryKpi.useQuery(
    { territoryId: Number(territoryFilter), period: "month" },
    { enabled: territoryFilter !== "all" }
  );

  const filteredKpi = territoryFilter === "all" ? kpi : (territoryKpiData?.agents ?? []);

  const totalRevenue = filteredKpi.reduce((s, k) => s + k.revenue, 0);
  const totalOrders = filteredKpi.reduce((s, k) => s + k.orderCount, 0);
  const totalVisits = filteredKpi.reduce((s, k) => s + k.visitedPlans, 0);
  const avgScore = filteredKpi.length > 0 ? Math.round(filteredKpi.reduce((s, k) => s + k.kpiScore, 0) / filteredKpi.length) : 0;
  const suspiciousTotal = filteredKpi.reduce((s, k) => s + k.suspiciousVisits, 0);

  const courierRows = couriers ?? [];
  const courierTotals = (() => {
    const delivered = courierRows.reduce((n, c) => n + c.delivered, 0);
    const failed = courierRows.reduce((n, c) => n + c.failed, 0);
    const assigned = delivered + failed;
    return {
      delivered, failed, assigned,
      // Доля считается от ОБЩЕГО назначенного, а не средним по людям: средним
      // курьер с двумя заявками весит столько же, сколько курьер с двумя сотнями.
      rate: assigned === 0 ? 0 : Math.round((delivered / assigned) * 100),
      deliveredAmount: courierRows.reduce((n, c) => n + c.deliveredAmount, 0),
      cash: courierRows.reduce((n, c) => n + c.cashCollected, 0),
    };
  })();

  return (
    <>
      {/* Filters */}
      <div className="neo-card p-4">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium" style={{ color: COLORS.textSecondary }}>{t("Территория", "Territoriya")}</label>
            <PremiumSelect
              value={territoryFilter}
              onChange={setTerritoryFilter}
              width="160px"
              aria-label={t("Территория", "Territoriya")}
              options={[
                { value: "all", label: t("Все территории", "Barcha territoriyalar") },
                ...(territories ?? []).map((ter: { id: number; name: string }) => ({ value: String(ter.id), label: ter.name })),
              ]}
            />
          </div>
        </div>
      </div>

      {/*
        Сводка под тех, кого смотрим.

        У курьера нет ни выручки, ни визитов, ни оценки по планам: показывать
        ему агентские плитки значило бы шесть нулей и вывод «команда не
        работает» там, где она весь месяц возила.
      */}
      {tab === "couriers" ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 stagger-children">
          <KpiHero label={t("Курьеров", "Kuryerlar")} value={String(courierRows.length)} color="var(--color-primary-text)" progress={1} icon={<Users size={20} color="var(--color-primary-text)" />} />
          <KpiHero label={t("Довезено", "Yetkazildi")} value={String(courierTotals.delivered)} color="var(--color-primary-text)" progress={Math.min(1, courierTotals.delivered / 200)} icon={<PackageCheck size={20} color="var(--color-primary-text)" />} />
          <KpiHero label={t("Сорвано", "Bajarilmadi")} value={String(courierTotals.failed)} color={courierTotals.failed > 0 ? "var(--color-danger-text)" : "var(--color-text-tertiary)"} progress={Math.min(1, courierTotals.failed / 50)} icon={<PackageX size={20} color={courierTotals.failed > 0 ? "var(--color-danger-text)" : "var(--color-text-tertiary)"} />} />
          <KpiHero label={t("Доля успешных", "Muvaffaqiyat")} value={courierTotals.assigned > 0 ? `${courierTotals.rate}%` : "—"} sub={courierTotals.assigned > 0 ? undefined : t("нечего мерить", "o'lchash uchun narsa yo'q")} color="var(--color-primary-text)" progress={courierTotals.rate / 100} icon={<Target size={20} color="var(--color-primary-text)" />} />
          <KpiHero label={t("Сумма довезённого", "Yetkazilgan summa")} value={fmt(courierTotals.deliveredAmount)} color="var(--color-primary-text)" progress={Math.min(1, courierTotals.deliveredAmount / 10_000_000)} icon={<Package size={20} color="var(--color-primary-text)" />} />
          <KpiHero label={t("Привезено денег", "Pul olib kelindi")} value={fmt(courierTotals.cash)} color="var(--color-primary-text)" progress={Math.min(1, courierTotals.cash / 10_000_000)} icon={<DollarSign size={20} color="var(--color-primary-text)" />} />
        </div>
      ) : (
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 stagger-children">
        <KpiHero label={t("Агентов", "Agentlar")} value={String(filteredKpi.length)} color="var(--color-primary-text)" progress={1} icon={<Users size={20} color="var(--color-primary-text)" />} />
        <KpiHero label={t("Средний балл", "O'rtacha")} value={String(avgScore)} color="var(--color-primary-text)" progress={avgScore / 100} icon={<Star size={20} color="var(--color-primary-text)" />} />
        <KpiHero label={t("Выручка", "Tushum")} value={fmt(totalRevenue)} color="var(--color-success-text)" progress={Math.min(1, totalRevenue / 10_000_000)} icon={<DollarSign size={20} color="var(--color-success-text)" />} />
        <KpiHero label={t("Заказы", "Buyurtma")} value={String(totalOrders)} color="var(--color-primary-text)" progress={Math.min(1, totalOrders / 500)} icon={<ShoppingCart size={20} color="var(--color-primary-text)" />} />
        <KpiHero label={t("Визиты", "Tashrif")} value={String(totalVisits)} color="var(--color-warning-text)" progress={Math.min(1, totalVisits / 200)} icon={<MapPin size={20} color="var(--color-warning-text)" />} />
        <KpiHero label={t("Фрод", "Frod")} value={String(suspiciousTotal)} color="var(--color-danger-text)" progress={Math.min(1, suspiciousTotal / 20)} icon={<AlertTriangle size={20} color="var(--color-danger-text)" />} />
      </div>
      )}

      {tab === "agents" && suspiciousTotal > 0 && (
        <div className="neo-card p-4" style={{ borderLeft: "4px solid #d45050" }}>
          <span className="text-sm font-semibold" style={{ color: "var(--color-danger-text)" }}>
            ⚠ {t("Подозрительная активность", "Shubhali faoliyat")}: {suspiciousTotal} {t("визитов", "tashrif")}
          </span>
        </div>
      )}

      {/* Agent Table */}
      <div className="neo-card overflow-hidden">
        <div className="flex items-center justify-between p-4 border-b gap-3 flex-wrap" style={{ borderColor: "var(--color-border)" }}>
          {/*
            «Дашборд агентов» переименован: слово чужое, а рядом стоит «Настройка
            ЗП» — на одном заголовке два языка. И называть надо не таблицу, а
            людей, которых в ней смотрят.
          */}
          <div role="tablist" aria-label={t("Кого смотрим", "Kimni ko'ramiz")} className="range-pills">
            {([["agents", t("Агенты", "Agentlar")], ["couriers", t("Курьеры", "Kuryerlar")]] as const).map(([key, label]) => (
              <button
                key={key}
                role="tab"
                aria-selected={tab === key}
                onClick={() => setTab(key)}
                className={"range-pill tap" + (tab === key ? " active" : "")}
              >
                {label}
              </button>
            ))}
          </div>
          {/*
            Только тем, кто может её сохранить.

            Внутри — user.list (ceo) и commission.setRate (ceo, оператор).
            Супервайзер видел кнопку, открывал пустой список агентов и
            получал отказ на любую ставку: обещание, которого экран
            выполнить не может.
          */}
          {canConfigureSalary && (
          <button onClick={() => setShowSalaryConfig(!showSalaryConfig)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
            style={{ background: showSalaryConfig ? "color-mix(in srgb, var(--color-primary) 10%, transparent)" : "var(--color-surface-light)", color: showSalaryConfig ? "var(--color-primary)" : COLORS.textSecondary }}>
            <Settings size={14} /> {t("Настройка ЗП", "Oylik sozlash")}
          </button>
          )}
        </div>

        {canConfigureSalary && showSalaryConfig && <div className="p-4 border-b" style={{ borderColor: "var(--color-border)" }}><SalaryConfig t={t} /></div>}

        {tab === "couriers" ? (
          <CourierTable
            rows={courierRows}
            loading={couriersLoading}
            selectedId={selectedCourierId}
            onSelect={id => setSelectedCourierId(selectedCourierId === id ? null : id)}
            fmt={fmt}
            t={t}
          />
        ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm" style={{ tableLayout: "fixed" }}>
            <colgroup>
              {/*
                Ширины заданы явно.

                Без них браузер раздаёт место поровну между семью колонками, и
                при коротких значениях («0», «нет») таблица растягивается на всю
                ширину экрана: имя жмётся к левому краю, числа уезжают к
                правому, а между ними — ладонь пустоты. Смотреть строку
                приходится в два приёма.
              */}
              <col style={{ width: "44px" }} />
              <col />
              <col style={{ width: "112px" }} />
              <col style={{ width: "92px" }} />
              <col style={{ width: "160px" }} />
              <col style={{ width: "104px" }} />
              <col style={{ width: "104px" }} />
            </colgroup>
            <thead>
              <tr style={{ background: "var(--color-surface-light)" }}>
                {/*
                  Числовые колонки прижаты вправо и набраны цифрами одной
                  ширины. Слева они не сравниваются глазом: «1 011 000» и
                  «0» начинались в одной точке и заканчивались в разных, и
                  столбец выручки читался как список слов, а не как числа.
                */}
                {[
                  { h: "", right: false },
                  { h: t("Агент", "Agent"), right: false },
                  { h: t("Балл", "Ball"), right: false },
                  { h: t("Заказы", "Buyurtma"), right: true },
                  { h: t("Выручка", "Tushum"), right: true },
                  { h: t("Визиты", "Tashrif"), right: true },
                  { h: t("Фрод", "Frod"), right: true },
                ].map((c, i) => (
                  <th key={i} className={`px-3 py-2.5 text-[10px] font-semibold uppercase tracking-wider ${c.right ? "text-right" : "text-left"}`}
                    style={{ color: COLORS.textTertiary }}>{c.h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredKpi.map((a, i) => {
                /*
                  Есть ли что мерить.

                  Ни заказов, ни планов — значит человеку ничего не назначали
                  или он не начинал. Балл в этом случае считается от нулей и
                  выходит «15 · F»: на экране это красная плашка и приговор
                  работе, которой не было. Все четыре строки у арендатора
                  горели красным именно поэтому.
                */
                const measurable = a.orderCount > 0 || a.totalPlans > 0;
                const grade = GRADES[a.kpiGrade] ?? GRADES.F;
                return (
                  <tr key={a.agentId} onClick={() => onSelect(selectedAgentId === a.agentId ? null : a.agentId)}
                    className="cursor-pointer transition-all hover:bg-[var(--color-surface-light)]"
                    style={{ borderBottom: "1px solid var(--color-border)", background: selectedAgentId === a.agentId ? "var(--color-surface-light)" : "transparent" }}>
                    <td className="px-3 py-2.5">
                      {/*
                        Место — бледной подложкой фирменного цвета, а не
                        золотом-серебром-бронзой. Медальные цвета в приложение
                        не входят, на тёмной теме серый с бронзой сливаются, а
                        белый текст поверх них теряет разборчивость. Такое же
                        решение уже принято в таблице агентов в отчётах.
                      */}
                      <div className="w-6 h-6 rounded-md flex items-center justify-center text-[10px] font-bold"
                        style={{
                          background: i < 3 ? colorMix("var(--color-primary)", 16) : "var(--color-surface-light)",
                          color: i < 3 ? "var(--color-primary-text)" : COLORS.textSecondary,
                        }}>
                        {i + 1}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 font-semibold truncate" style={{ color: COLORS.textPrimary }}>{a.agentName}</td>
                    <td className="px-3 py-2.5">
                      {measurable ? (
                        <span className="px-2 py-0.5 rounded text-xs font-bold" style={{ background: colorMix(grade.color, 8), color: grade.color }}>
                          {a.kpiScore} • {a.kpiGrade}
                        </span>
                      ) : (
                        <span className="text-xs" style={{ color: COLORS.textTertiary }}>{t("нет данных", "ma'lumot yo'q")}</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums" style={{ color: a.orderCount > 0 ? COLORS.textPrimary : COLORS.textTertiary }}>{a.orderCount}</td>
                    <td className="px-3 py-2.5 text-right font-semibold tabular-nums" style={{ color: a.revenue > 0 ? COLORS.textPrimary : COLORS.textTertiary }}>{a.revenue > 0 ? fmt(a.revenue) : "—"}</td>
                    {/* «0/0» — не результат, а отсутствие плана: визитов не
                        назначали, и сравнивать не с чем. */}
                    <td className="px-3 py-2.5 text-right tabular-nums" style={{ color: a.totalPlans > 0 ? COLORS.textPrimary : COLORS.textTertiary }}>
                      {a.totalPlans > 0 ? `${a.visitedPlans}/${a.totalPlans}` : "—"}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      {a.suspiciousVisits > 0 ? (
                        <span className="px-2 py-0.5 rounded text-xs font-bold" style={{ background: "var(--color-danger-subtle)", color: "var(--color-danger-text)" }}>{a.suspiciousVisits} ({a.fraudRate}%)</span>
                      ) : (
                        // Галочка в столбце «Фрод» читается как флажок, а не как
                        // ответ: непонятно, отмечен агент или проверен. Слово
                        // отвечает прямо.
                        <span className="text-xs" style={{ color: COLORS.textTertiary }}>{t("нет", "yo'q")}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        )}
      </div>

      {detailLoading && (
        <div className="flex items-center justify-center py-8">
          <div className="w-6 h-6 rounded-full border-2 border-[var(--color-border)] border-t-[var(--color-primary)] animate-spin" />
        </div>
      )}
      {tab === "agents" && selectedKpi && <AgentView kpi={selectedKpi} salary={selectedSalary} fmt={fmt} t={t} lang={lang} />}

      {tab === "couriers" && selectedCourierId !== null && (
        courierDetailLoading ? (
          <div className="flex items-center justify-center py-8">
            <div className="w-6 h-6 rounded-full border-2 border-[var(--color-border)] border-t-[var(--color-primary)] animate-spin" />
          </div>
        ) : courierDetail ? (
          <>
            {/* Показатели и оплата — тем же видом, что курьер видит у себя.
                Два разных вида одних и тех же чисел разошлись бы через месяц. */}
            <CourierKpiView stats={courierDetail.stats} salary={courierDetail.salary} fmt={fmt} t={t} />
            <div className="neo-card neo-card-static" style={{ padding: "20px 22px" }}>
              <p className="font-label" style={{ fontSize: "10px", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: COLORS.textTertiary, marginBottom: "14px" }}>
                {t("Ход по дням", "Kunlar bo'yicha")}
              </p>
              <CourierDaysChart days={courierDetail.daily} t={t} />
            </div>
          </>
        ) : null
      )}
    </>
  );
}

interface CourierRow {
  courierId: number;
  courierName: string;
  delivered: number;
  failed: number;
  returned: number;
  deliveredAmount: number;
  cashCollected: number;
  successRate: number;
}

/**
 * Курьеры — своей таблицей, а не строками в агентской.
 *
 * У курьера нет ни заказов, ни выручки, ни визитов, ни оценки по планам:
 * подмешав его к агентам, руководитель увидел бы четыре нуля и «F» на
 * человеке, который весь месяц возил. Здесь то, что курьер действительно
 * делает: довёз, сорвал, вернул, привёз ли деньги.
 */
function CourierTable({ rows, loading, selectedId, onSelect, fmt, t }: {
  rows: CourierRow[];
  loading: boolean;
  selectedId: number | null;
  onSelect: (id: number) => void;
  fmt: (v: number) => string;
  t: (r: string, u: string) => string;
}) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-10">
        <div className="w-6 h-6 rounded-full border-2 border-[var(--color-border)] border-t-[var(--color-primary)] animate-spin" />
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div style={{ padding: "40px 20px", textAlign: "center" }}>
        <Truck size={30} style={{ margin: "0 auto 10px", display: "block", color: COLORS.textTertiary }} />
        <p style={{ fontSize: "13.5px", color: COLORS.textPrimary, marginBottom: "3px" }}>
          {t("Курьеров нет", "Kuryerlar yo'q")}
        </p>
        <p style={{ fontSize: "12px", color: COLORS.textTertiary }}>
          {t("Заведите сотрудника с ролью «Курьер» — он появится здесь", "«Kuryer» rolidagi xodim qo'shing")}
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm" style={{ tableLayout: "fixed" }}>
        <colgroup>
          <col />
          <col style={{ width: "96px" }} />
          <col style={{ width: "96px" }} />
          <col style={{ width: "112px" }} />
          <col style={{ width: "160px" }} />
          <col style={{ width: "160px" }} />
        </colgroup>
        <thead>
          <tr style={{ background: "var(--color-surface-light)" }}>
            {[
              { h: t("Курьер", "Kuryer"), right: false },
              { h: t("Довезено", "Yetkazildi"), right: true },
              { h: t("Сорвано", "Bajarilmadi"), right: true },
              { h: t("Доля", "Ulush"), right: true },
              { h: t("Сумма довезённого", "Yetkazilgan summa"), right: true },
              { h: t("Привезено денег", "Pul olib kelindi"), right: true },
            ].map((c, i) => (
              <th key={i} className={`px-3 py-2.5 text-[10px] font-semibold uppercase tracking-wider ${c.right ? "text-right" : "text-left"}`}
                style={{ color: COLORS.textTertiary }}>{c.h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(c => {
            const assigned = c.delivered + c.failed;
            return (
              <tr
                key={c.courierId}
                onClick={() => onSelect(c.courierId)}
                /*
                  Строка кликается — значит должна и подсвечиваться, и
                  открываться с клавиатуры. У агентов так с самого начала;
                  курьерская таблица была немой, и разобрать одного человека
                  было нечем.
                */
                tabIndex={0}
                onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(c.courierId); } }}
                className="cursor-pointer transition-all hover:bg-[var(--color-surface-light)]"
                style={{
                  borderBottom: "1px solid var(--color-border)",
                  background: selectedId === c.courierId ? "var(--color-surface-light)" : "transparent",
                }}
              >
                <td className="px-3 py-2.5 font-semibold truncate" style={{ color: COLORS.textPrimary }}>
                  {c.courierName}
                  {/* Возвраты — не отдельная колонка: они редки, и пустой
                      столбец занимал бы место у тех пяти чисел, ради которых
                      таблицу открывают. */}
                  {c.returned > 0 && (
                    <span className="text-xs font-normal" style={{ color: "var(--color-warning-text)" }}>
                      {" · "}{t(`возвратов ${c.returned}`, `${c.returned} qaytarish`)}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums font-semibold" style={{ color: c.delivered > 0 ? COLORS.textPrimary : COLORS.textTertiary }}>{c.delivered}</td>
                <td className="px-3 py-2.5 text-right tabular-nums" style={{ color: c.failed > 0 ? "var(--color-danger-text)" : COLORS.textTertiary }}>{c.failed}</td>
                {/*
                  Ноль назначенных — это «мерить нечего», а не «ноль процентов
                  успеха». Красный ноль на курьере, которому не давали заявок,
                  обвиняет его в чужом решении.
                */}
                <td className="px-3 py-2.5 text-right tabular-nums" style={{ color: assigned === 0 ? COLORS.textTertiary : COLORS.textPrimary }}>
                  {assigned === 0 ? "—" : `${c.successRate}%`}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums" style={{ color: c.deliveredAmount > 0 ? COLORS.textPrimary : COLORS.textTertiary }}>
                  {c.deliveredAmount > 0 ? fmt(c.deliveredAmount) : "—"}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums font-semibold" style={{ color: c.cashCollected > 0 ? COLORS.textPrimary : COLORS.textTertiary }}>
                  {c.cashCollected > 0 ? fmt(c.cashCollected) : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Salary Config ─────────────────────────────────────────────────────────────

/**
 * Наибольшая допустимая ставка.
 *
 * Сервер принимает до 100 (commission-router, setRate), но сто процентов
 * выручки агенту — это не ставка, а ошибка ввода. Экран держит разумную
 * границу и НАЗЫВАЕТ её: прежде он молча отбрасывал всё выше пятидесяти, и
 * человек уходил уверенным, что поставил шестьдесят.
 */
const MAX_RATE = 50;
/*
  Потолок суммы за доставку.

  Процентом курьера мерить нельзя: сумму заказа он не назначает и на неё не
  влияет, а везёт одинаково — что коробку на сто тысяч, что на миллион. Платят
  фиксированную сумму за довезённую заявку, и потолок здесь только затем, чтобы
  промах на клавиатуре («50000» вместо «5000») не ушёл на сервер молча.
*/
const MAX_DELIVERY = 1_000_000;

function SalaryConfig({ t }: { t: (r: string, u: string) => string }) {
  const { data: usersData } = trpc.user.list.useQuery({ page: 1, pageSize: 100 });
  const { data: commissionData } = trpc.commission.list.useQuery();
  const utils = trpc.useContext();

  const staff = (usersData?.data ?? []) as { id: number; name: string; role: string; status: string }[];
  const active = (role: string) => staff.filter(u => u.role === role && u.status === "active");

  const setRateMutation = trpc.commission.setRate.useMutation({
    onSuccess: () => { utils.commission.list.invalidate(); notify.success(t("Ставка сохранена", "Stavka saqlandi")); },
    onError: (e) => notify.error(e.message),
  });

  const calcMutation = trpc.commission.calculate.useMutation({
    onSuccess: () => { utils.commission.list.invalidate(); notify.success(t("Комиссия рассчитана", "Komissiya hisoblandi")); },
    onError: (e) => notify.error(e.message),
  });

  /** Что лежит на сервере для этого человека. */
  const rowOf = (userId: number) =>
    (commissionData ?? []).find((c: { userId: number }) => c.userId === userId);

  const savedCommission = (id: number) => Math.round(Number(rowOf(id)?.commissionRate ?? 0) * 10) / 10;
  const savedDelivery = (id: number) => Math.round(Number(rowOf(id)?.deliveryRate ?? 0));
  /*
    Чем платят курьеру. Строки может не быть вовсе — тогда «за штуку», как
    считалось до появления выбора: то же умолчание, что и на сервере.
  */
  const savedMode = (id: number) => rowOf(id)?.courierPayMode === "percent" ? "percent" : "per_delivery";

  /*
    Ставки живут в одной строке commissions, поэтому сохраняются вместе: послав
    одну без другой, мы обнулили бы соседнюю. Ручка это и так бережёт —
    непереданное поле она не трогает, — но послать текущее значение дешевле,
    чем полагаться на память о том, что оно бережёт.
  */
  const saveCommission = (id: number, value: number) =>
    setRateMutation.mutate({ userId: id, commissionRate: value });
  const saveDelivery = (id: number, value: number) =>
    setRateMutation.mutate({ userId: id, commissionRate: savedCommission(id), deliveryRate: value });

  /*
    Процент курьеру лежит в том же поле, что и агентский: это тот же процент,
    только от другой суммы — у агента от оформленного, у курьера от довезённого.
    Ставку за штуку при этом не трогаем: человека могут вернуть обратно, и
    прежнее число не должно пропасть.
  */
  const saveCourierPercent = (id: number, value: number) =>
    setRateMutation.mutate({ userId: id, commissionRate: value, deliveryRate: savedDelivery(id) });

  const saveCourierMode = (id: number, mode: string) =>
    setRateMutation.mutate({
      userId: id,
      commissionRate: savedCommission(id),
      deliveryRate: savedDelivery(id),
      courierPayMode: mode === "percent" ? "percent" : "per_delivery",
    });

  const handleCalc = () => {
    const now = new Date();
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split("T")[0];
    const periodEnd = now.toISOString().split("T")[0];
    calcMutation.mutate({ periodType: "monthly", periodStart, periodEnd });
  };

  const savingId = setRateMutation.isPending ? setRateMutation.variables?.userId ?? null : null;

  return (
    <div className="space-y-4">
      <RateList
        t={t}
        people={active("agent")}
        savingId={savingId}
        title={t("Комиссия агентов", "Agentlar komissiyasi")}
        /*
          Сказано, ОТ ЧЕГО процент. Стояло «Настройте комиссию (%) для каждого
          агента» — и человек не знал, от выручки это, от прибыли или от суммы
          заказов; а решение «сколько ставить» принимается именно из этого.
        */
        hint={t(
          `Процент от выручки доставленных заказов агента за месяц. От 0 до ${MAX_RATE}%.`,
          `Agentning oy davomida yetkazilgan buyurtmalari tushumidan foiz. 0 dan ${MAX_RATE}% gacha.`,
        )}
        empty={t("Активных агентов нет", "Faol agentlar yo'q")}
        kinds={[{ id: "percent", label: "%", max: MAX_RATE, step: "0.5", saved: savedCommission, onSave: saveCommission }]}
      />

      {/*
        Ставка курьера.

        Её негде было задать вовсе: экран знал только процент и только у
        агентов, а курьер в расчёте зарплаты получал «оклад и три нуля».
      */}
      <RateList
        t={t}
        people={active("courier")}
        savingId={savingId}
        title={t("Оплата курьеров за доставку", "Kuryerlarga yetkazish uchun to'lov")}
        hint={t(
          "Сумма за каждую довезённую заявку или процент от суммы довезённого — переключателем у каждого. Сорванные доставки выплату не уменьшают: они видны в показателях, но платят за факт.",
          "Har bir yetkazilgan ariza uchun summa yoki yetkazilgan summadan foiz — har birida almashtirgich bilan. Bajarilmagan yetkazishlar to'lovni kamaytirmaydi.",
        )}
        empty={t("Активных курьеров нет", "Faol kuryerlar yo'q")}
        kinds={[
          { id: "per_delivery", label: t("сум", "so'm"), max: MAX_DELIVERY, step: "1000", saved: savedDelivery, onSave: saveDelivery },
          { id: "percent",      label: "%",              max: MAX_RATE,     step: "0.5",  saved: savedCommission, onSave: saveCourierPercent },
        ]}
        modeOf={savedMode}
        onMode={saveCourierMode}
      />

      {/*
        Здесь стояло «Комиссии рассчитываются автоматически при просмотре
        зарплаты» — и тут же кнопка «Пересчитать». Два утверждения спорили друг
        с другом: если само, зачем кнопка. Сказано то, что есть на самом деле.
      */}
      <div className="neo-card" style={{ padding: "16px 20px 20px" }}>
        <p className="text-xs" style={{ color: COLORS.textTertiary, margin: "0 0 10px" }}>
          {t(
            "Ставка применяется к следующему расчёту. Уже посчитанные за этот месяц суммы пересчитываются кнопкой ниже.",
            "Stavka keyingi hisobga qo'llanadi. Shu oy uchun hisoblangan summalar quyidagi tugma bilan qayta hisoblanadi.",
          )}
        </p>
        {/* Кнопка домашняя: в градиенте стоял литерал #4a5c78, а в тени —
            rgba(91,109,138,.3). Ни того, ни другого нет ни в палитре, ни у
            арендатора, и в тёмной теме они оставались прежними. */}
        <button onClick={handleCalc} disabled={calcMutation.isPending}
          className="neo-btn-primary tap w-full flex items-center justify-center gap-2">
          {calcMutation.isPending && <Loader2 size={14} className="animate-spin" />}
          {t("Пересчитать комиссии за месяц", "Oylik komissiyalarni qayta hisoblash")}
        </button>
      </div>

      {/*
        Ведомость — под кнопкой пересчёта, потому что это её продолжение:
        посчитали, посмотрели, утвердили, выплатили. Утверждение и было тем
        звеном, которого не хватало: пересчёт нарочно не трогает утверждённые
        строки, а поставить это состояние было нечем — и защита не работала.
      */}
      <CommissionLedger t={t} />
    </div>
  );
}

/**
 * Список «человек — ставка».
 *
 * Одна и та же таблица для двух разных ставок: у агента процент, у курьера
 * сумма за доставку. Различаются они подписью, единицей и потолком — всё
 * остальное, включая разбор ввода, одинаково, и разводить это в две копии
 * значило бы чинить найденные здесь ошибки дважды.
 */
/**
 * Вид ставки: в чём её задают и как она называется.
 *
 * У агента вид один — процент. У курьера их два, и выбирает арендатор: сумма за
 * довезённую заявку или процент от довезённого. Способ хранится по человеку,
 * поэтому в одной организации могут работать оба.
 */
interface RateKind {
  id: string;
  /*
    Слово на переключателе: «сум» или «%».

    Не `unit`: в проекте так называется единица измерения товара (шт, ящик,
    литр), и её нельзя подставлять в разметку кодом из базы — на это есть
    отдельная проверка. Здесь слово наше и уже переведённое, но одинаковое имя
    для двух разных вещей путает и людей, и проверки.
  */
  label: string;
  max: number;
  step: string;
  saved: (personId: number) => number;
  onSave: (personId: number, value: number) => void;
}

function RateList({ t, people, savingId, title, hint, empty, kinds, modeOf, onMode }: {
  t: (r: string, u: string) => string;
  people: { id: number; name: string }[];
  savingId: number | null;
  title: string; hint: string; empty: string;
  /*
    Один вид — поле как было. Два — рядом с полем встаёт переключатель, и
    видно, чем этому человеку платят. Отдельный список под курьеров вернул бы
    сто строк копии, которую недавно свели в одну.
  */
  kinds: RateKind[];
  modeOf?: (personId: number) => string;
  onMode?: (personId: number, kindId: string) => void;
}) {
  /*
    Черновики правок — строками и по человеку. Отдельно от сохранённого: пока
    он набирает, на экране его цифра, а на сервере прежняя, и путать их нельзя.

    Черновик хранится СТРОКОЙ, а не числом. Было `parseFloat(value) || 0`:
    стоило стереть содержимое, чтобы набрать заново, как в поле мгновенно
    появлялся ноль — и он же уходил на сервер при уходе из поля. Поменять «5»
    на «7» приходилось, целясь курсором и дописывая вокруг старой цифры.

    Пустая строка — разрешённое промежуточное состояние: человек стирает, чтобы
    набрать, а не чтобы обнулить ставку.
  */
  const [drafts, setDrafts] = useState<Record<number, string>>({});

  /** Каким видом платят этому человеку. Один вид — он же и есть. */
  const kindOf = (id: number): RateKind =>
    (kinds.length === 1 ? kinds[0] : kinds.find(k => k.id === modeOf?.(id)) ?? kinds[0]);

  const shown = (id: number) => drafts[id] !== undefined ? drafts[id] : String(kindOf(id).saved(id));
  const forget = (id: number) => setDrafts(prev => { const next = { ...prev }; delete next[id]; return next; });

  /**
   * Сохранить ставку, если она вообще может быть ставкой.
   *
   * Здесь стояло `if (val >= 0 && val <= 50) mutate(...)` — и всё. Ввели 60:
   * условие не выполнено, не происходит НИЧЕГО. Поле показывает 60, на сервере
   * лежит прежнее число, и человек уходит уверенным, что поставил шестьдесят.
   * Молчаливое расхождение между экраном и базой — худший из возможных
   * ответов, и именно его тут и выдавали.
   */
  const commit = (id: number) => {
    const raw = drafts[id];
    if (raw === undefined) return;

    const kind = kindOf(id);
    const { label, max } = kind;
    const val = Number(raw.replace(",", "."));
    const stored = kind.saved(id);

    if (raw.trim() === "" || !Number.isFinite(val)) {
      notify.error(t("Введите ставку числом", "Stavkani raqam bilan kiriting"));
      forget(id);
      return;
    }
    if (val < 0 || val > max) {
      notify.error(t(
        `Ставка задаётся от 0 до ${max} ${label} — введено ${val}`,
        `Stavka 0 dan ${max} ${label} gacha — kiritildi ${val}`,
      ));
      // Поле возвращается к тому, что действительно лежит на сервере: иначе на
      // экране осталось бы непринятое число.
      forget(id);
      return;
    }
    // Не тревожим сервер, если ничего не изменилось.
    if (Math.abs(val - stored) < 0.001) { forget(id); return; }

    kind.onSave(id, val);
    forget(id);
  };

  return (
    <div className="neo-card" style={{ padding: "20px" }}>
      <div style={{ marginBottom: "14px" }}>
        <h3 style={{ fontFamily: F.display, fontSize: "15px", fontWeight: 600, color: COLORS.textPrimary, margin: 0 }}>
          {title}
        </h3>
        <p className="text-xs" style={{ color: COLORS.textSecondary, margin: "4px 0 0" }}>{hint}</p>
      </div>

      {people.length === 0 ? (
        // Пустая таблица без слов читается как поломка. Здесь она означает
        // ровно одно: таких сотрудников нет.
        <p className="text-xs" style={{ color: COLORS.textTertiary, margin: 0 }}>{empty}</p>
      ) : (
        <div className="space-y-2">
          {people.map(person => {
            const busy = savingId === person.id;
            const edited = drafts[person.id] !== undefined;
            return (
              <div key={person.id} className="flex items-center gap-3 p-2 rounded-xl"
                style={{ background: "var(--color-surface-light)", border: "1px solid var(--color-border)" }}>
                <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: "color-mix(in srgb, var(--color-primary) 10%, transparent)" }}>
                  <span className="text-xs font-bold" style={{ color: "var(--color-primary-text)" }}>{person.name.charAt(0).toUpperCase()}</span>
                </div>
                <span className="text-sm flex-1 truncate" style={{ color: COLORS.textPrimary }}>{person.name}</span>

                {/* Признак того, что происходит именно с ЭТОЙ строкой. Общий
                    всплывающий значок на тридцать человек не отвечает на вопрос
                    «сохранилось ли у Азиза». */}
                {busy && <Loader2 size={13} className="animate-spin" style={{ color: COLORS.textTertiary }} aria-hidden />}
                {!busy && edited && (
                  <span className="text-[11px]" style={{ color: COLORS.textTertiary }}>
                    {t("не сохранено", "saqlanmadi")}
                  </span>
                )}

                <div className="flex items-center gap-2">
                  {/* Переключатель вида — только там, где видов больше одного.
                      Смена вида сбрасывает черновик: «5» как процент и «5» как
                      сумма за доставку — разные деньги, и отправлять одно
                      вместо другого нельзя. */}
                  {kinds.length > 1 && onMode && (
                    <div role="group" aria-label={t("Чем платить", "Nima bilan to'lash")} className="range-pills">
                      {kinds.map(k => (
                        <button
                          key={k.id}
                          type="button"
                          onClick={() => { forget(person.id); onMode(person.id, k.id); }}
                          aria-pressed={kindOf(person.id).id === k.id}
                          className={"range-pill tap" + (kindOf(person.id).id === k.id ? " active" : "")}
                          style={{ padding: "7px 10px", fontSize: "11px" }}
                        >
                          {k.label}
                        </button>
                      ))}
                    </div>
                  )}
                  <input
                    type="number" inputMode="decimal" min="0" max={kindOf(person.id).max} step={kindOf(person.id).step}
                    aria-label={`${title}: ${person.name}`}
                    value={shown(person.id)}
                    onChange={e => setDrafts(prev => ({ ...prev, [person.id]: e.target.value }))}
                    onBlur={() => commit(person.id)}
                    // Enter сохраняет, не заставляя уводить палец с поля.
                    onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                    // 44 точки: поле было 30 при цели касания в 44, а это ровно
                    // то поле, куда на телефоне целятся пальцем.
                    className="text-center text-sm rounded-lg outline-none tap"
                    style={{
                      width: kindOf(person.id).id === "percent" ? "96px" : "124px",
                      height: "44px", padding: "0 10px",
                      background: "var(--color-surface)", border: "1.5px solid var(--color-border)",
                      color: COLORS.textPrimary, fontFamily: F.display, fontWeight: 600,
                    }}
                  />
                  {/* При одном виде единица подписана рядом с полем; при двух
                      её уже назвал переключатель, и повторять незачем. */}
                  {kinds.length === 1 && (
                    <span className="text-xs font-medium" style={{ color: COLORS.textSecondary, minWidth: "26px" }}>{kinds[0].label}</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
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
    <div className="p-3 rounded-xl" style={{ background: danger ? "rgba(212,80,80,.08)" : "var(--color-surface-light)", borderLeft: `3px solid ${danger ? "var(--color-danger)" : COLORS.border}` }}>
      <p className="text-[11px]" style={{ color: danger ? "var(--color-danger-text)" : COLORS.textSecondary }}>{label}</p>
      <p style={{ fontFamily: F.display, fontSize: bold ? "16px" : "14px", fontWeight: bold ? 700 : 600, color: danger ? "var(--color-danger-text)" : COLORS.textPrimary }}>{value}</p>
    </div>
  );
}
