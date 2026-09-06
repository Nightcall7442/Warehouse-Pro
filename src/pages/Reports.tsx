import { useCallback, useMemo, useState } from "react";
import { trpc } from "@/providers/trpc";
import { useCurrency } from "@/hooks/useCurrency";
import { useLang } from "@/i18n";
import { useAuth } from "@/hooks/useAuth";
import { format, subDays } from "date-fns";
import { FileDown, Printer, LayoutDashboard, ShoppingCart, Award, LayoutGrid, Wallet } from "lucide-react";
import { exportToExcel } from "@/lib/excel";
import { exportToPDF } from "@/lib/export";
import { unitShort } from "@/lib/units";
import { QueryErrorFallback } from "@/components/QueryErrorFallback";
import { F, COLORS, PAYMENT_MAP, delta, type TabKey } from "@/components/reports/report-constants";
import { PeriodPicker } from "@/components/reports/ReportCharts";
import { OverviewTab, type PeriodTotals } from "@/components/reports/OverviewTab";
import { SalesTab } from "@/components/reports/SalesTab";
import { AgentsTab, type AgentRow } from "@/components/reports/AgentsTab";
import { AgentProductsTab } from "@/components/reports/AgentProductsTab";
import { ReportsHub } from "@/components/reports/ReportsHub";
import { DebtorsPanel } from "@/components/debts/DebtorsPanel";

/**
 * «Отчёты» — рабочее место директора, а не витрина чисел.
 *
 * Владелец сказал про эту страницу «слишком простой и дешёвый, все 5
 * разделов». Дело было не в оформлении. Страница показывала числа и молчала о
 * том, что они значат: «выручка 12 млн» без точки отсчёта не отвечает ни на
 * один вопрос, с которым сюда приходят, — сколько заработали, кто из агентов
 * везёт, что продаётся, где деньги зависли.
 *
 * ── Откуда берётся точка отсчёта ────────────────────────────────────────────
 *
 * Тот же запрос, за предыдущий такой же промежуток. Ничего нового на сервере
 * для этого не понадобилось: analytics.agentPerformance принимает даты, и
 * второй вызов с прошлым окном даёт и итоги для сравнения, и выручку каждого
 * агента «тогда» — колонку, ради которой на вкладку агентов и заходят.
 *
 * ── Почему agentPerformance, а не getAgentPerformance ───────────────────────
 *
 * Оба существуют и считают выручку агентов по-разному. reports.* берёт любой
 * неудалённый заказ, включая отменённые и возвращённые; analytics.* — только
 * доставленные, тем же набором, что «Продажи по магазинам» рядом. Пока
 * страница звала первый, вкладка «Агенты» и вкладка «Продажи» показывали
 * разные деньги за один и тот же период.
 *
 * ── Один разбор отказов на все запросы ──────────────────────────────────────
 *
 * Их девять, а разбор стоял у одного. Упавший запрос отдаёт undefined, и
 * раздел печатал своё «Нет данных» — то есть отказ сервера выглядел ровно как
 * честный ответ «за месяц не продали ничего».
 */

/**
 * Разметка внутри значения — это чужая разметка на печатной странице.
 *
 * Названия магазинов, товаров и имена людей заводят руками, и в PDF они
 * подставлялись как есть. У складского отчёта такая же сборка html экранирует
 * их с самого начала, и на это даже стоит проверка в src/__tests__ — здесь же
 * экранировался один заголовок окна.
 *
 * Своя копия, а не общая: escapeHtml в src/lib/export.ts не экспортирован, а
 * трогать чужой файл ради четырёх символов дороже, чем повторить их. Как
 * только export.ts откроют по другому поводу — оттуда и брать.
 */
const esc = (v: unknown): string =>
  String(v ?? "—").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * Итоги периода — по тем же заказам, что и всё остальное на странице.
 *
 * Средний чек берётся от итогов, а не усреднением средних по агентам: среднее
 * средних взвешивает агента с одним заказом наравне с агентом со ста. И null,
 * а не ноль: без заказов среднего чека не существует, а «0» читался бы как
 * «продавали по нулю».
 */
