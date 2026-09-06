import { memo } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from "recharts";
import type { inferRouterOutputs } from "@trpc/server";
import { Users, ClipboardList, TrendingUp, Activity, Package, Store, Award, Receipt, Wallet } from "lucide-react";
import { ProgressRing } from "@/components/ProgressRing";
import { F, COLORS, delta } from "./report-constants";
import { KpiCard, type KpiComparison } from "./ReportKpiCards";
import { ChartPanel, GlassPanel, PlanCompletion, SectionError, TopList } from "./ReportCharts";
import type { AppRouter } from "../../../api/router";

type PlanRow = inferRouterOutputs<AppRouter>["reports"]["getPlanCompletion"][number];

/** Итоги периода: то же самое посчитано за выбранный период и за предыдущий такой же. */
export interface PeriodTotals {
  revenue: number;
  orders: number;
  /** null — заказов не было, среднего чека не существует (а не «ноль»). */
  avgOrder: number | null;
}

/** Что упало. Пустой объект — всё приехало. */
export interface OverviewErrors {
  summary?: { onRetry: () => void };
  totals?: { onRetry: () => void };
  chart?: { onRetry: () => void };
  plans?: { onRetry: () => void };
  products?: { onRetry: () => void };
  shops?: { onRetry: () => void };
  agents?: { onRetry: () => void };
  debt?: { onRetry: () => void };
}

interface OverviewTabProps {
  summary: {
    totalAgents: number;
    activeNow: number;
    visitsToday: number;
    ordersMonth: number;
    avgOrdersPerAgent: number;
    revenueMonth: number;
  } | undefined;
  summaryLoading: boolean;
  chart: { date: string; visits: number; orders: number }[] | undefined;
  plans: PlanRow[] | undefined;
  /** Уже готовые ряды со страницы: она грузит их для соседних вкладок. */
  topProducts: { productName: string; productCode?: string; totalQty: number; totalRevenue: number }[] | undefined;
  topShops: { name: string; revenue: number }[] | undefined;
  /** visits необязательны: источник выручки по агентам их больше не отдаёт (см. AgentsTab). */
  topAgents: { agentId: number; agentName: string | null; orders: number; revenue: number; visits?: number }[] | undefined;
  days: number;
  fmt: (v: string | number, short?: boolean) => string;
  t: (ru: string, uz: string) => string;
  /** Итоги за период и за предыдущий такой же. Без них плитки показывают число без точки отсчёта. */
  totals?: PeriodTotals;
  previous?: PeriodTotals;
  /** Долг магазинов на сейчас: остаток, а не поток за период. */
  debt?: { total: number; shopCount: number; top: { name: string; debt: number }[] };
  errors?: OverviewErrors;
}

/**
 * «Сводка» — первый экран директора.
 *
 * ── Чем она была ────────────────────────────────────────────────────────────
 *
 * Четыре плитки: агентов, визитов, заказов, выручка. Число и подпись, больше
 * ничего. «Выручка 12 млн» — это много или мало? Из плитки не следует ни
 * одного действия, а на страницу приходят за решением.
 *
 * Хуже того, плитки врали в подписи: getDashboardSummary считает ровно за 30
 * дней и период с экрана не принимает, а подпись писалась как
 * «ЗАКАЗЫ ${days}д». Выбрав «7 дней», человек видел заголовок «ЗАКАЗЫ 7д» над
 * месячным числом.
 *
 * ── Чем стала ───────────────────────────────────────────────────────────────
 *
 * Четыре ответа на вопросы, с которыми сюда приходят: сколько заработали (и
 * больше ли, чем в прошлый такой же период), сколько заказов, какой средний
 * чек, сколько денег зависло в долгах. Первые три считаются за ВЫБРАННЫЙ
 * период и несут сравнение с предыдущим; долг сравнения не несёт и не может —
 * это остаток на сейчас, а не поток за период, о чём и сказано подписью.
 *
 * Числа из getDashboardSummary остались, но ушли строкой ниже и названы тем,
 * чем они являются: сегодняшняя оперативная сводка, без периода.
 */