function totalsOf(rows: { orderCount: number; totalRevenue: string }[] | undefined): PeriodTotals | undefined {
  if (!rows) return undefined;
  const revenue = rows.reduce((s, a) => s + Number(a.totalRevenue), 0);
  const orders = rows.reduce((s, a) => s + Number(a.orderCount), 0);
  return { revenue, orders, avgOrder: orders > 0 ? revenue / orders : null };
}

export default function Reports() {
  const [tab, setTab] = useState<TabKey>("overview");
  const [days, setDays] = useState(30);
  const { fmt } = useCurrency();
  const { lang } = useLang();
  const t = useCallback((ru: string, uz: string) => lang === "uz" ? uz : ru, [lang]);

  const from = format(subDays(new Date(), days), "yyyy-MM-dd");
  const to = format(new Date(), "yyyy-MM-dd");
  // Предыдущий промежуток той же длины, вплотную к выбранному: [from-days-1;
  // from-1]. Именно той же длины — сравнивать неделю с месяцем бессмысленно, а
  // «прошлый календарный месяц» на середине месяца сравнивал бы неполное с
  // полным.
  const prevTo = format(subDays(new Date(), days + 1), "yyyy-MM-dd");
  const prevFrom = format(subDays(new Date(), days * 2 + 1), "yyyy-MM-dd");

  const [apDateFrom, setApDateFrom] = useState(from);
  const [apDateTo, setApDateTo] = useState(to);

  const summaryQ = trpc.reports.getDashboardSummary.useQuery();
  const chartQ = trpc.reports.getVisitChart.useQuery({ days });
  const plansQ = trpc.reports.getPlanCompletion.useQuery();
  const byShopQ = trpc.analytics.salesByShop.useQuery({ dateFrom: from, dateTo: to });
  const topProdsQ = trpc.analytics.topProducts.useQuery({ dateFrom: from, dateTo: to });
  const agentsQ = trpc.analytics.agentPerformance.useQuery({ dateFrom: from, dateTo: to });
  const prevAgentsQ = trpc.analytics.agentPerformance.useQuery({ dateFrom: prevFrom, dateTo: prevTo });
  // Долг — остаток на сейчас, периода у него нет: см. комментарий у самого
  // debtReport на сервере.
  const debtQ = trpc.analytics.debtReport.useQuery();

  const { user } = useAuth();
  const isCeo = user?.role === "ceo";

  // Carries gross profit and margin per payment method, so it is CEO-only on
  // the server. Asking for it as an operator would just produce a failed query
  // and an empty section; not asking is the same result without the noise.
  const byPaymentQ = trpc.analytics.pnlByPaymentMethod.useQuery({ from, to }, { enabled: isCeo });
  const agentProductsQ = trpc.analytics.agentProductSales.useQuery(
    { dateFrom: apDateFrom, dateTo: apDateTo },
    // Раздел «Агенты» разворачивает эту подробность у себя, поэтому запрос
    // просыпается вместе с ним, а не отдельной вкладкой.
    { enabled: tab === "agents" },
  );

  const summary = summaryQ.data;
  const byShop = byShopQ.data;
  const topProds = topProdsQ.data;
  const byPayment = byPaymentQ.data;

  const shopChartData = (byShop ?? []).map(s => ({
    name: (s.shopName ?? "—").slice(0, 14), revenue: Number(s.revenue), fullName: s.shopName ?? "—",
  }));

  // SalesTab keys each card off `method`; the column is `paymentMethod`, so the
  // rows went in unmapped and every card came out with a blank label.
  const paymentBreakdown = byPayment?.map(p => ({
    method: p.paymentMethod, revenue: p.revenue, orderCount: p.orderCount,
    // Маржа приходила вместе с выручкой и выбрасывалась по дороге, хотя
    // «где мы зарабатываем» — вопрос отдельный от «где больше денег».
    grossProfit: p.grossProfit, grossMarginPct: p.grossMarginPct,
  }));
  const topProductRows = topProds?.map(p => ({
    productName: p.productName ?? "", productCode: p.productCode ?? undefined,
    totalQty: Number(p.totalQty), totalRevenue: Number(p.totalRevenue),
  }));

  const totals = totalsOf(agentsQ.data);
  const previousTotals = totalsOf(prevAgentsQ.data);

  const agentRows: AgentRow[] | undefined = useMemo(() => {
    if (!agentsQ.data) return undefined;
    const prevByAgent = new Map(
      (prevAgentsQ.data ?? []).map(a => [a.agentId, Number(a.totalRevenue)]),
    );
    return agentsQ.data.map(a => ({
      agentId: Number(a.agentId ?? 0),
      agentName: a.agentName,
      orders: Number(a.orderCount),
      revenue: Number(a.totalRevenue),
      avgOrderValue: Number(a.avgOrderValue),
      // undefined и 0 — разные вещи: агента могло не быть в прошлом периоде
      // вовсе, и тогда сравнивать не с чем, а не «упал до нуля».
      prevRevenue: prevAgentsQ.data ? (prevByAgent.get(a.agentId) ?? null) : null,
    }));
  }, [agentsQ.data, prevAgentsQ.data]);

  const debt = useMemo(() => {
    if (!debtQ.data) return undefined;
    const rows = debtQ.data.map(s => ({ name: s.shopName ?? "—", debt: Number(s.debt) }));
    return {
      total: rows.reduce((s, r) => s + r.debt, 0),
      shopCount: rows.length,
      // Сервер уже отдаёт по убыванию долга; копия перед сортировкой не нужна,
      // потому что порядок и так тот, что нужен списку.
      top: rows,
    };
  }, [debtQ.data]);

  // Пятёрки для «Обзора». Порядок задаётся здесь, а не во вкладке: сортировка —
  // про данные, вкладка занимается показом. Копия перед sort() не лишняя: он
  // правит массив на месте, а те же ряды уходят и в другие вкладки, где
  // порядок свой.
  const topProductsOverview = topProductRows?.slice().sort((a, b) => b.totalRevenue - a.totalRevenue);
  // Имя магазина берётся целиком, а не обрезанное до 14 знаков, как в
  // shopChartData: та обрезка нужна подписи под столбиком диаграммы, а в списке
  // строка укладывается сама, многоточием, и подсказка показывает полное.
  const topShopsOverview = byShop
    ?.map(s => ({ name: s.shopName ?? "—", revenue: Number(s.revenue) }))
    .sort((a, b) => b.revenue - a.revenue);
  const topAgentsOverview = agentRows?.slice().sort((a, b) => b.revenue - a.revenue);

  /*
    Четыре раздела — четыре вопроса, с которыми открывают отчёты: сколько
    заработали, что продаётся, кто из агентов везёт, где деньги зависли.

    Пятой вкладкой стоял каталог выгрузок, а шестой — «Агент × Товар». Ни то,
    ни другое равным вопросом не является: каталог — это «забрать с собой»,
    а «Агент × Товар» — подробность про агентов. Вместе они растягивали ленту
    так, что на ноутбуке она занимала половину ширины, а на телефоне не
    помещалась вовсе и ломала подпись в два слова на три строки.

    Подписи короткие и в одно слово намеренно: лента должна помещаться целиком
    везде, иначе разделы, до которых надо доскроллить, перестают существовать.
  */
  const TABS = [
    { key: "overview" as const, ru: "Обзор", uz: "Umumiy", icon: <LayoutDashboard size={16} /> },
    { key: "sales" as const, ru: "Продажи", uz: "Sotuvlar", icon: <ShoppingCart size={16} /> },
    { key: "agents" as const, ru: "Агенты", uz: "Agentlar", icon: <Award size={16} /> },
    { key: "debts" as const, ru: "Долги", uz: "Qarzlar", icon: <Wallet size={16} /> },
  ];

  const handleExportAgentProducts = async () => {
    const rows = (agentProductsQ.data ?? [])
      .slice()
      .sort((a, b) => (a.agentName ?? "").localeCompare(b.agentName ?? "") || Number(b.totalRevenue) - Number(a.totalRevenue))
      .map(r => ({
        Агент: r.agentName ?? t("Не назначен", "Tayinlanmagan"),
        Товар: r.productName ?? "—",
        Код: r.productCode ?? "",
        "Кол-во": Number(r.totalQty ?? 0),
        // Здесь стоял код единицы из базы: в файл уходили «pcs», «box»,
        // «pack». Словарь на всё приложение один — lib/units.
        Ед: unitShort(r.unit, lang),
        Заказов: Number(r.orderCount ?? 0),
        Сумма: Number(r.totalRevenue ?? 0).toFixed(2),
      }));
    // Пустой набор больше не проглатывается молча здесь: exportToExcel сам
    // объясняет, что выгружать нечего, — как во всех остальных выгрузках.
    await exportToExcel(
      rows,
      `agent-products-${apDateFrom}_${apDateTo}`,
      t("Агент-Товар", "Agent-Mahsulot"),
      `${t("Продажи по агентам и товарам", "Agent va mahsulot bo'yicha sotuvlar")} — ${apDateFrom} — ${apDateTo}`,
    );
  };

  /** Подпись сравнения для файла: процент без прошлого числа ничего не говорит. */
  const compareText = (current: number, previous: number | null | undefined) => {
    const d = delta(current, previous);
    if (!d) return "—";
    return `${d.pct > 0 ? "+" : ""}${d.pct.toFixed(1)}% (было ${Math.round(d.previous).toLocaleString("ru-RU")})`;
  };

  const handleExport = async () => {
    // A snapshot of this page, sections stacked on one sheet. Deliberately not
    // the shape the hub produces: those are one report per file with real
    // column headers, which is what you want for a pivot table. This one is for
    // sending someone a picture of the dashboard.
    const rows: Record<string, string | number | null>[] = [];

    if (totals) {
      // Раньше сюда уходили числа из getDashboardSummary с подписью «за ${days}
      // дней». Тот запрос период не принимает и всегда считает за 30 дней:
      // выбрав неделю, человек уносил файл, где написано «за 7 дней», а лежит
      // месяц. Теперь и число, и подпись про один и тот же промежуток, а
      // рядом стоит, с чем его сравнивать.
      rows.push({ Раздел: "СВОДКА", Показатель: `Период`, Значение: `${from} — ${to}`, "": `предыдущий: ${prevFrom} — ${prevTo}` });
      rows.push({ Раздел: "", Показатель: "Выручка", Значение: totals.revenue.toFixed(2), "": compareText(totals.revenue, previousTotals?.revenue) });
      rows.push({ Раздел: "", Показатель: "Заказов", Значение: totals.orders, "": compareText(totals.orders, previousTotals?.orders) });
      rows.push({ Раздел: "", Показатель: "Средний чек", Значение: totals.avgOrder === null ? "—" : totals.avgOrder.toFixed(2), "": totals.avgOrder === null ? "—" : compareText(totals.avgOrder, previousTotals?.avgOrder) });
    }
    if (debt) {
      rows.push({ Раздел: "", Показатель: "Зависло в долгах (на сейчас)", Значение: debt.total.toFixed(2), "": `магазинов: ${debt.shopCount}` });
    }
    if (summary) {
      rows.push({ Раздел: "", Показатель: "Агентов", Значение: summary.totalAgents, "": `на связи: ${summary.activeNow}` });
      rows.push({ Раздел: "", Показатель: "Визитов сегодня", Значение: summary.visitsToday, "": "" });
    }

    if (byShop && byShop.length > 0) {
      rows.push({ Раздел: "ПРОДАЖИ ПО МАГАЗИНАМ", Показатель: "Магазин", Значение: "Выручка", "": "Заказов" });
      for (const s of byShop) {
        rows.push({ Раздел: "", Показатель: s.shopName ?? "—", Значение: Number(s.revenue ?? 0).toFixed(2), "": s.orderCount ?? 0 });
      }
    }

    if (topProds && topProds.length > 0) {
      rows.push({ Раздел: "ТОП ТОВАРОВ", Показатель: "Товар", Значение: "Объём", "": "Выручка" });
      for (const p of topProds) {
        rows.push({ Раздел: "", Показатель: p.productName, Значение: Number(p.totalQty ?? 0).toFixed(0), "": Number(p.totalRevenue ?? 0).toFixed(2) });
      }
    }

    if (byPayment && byPayment.length > 0) {
      rows.push({ Раздел: "СПОСОБЫ ОПЛАТЫ", Показатель: "Способ", Значение: "Выручка", "": "Маржа, %" });
      for (const p of byPayment) {
        // The field is paymentMethod; reading `p.method` gave undefined, so
        // PAYMENT_MAP missed and the fallback printed undefined too — this
        // column has been blank in the summary and the PDF alike.
        const pm = PAYMENT_MAP[p.paymentMethod] ?? { label: p.paymentMethod };
        rows.push({ Раздел: "", Показатель: pm.label, Значение: Number(p.revenue ?? 0).toFixed(2), "": Number(p.grossMarginPct ?? 0).toFixed(1) });
      }
    }

    if (agentRows && agentRows.length > 0) {
      rows.push({ Раздел: "АГЕНТЫ", Показатель: "Агент", Значение: "Выручка", "": `К прошлым ${days} дн.` });
      for (const a of agentRows) {
        rows.push({ Раздел: "", Показатель: a.agentName ?? `Агент #${a.agentId}`, Значение: a.revenue.toFixed(2), "": compareText(a.revenue, a.prevRevenue) });
      }
    }

    if (debt && debt.top.length > 0) {
      // Десятка, а не весь список: это снимок страницы, а полный перечень
      // должников выгружает своя карточка «Долги магазинов» в каталоге.
      rows.push({ Раздел: "БОЛЬШЕ ВСЕХ ДОЛЖНЫ", Показатель: "Магазин", Значение: "Долг", "": `всего должников: ${debt.shopCount}` });
      for (const s of debt.top.slice(0, 10)) {
        rows.push({ Раздел: "", Показатель: s.name, Значение: s.debt.toFixed(2), "": "" });
      }
    }

    // Named like the hub's files — id then period — so the whole downloads
    // folder sorts and reads the same way. `report-<today>` said neither which
    // report it was nor what it covered.
    await exportToExcel(rows, `summary-last${days}d-${format(new Date(), "yyyy-MM-dd")}`, t("Отчёт", "Hisobot"), `${t("Сводный отчёт", "Yig'ma hisobot")} — ${format(new Date(), "dd.MM.yyyy")}`);
  };

  const handleExportPDF = () => {
    const fmtNum = (n: number) => n.toLocaleString("ru");
    let html = "";

    if (totals) {
      html += `<p>Период: ${esc(from)} — ${esc(to)}. Сравнение с ${esc(prevFrom)} — ${esc(prevTo)}.</p>
      <div class="kpi-grid">
        <div class="kpi"><div class="kpi-label">Выручка</div><div class="kpi-value">${fmtNum(totals.revenue)}</div><div>${esc(compareText(totals.revenue, previousTotals?.revenue))}</div></div>
        <div class="kpi"><div class="kpi-label">Заказов</div><div class="kpi-value">${fmtNum(totals.orders)}</div><div>${esc(compareText(totals.orders, previousTotals?.orders))}</div></div>
        <div class="kpi"><div class="kpi-label">Средний чек</div><div class="kpi-value">${totals.avgOrder === null ? "—" : fmtNum(Math.round(totals.avgOrder))}</div><div>${totals.avgOrder === null ? "—" : esc(compareText(totals.avgOrder, previousTotals?.avgOrder))}</div></div>
        <div class="kpi"><div class="kpi-label">Зависло в долгах</div><div class="kpi-value">${debt ? fmtNum(debt.total) : "—"}</div><div>${debt ? `магазинов: ${debt.shopCount}` : ""}</div></div>
      </div>`;
    }

    if (byShop && byShop.length > 0) {
      html += `<div class="section"><h2>Продажи по магазинам</h2>
        <table><thead><tr><th>Магазин</th><th class="right">Выручка</th><th class="right">Заказов</th></tr></thead><tbody>`;
      for (const s of byShop) {
        html += `<tr><td>${esc(s.shopName)}</td><td class="right">${fmtNum(Number(s.revenue ?? 0))}</td><td class="right">${Number(s.orderCount ?? 0)}</td></tr>`;
      }
      html += `</tbody></table></div>`;
    }

    if (topProds && topProds.length > 0) {
      html += `<div class="section"><h2>Топ товаров</h2>
        <table><thead><tr><th>Товар</th><th>Код</th><th class="right">Продано</th><th class="right">Выручка</th></tr></thead><tbody>`;
      for (const p of topProds) {
        html += `<tr><td>${esc(p.productName)}</td><td>${esc(p.productCode)}</td><td class="right">${Number(p.totalQty).toFixed(0)}</td><td class="right bold">${fmtNum(Number(p.totalRevenue))}</td></tr>`;
      }
      html += `</tbody></table></div>`;
    }

    if (byPayment && byPayment.length > 0) {
      html += `<div class="section"><h2>По способу оплаты</h2>
        <table><thead><tr><th>Способ</th><th class="right">Выручка</th><th class="right">Заказов</th><th class="right">Маржа, %</th></tr></thead><tbody>`;
      for (const p of byPayment) {
        const pm = PAYMENT_MAP[p.paymentMethod] ?? { label: p.paymentMethod };
        html += `<tr><td>${esc(pm.label)}</td><td class="right">${fmtNum(Number(p.revenue ?? 0))}</td><td class="right">${Number(p.orderCount ?? 0)}</td><td class="right">${Number(p.grossMarginPct ?? 0).toFixed(1)}</td></tr>`;
      }
      html += `</tbody></table></div>`;
    }

    if (agentRows && agentRows.length > 0) {
      html += `<div class="section"><h2>Агенты</h2>
        <table><thead><tr><th>Агент</th><th class="right">Заказы</th><th class="right">Средний чек</th><th class="right">Выручка</th><th class="right">К прошлым ${days} дн.</th></tr></thead><tbody>`;
      for (const a of agentRows) {
        html += `<tr><td>${esc(a.agentName ?? `Агент #${a.agentId}`)}</td><td class="right">${a.orders}</td><td class="right">${fmtNum(Math.round(a.avgOrderValue))}</td><td class="right bold">${fmtNum(a.revenue)}</td><td class="right">${esc(compareText(a.revenue, a.prevRevenue))}</td></tr>`;
      }
      html += `</tbody></table></div>`;
    }

    exportToPDF(`${t("Сводный отчёт", "Yig'ma hisobot")} — ${format(new Date(), "dd.MM.yyyy")}`, html);
  };

  // Сводка — единственный запрос, без которого страницы нет вовсе: остальные
  // разделы объясняют свой отказ сами и не уносят с собой соседей.
  if (summaryQ.isLoadingError) return <QueryErrorFallback onRetry={summaryQ.refetch} />;

  return (
    /*
      stagger-children — то же появление, что на главной: разделы проступают
      по очереди, а не все разом. Мелочь, но из таких мелочей и складывается
      ощущение, что страницы сделаны одной рукой.
    */
    <div className="stagger-children" style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "12px" }}>
        <div>
          <h1 style={{ fontFamily: F.display, fontSize: "24px", fontWeight: 700, color: COLORS.textPrimary, letterSpacing: "-0.025em", margin: 0 }}>
            {t("Отчёты", "Hisobotlar")}
          </h1>
          {/* Здесь стояла сегодняшняя дата — сведение, которое на странице
              отчётов не значит ничего. Значит другое: какой промежуток сейчас
              на экране. Его человек и пересказывает, когда пересылает цифры. */}
          <p style={{ fontSize: "13px", color: COLORS.textSecondary, margin: "4px 0 0" }}>
            {format(subDays(new Date(), days), "dd.MM.yyyy")} — {format(new Date(), "dd.MM.yyyy")}
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
          <PeriodPicker days={days} onChange={setDays} t={t} />
          {/* Кнопки были 33 точки высотой при 13px шрифта и отступе 8px.
              .neo-btn плюс .tap дают домашний вид и настоящие 44. */}
          <button type="button" onClick={handleExport} className="neo-btn tap" style={{ padding: "0 14px" }}>
            {/* Not "Excel" any more: the hub has fourteen buttons with that
                label, each producing one clean report. This one is a snapshot
                of the page as it stands — a different, still useful thing, and
                the name should say which is which. */}
            <FileDown size={14} aria-hidden /> {t("Сводка", "Yig'ma")}
          </button>
          <button type="button" onClick={handleExportPDF} className="neo-btn tap" style={{ padding: "0 14px" }}>
            <FileDown size={14} aria-hidden /> PDF
          </button>
          <button type="button" onClick={() => window.print()} className="neo-btn tap"
            aria-label={t("Печать", "Chop etish")} style={{ padding: "0 14px" }}>
            <Printer size={14} aria-hidden />
          </button>
        </div>
      </div>

      {/*
        Разделы и каталог — на одной строке, но не в одном ряду.

        Каталог выгрузок стоял пятой вкладкой наравне с разделами. Это разные
        вещи: разделы отвечают на вопрос здесь и сейчас, каталог отдаёт файл.
        Стоя рядом, они и растягивали ленту, и путали — человек не понимал,
        чем «Все отчёты» отличаются от «Продаж».

        Теперь слева четыре раздела, справа — вход в каталог, отделённый
        пробелом и другим видом. На узком экране он переносится под ленту сам:
        flex-wrap, а не горизонтальная прокрутка, потому что прокрутка прячет
        то, до чего не догадались дотянуть.
      */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" }}>
        {/*
          Лента разделов — тот же .range-pills, что у периода выше и на
          главной. Своя была нарисована рядом и почти так же: другие тени,
          другой радиус, другой цвет выбранного. Именно из таких «почти» и
          складывается ощущение, что страница сделана не тем же человеком.
        */}
        <div role="tablist" className="range-pills">
          {TABS.map(tb => (
            <button key={tb.key} type="button" role="tab" aria-selected={tab === tb.key} onClick={() => setTab(tb.key)}
              className={"range-pill tap" + (tab === tb.key ? " active" : "")}
              style={{ display: "flex", alignItems: "center", gap: "7px", whiteSpace: "nowrap" }}>
              {tb.icon}
              {t(tb.ru, tb.uz)}
            </button>
          ))}
        </div>

        <button type="button" onClick={() => setTab(tab === "all" ? "overview" : "all")}
          aria-pressed={tab === "all"}
          className="neo-btn tap" style={{
            padding: "0 16px", gap: "7px",
            color: tab === "all" ? COLORS.primaryText : COLORS.textSecondary,
          }}>
          <LayoutGrid size={16} aria-hidden />
          {tab === "all"
            ? t("Скрыть выгрузки", "Yuklamalarni yashirish")
            : t("Все выгрузки", "Barcha yuklamalar")}
        </button>
      </div>

      {/* Tab content */}
      {tab === "all" && (
        <ReportsHub role={user?.role} t={t} lang={lang} />
      )}

      {tab === "overview" && (
        <OverviewTab
          summary={summary}
          summaryLoading={summaryQ.isLoading}
          chart={chartQ.data}
          plans={plansQ.data}
          topProducts={topProductsOverview}
          topShops={topShopsOverview}
          topAgents={topAgentsOverview}
          days={days}
          fmt={fmt}
          t={t}
          totals={totals}
          previous={previousTotals}
          debt={debt}
          errors={{
            summary: summaryQ.isError ? { onRetry: () => void summaryQ.refetch() } : undefined,
            totals: agentsQ.isError ? { onRetry: () => void agentsQ.refetch() } : undefined,
            chart: chartQ.isError ? { onRetry: () => void chartQ.refetch() } : undefined,
            plans: plansQ.isError ? { onRetry: () => void plansQ.refetch() } : undefined,
            products: topProdsQ.isError ? { onRetry: () => void topProdsQ.refetch() } : undefined,
            shops: byShopQ.isError ? { onRetry: () => void byShopQ.refetch() } : undefined,
            agents: agentsQ.isError ? { onRetry: () => void agentsQ.refetch() } : undefined,
            debt: debtQ.isError ? { onRetry: () => void debtQ.refetch() } : undefined,
          }}
        />
      )}

      {tab === "sales" && (
        <SalesTab
          shopChartData={shopChartData}
          byPayment={paymentBreakdown}
          topProds={topProductRows}
          periodRevenue={totals?.revenue ?? null}
          fmt={fmt}
          t={t}
          errors={{
            shops: byShopQ.isError ? () => void byShopQ.refetch() : undefined,
            products: topProdsQ.isError ? () => void topProdsQ.refetch() : undefined,
            payment: byPaymentQ.isError ? () => void byPaymentQ.refetch() : undefined,
          }}
        />
      )}

      {tab === "agents" && (
        <AgentsTab
          agents={agentRows}
          days={days}
          isLoading={agentsQ.isLoading}
          isError={agentsQ.isError}
          onRetry={() => void agentsQ.refetch()}
          fmt={fmt}
          t={t}
          onExport={handleExport}
          onExportPDF={handleExportPDF}
        />
      )}

      {/*
        «Что продаёт каждый агент» — подробность про агентов, а не отдельный
        раздел. Стоя пятой вкладкой, она делила один разговор надвое: сравнение
        агентов в одном месте, состав их продаж в другом, и переключаться между
        ними приходилось через всю ленту.
      */}
      {tab === "agents" && (
        <details open className="neo-card" style={{ padding: "20px 24px" }}>
          <summary className="tap" style={{
            cursor: "pointer", listStyle: "none",
            fontFamily: F.display, fontSize: "15px", fontWeight: 600, color: COLORS.textPrimary,
          }}>
            {t("Что продаёт каждый агент", "Har bir agent nima sotadi")}
          </summary>
          <div style={{ marginTop: "16px" }}>
            <AgentProductsTab
              rows={agentProductsQ.data}
              isLoading={agentProductsQ.isLoading}
              isError={agentProductsQ.isError}
              onRetry={() => void agentProductsQ.refetch()}
              dateFrom={apDateFrom}
              dateTo={apDateTo}
              onDateFromChange={setApDateFrom}
              onDateToChange={setApDateTo}
              fmt={fmt}
              t={t}
              onExport={handleExportAgentProducts}
            />
          </div>
        </details>
      )}

      {/*
        Где деньги зависли — четвёртый вопрос, которого на странице не было.
        Долг жил одной карточкой выгрузки в каталоге: увидеть его можно было,
        только скачав файл. Та же часть стоит и на странице магазинов —
        считать долг двумя способами эта система уже пробовала.
      */}
      {tab === "debts" && (
        <div className="neo-card" style={{ padding: "24px" }}>
          <DebtorsPanel t={t} lang={lang} limit={15} />
        </div>
      )}
    </div>
  );
}