export const OverviewTab = memo(function OverviewTab({
  summary, summaryLoading, chart, plans, topProducts, topShops, topAgents, days, fmt, t,
  totals, previous, debt, errors,
}: OverviewTabProps) {
  const period = t(`за ${days} дней`, `${days} kun ichida`);
  const prevPeriod = t(`за прошлые ${days} дней`, `oldingi ${days} kun`);

  /** Плитка со сравнением: и процент, и само прошлое число — процент без него ни о чём. */
  const compare = (current: number, prev: number | null | undefined, format: (v: number) => string): KpiComparison => {
    const d = delta(current, prev);
    return {
      pct: d?.pct ?? null,
      label: d
        ? `${t("было", "edi")} ${format(d.previous)} ${prevPeriod}`
        : t("сравнить не с чем: в прошлом периоде пусто", "taqqoslash uchun ma'lumot yo'q"),
    };
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      {/* KPIs */}
      {errors?.totals ? (
        <SectionError onRetry={errors.totals.onRetry} t={t} />
      ) : !totals ? (
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => <div key={i} className="kpi-hero" style={{ height: "140px" }} />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
          <KpiCard
            tone="green"
            label={`${t("ВЫРУЧКА", "TUSHUM")} · ${period}`}
            value={fmt(totals.revenue)}
            icon={<TrendingUp size={17} />}
            comparison={compare(totals.revenue, previous?.revenue, v => fmt(v, true))}
          />
          <KpiCard
            tone="orange"
            label={`${t("ЗАКАЗОВ", "BUYURTMA")} · ${period}`}
            value={totals.orders.toLocaleString("ru-RU")}
            icon={<ClipboardList size={17} />}
            comparison={compare(totals.orders, previous?.orders, v => v.toLocaleString("ru-RU"))}
          />
          <KpiCard
            tone="teal"
            label={`${t("СРЕДНИЙ ЧЕК", "O'RTACHA CHEK")} · ${period}`}
            value={totals.avgOrder === null ? "—" : fmt(totals.avgOrder)}
            icon={<Receipt size={17} />}
            comparison={totals.avgOrder === null
              ? { pct: null, label: t("заказов за период не было", "davrda buyurtma bo'lmagan") }
              : compare(totals.avgOrder, previous?.avgOrder, v => fmt(v, true))}
          />
          <KpiCard
            tone="amber"
            label={t("ЗАВИСЛО В ДОЛГАХ", "QARZDA QOLGAN")}
            value={debt ? fmt(debt.total) : "—"}
            icon={<Wallet size={17} />}
            // Долг — остаток на сейчас, а не поток за период: сравнивать его с
            // «прошлыми 30 днями» бессмысленно, и вместо ложного процента
            // здесь стоит состав — у скольких магазинов эти деньги лежат.
            note={debt
              ? `${t("у", "")} ${debt.shopCount} ${t("магазинов", "do'konda")} · ${t("остаток на сейчас", "hozirgi qoldiq")}`
              : t("данные о долгах не загрузились", "qarz ma'lumoti yuklanmadi")}
          />
        </div>
      )}

      {/* Оперативная строка: то, что getDashboardSummary умеет считать, — без периода.
          Раньше эти же числа стояли плитками наравне с деньгами и занимали
          половину первого экрана, хотя решения из них не следует. */}
      {errors?.summary ? (
        <SectionError onRetry={errors.summary.onRetry} t={t} />
      ) : summaryLoading ? (
        <div className="neo-card-sm" style={{ height: "48px", padding: "14px 18px" }} />
      ) : summary && (
        <div className="neo-card-sm" style={{
          display: "flex", alignItems: "center", gap: "20px", flexWrap: "wrap",
          padding: "14px 18px", fontSize: "13px", fontFamily: F.body, color: COLORS.textSecondary,
        }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: "7px" }}>
            <Users size={14} style={{ color: COLORS.textTertiary }} aria-hidden />
            {t("Агентов", "Agentlar")}: <b style={{ color: COLORS.textPrimary }}>{summary.totalAgents}</b>
            <span style={{ color: COLORS.textTertiary }}>
              ({summary.activeNow} {t("на связи", "aloqada")})
            </span>
          </span>
          <span>
            {t("Визитов сегодня", "Bugungi tashriflar")}: <b style={{ color: COLORS.textPrimary }}>{summary.visitsToday}</b>
          </span>
          <span>
            {/* Именно 30 дней, а не выбранный период: сервер здесь period не принимает. */}
            {t("Заказов за 30 дней", "30 kunlik buyurtma")}: <b style={{ color: COLORS.textPrimary }}>{summary.ordersMonth}</b>
            <span style={{ color: COLORS.textTertiary }}> ≈{summary.avgOrdersPerAgent}/{t("агента", "agent")}</span>
          </span>
        </div>
      )}

      {/* Три колонки, график занимает две.
          Раньше оба блока стояли по одной, и правая треть пустовала всегда —
          не «пока нечего показать», а при любых данных. */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Chart */}
        <div className="lg:col-span-2">
          <ChartPanel title={t("Визиты и заказы", "Tashriflar va buyurtmalar")}>
          {errors?.chart ? <SectionError onRetry={errors.chart.onRetry} t={t} /> : (
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={chart ?? []}>
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border} />
              <XAxis dataKey="date" tick={{ fill: COLORS.textTertiary, fontSize: 11, fontFamily: F.body }} axisLine={{ stroke: COLORS.border }} tickLine={false} />
              <YAxis tick={{ fill: COLORS.textTertiary, fontSize: 11, fontFamily: F.body }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ background: COLORS.surface, border: "none", borderRadius: 12, boxShadow: "0 4px 24px rgba(0,0,0,0.08)" }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line type="monotone" dataKey="visits" stroke="var(--color-primary)" strokeWidth={2.5} dot={false} name={t("Визиты", "Tashriflar")} />
              <Line type="monotone" dataKey="orders" stroke="var(--color-success)" strokeWidth={2.5} dot={false} name={t("Заказы", "Buyurtmalar")} />
            </LineChart>
          </ResponsiveContainer>
          )}
          </ChartPanel>
        </div>

        {/* Plan completion */}
        <GlassPanel>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "16px" }}>
            <Activity size={16} style={{ color: COLORS.primaryText }} />
            <h2 style={{ fontFamily: F.display, fontSize: "15px", fontWeight: 600, color: COLORS.textPrimary, margin: 0 }}>
              {t("План сегодня", "Bugungi reja")}
            </h2>
          </div>
          {errors?.plans ? <SectionError onRetry={errors.plans.onRetry} t={t} /> : (<>
          {!!plans?.length && (() => {
            const totalVisited = plans.reduce((s, p) => s + Number(p.visited ?? 0), 0);
            const totalPlanned = plans.reduce((s, p) => s + Number(p.total ?? 0), 0);
            const pct = totalPlanned > 0 ? Math.round((totalVisited / totalPlanned) * 100) : 0;
            const ringColor = pct >= 80 ? "var(--color-success)" : pct >= 50 ? "var(--color-warning)" : "var(--color-danger)";
            return (
              <div style={{ display: "flex", alignItems: "center", gap: "16px", marginBottom: "20px", paddingBottom: "20px", borderBottom: `1px solid ${COLORS.border}` }}>
                <ProgressRing value={pct} color={ringColor} label={`${pct}%`} />
                <div>
                  <p style={{ fontSize: "13px", fontWeight: 500, color: COLORS.textPrimary, margin: 0 }}>{totalVisited} {t("из", "dan")} {totalPlanned} {t("выполнено", "bajarildi")}</p>
                  <p style={{ fontSize: "11px", color: COLORS.textTertiary, margin: "4px 0 0" }}>{t("все агенты", "barcha agentlar")}</p>
                </div>
              </div>
            );
          })()}
          <PlanCompletion data={plans ?? []} t={t} />
          </>)}
        </GlassPanel>
      </div>

      {/* Четыре сводки за выбранный период.
          Данные страница уже загружает для соседних вкладок, так что сеть тут
          не тратится вовсе — просто перестают простаивать нижние две трети
          экрана, а частые вопросы («кто продал больше», «что берут», «какой
          магазин кормит», «где деньги зависли») получают ответ без
          переключения вкладок.
          Пятёрка, а не весь список: за подробностями есть свои вкладки. */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-5">
        <TopPanel icon={<Package size={16} />} title={`${t("Топ товаров", "Top mahsulotlar")} · ${days}${t("д", "k")}`}>
          {errors?.products ? <SectionError onRetry={errors.products.onRetry} t={t} /> : (
          <TopList
            t={t}
            emptyRu="За период продаж не было" emptyUz="Davr uchun sotuv bo'lmagan"
            items={(topProducts ?? []).slice(0, 5).map((p, i) => ({
              key: p.productCode ?? p.productName ?? i,
              name: p.productName || "—",
              value: p.totalRevenue,
              valueLabel: fmt(p.totalRevenue, true),
              // «шт» здесь стояло жёстко, хотя единица у каждого товара своя и
              // topProducts её вовсе не отдаёт. Единицы нет — значит и писать
              // нечего: число объёма говорит само за себя.
              hint: `${fmt(p.totalQty)} ${t("продано", "sotildi")}`,
            }))}
          />
          )}
        </TopPanel>

        <TopPanel icon={<Store size={16} />} title={`${t("Топ магазинов", "Top do'konlar")} · ${days}${t("д", "k")}`}>
          {errors?.shops ? <SectionError onRetry={errors.shops.onRetry} t={t} /> : (
          <TopList
            t={t}
            emptyRu="За период продаж не было" emptyUz="Davr uchun sotuv bo'lmagan"
            items={(topShops ?? []).slice(0, 5).map((s, i) => ({
              key: s.name ?? i,
              name: s.name || "—",
              value: s.revenue,
              valueLabel: fmt(s.revenue, true),
            }))}
          />
          )}
        </TopPanel>

        <TopPanel icon={<Award size={16} />} title={`${t("Лучшие агенты", "Eng yaxshi agentlar")} · ${days}${t("д", "k")}`}>
          {errors?.agents ? <SectionError onRetry={errors.agents.onRetry} t={t} /> : (
          <TopList
            t={t}
            emptyRu="Пока нет данных по агентам" emptyUz="Agentlar bo'yicha ma'lumot yo'q"
            items={(topAgents ?? []).slice(0, 5).map((a, i) => ({
              key: a.agentId ?? i,
              name: a.agentName || "—",
              value: a.revenue,
              valueLabel: fmt(a.revenue, true),
              hint: `${a.orders} ${t("заказов", "buyurtma")}`,
            }))}
          />
          )}
        </TopPanel>

        {/* «Где деньги зависли» — вопрос, у которого на этой странице не было
            ответа вовсе: долги существовали только карточкой выгрузки в «Все
            отчёты», то есть увидеть их можно было, лишь скачав файл. */}
        <TopPanel icon={<Wallet size={16} />} title={t("Больше всех должны", "Eng ko'p qarzdorlar")}>
          {errors?.debt ? <SectionError onRetry={errors.debt.onRetry} t={t} /> : (
          <TopList
            t={t}
            emptyRu="Долгов нет" emptyUz="Qarz yo'q"
            items={(debt?.top ?? []).slice(0, 5).map((s, i) => ({
              key: s.name ?? i,
              name: s.name || "—",
              value: s.debt,
              valueLabel: fmt(s.debt, true),
            }))}
          />
          )}
        </TopPanel>
      </div>
    </div>
  );
});

/** Заголовок со значком плюс содержимое — та же рамка, что у «Плана сегодня». */
function TopPanel({ icon, title, children }: {
  icon: React.ReactNode; title: string; children: React.ReactNode;
}) {
  return (
    <GlassPanel>
      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "16px" }}>
        <span style={{ color: COLORS.primaryText, display: "flex" }}>{icon}</span>
        <h2 style={{ fontFamily: F.display, fontSize: "15px", fontWeight: 600, color: COLORS.textPrimary, margin: 0 }}>
          {title}
        </h2>
      </div>
      {children}
    </GlassPanel>
  );
}
