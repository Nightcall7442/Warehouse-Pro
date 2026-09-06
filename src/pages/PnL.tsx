import { useState, useMemo } from "react";
import { trpc } from "@/providers/trpc";
import { useCurrency } from "@/hooks/useCurrency";
import { useLang } from "@/i18n";
import { exportToPDF } from "@/lib/export";
import { notify } from "@/lib/toast";
import { cssVar } from "@/lib/css-var";
import { readableInk } from "@/lib/contrast";
import { subDays, format, subMonths, startOfYear } from "date-fns";
import { paymentLabel } from "@/components/pnl/styles";
import {
  PnLPeriodSelector,
  PnLHeadline,
  PnLSummaryCards,
  DateInput,
  PnLPaymentBreakdown,
  PnLRevenueChart,
  PnLExpenseBreakdown,
  PnLTransportExpenses,
} from "@/components/pnl";
import type { Range } from "@/components/pnl";
import { QueryErrorFallback } from "@/components/QueryErrorFallback";
import { useSellerCompany } from "@/hooks/useSellerCompany";

const COLORS = {
  surface: "var(--color-surface, #efedea)",
  surfaceLight: "var(--color-surface-light, #f6f4f0)",
  textTertiary: "var(--color-text-tertiary, #6b6760)",
};

/** Дата из «2026-08-14» в «14.08.2026» — для шапок отчётов. */
const human = (iso: string) => iso.split("-").reverse().join(".");

/**
 * Цвет шапки в выгрузке — арендатора, а не системы.
 *
 * В листах стояло FF4F46E5 — индиго, которого нет ни в палитре приложения, ни
 * у арендатора. Файл уходит наружу, и цвет в нём должен быть тот же, что на
 * экране. Тот же приём уже применён в lib/excel.ts; здесь он повторён, потому
 * что тамошний помощник не вынесен наружу.
 *
 * ExcelJS хранит цвет как AARRGGBB и переменных темы не понимает — литерал
 * здесь неизбежен, поэтому значение читается из темы в момент выгрузки.
 */
function brandHex(): string {
  const hex = cssVar("--color-primary", "").trim();
  return /^#[0-9a-fA-F]{6}$/.test(hex) ? hex : "#5b6d8a";
}
const argb = (hex: string) => "FF" + hex.replace("#", "").toUpperCase();

export default function PnL() {
  const [range, setRange] = useState<Range>("30d");
  const [customFrom, setCustomFrom] = useState(() =>
    format(subDays(new Date(), 30), "yyyy-MM-dd")
  );
  const [customTo, setCustomTo] = useState(() =>
    format(new Date(), "yyyy-MM-dd")
  );
  const [showCustom, setShowCustom] = useState(false);
  const { fmt } = useCurrency();
  const { lang } = useLang();
  const t = (ru: string, uz: string) => (lang === "uz" ? uz : ru);

  const { from, to } = useMemo(() => {
    const now = new Date();
    switch (range) {
      case "7d":
        return {
          from: format(subDays(now, 7), "yyyy-MM-dd"),
          to: format(now, "yyyy-MM-dd"),
        };
      case "30d":
        return {
          from: format(subDays(now, 30), "yyyy-MM-dd"),
          to: format(now, "yyyy-MM-dd"),
        };
      case "90d":
        return {
          from: format(subDays(now, 90), "yyyy-MM-dd"),
          to: format(now, "yyyy-MM-dd"),
        };
      case "12m":
        return {
          from: format(subMonths(now, 12), "yyyy-MM-dd"),
          to: format(now, "yyyy-MM-dd"),
        };
      case "ytd":
        return {
          from: format(startOfYear(now), "yyyy-MM-dd"),
          to: format(now, "yyyy-MM-dd"),
        };
      case "custom":
        return { from: customFrom, to: customTo };
      default:
        return {
          from: format(subDays(now, 30), "yyyy-MM-dd"),
          to: format(now, "yyyy-MM-dd"),
        };
    }
  }, [range, customFrom, customTo]);

  const { company: seller } = useSellerCompany();
  const { data, isLoading, isLoadingError, refetch } = trpc.analytics.pnl.useQuery({
    from,
    to,
    compareWithPrev: true,
  });

  const cogsByProduct = trpc.analytics.cogsByProduct.useQuery({
    dateFrom: from,
    dateTo: to,
  });
  const arrivals = trpc.arrival.list.useQuery({ page: 1, pageSize: 1000 });
  const paymentBreakdown = trpc.analytics.pnlByPaymentMethod.useQuery({
    from,
    to,
  });
  const paymentTrend = trpc.analytics.paymentMethodTrend.useQuery({ from, to });

  const current = data?.current;
  const deltas = data?.deltas;
  const trend = useMemo(() => data?.trend ?? [], [data]);

  const chartData = useMemo(() => {
    return trend.map((r) => ({
      month: r.month,
      revenue: r.revenue,
      cogs: r.cogs,
      grossProfit: r.grossProfit,
      netProfit: r.netProfit,
    }));
  }, [trend]);

  const handleRangeChange = (newRange: Range) => {
    setRange(newRange);
    setShowCustom(newRange === "custom");
  };

  const handleExportExcel = async () => {
    if (!current) {
      notify.info(t("Нет данных для выгрузки", "Yuklab olishga ma'lumot yo'q"));
      return;
    }

    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    // Свойства файла видит всякий, кто его откроет: автором стоит
    // организация, выгрузившая отчёт, а не поставщик системы.
    wb.creator = seller.name || "";
    wb.created = new Date();

    const brand = brandHex();
    const headFill = argb(brand);
    const headInk = argb(readableInk(brand));
    const gridLine = { style: "thin" as const, color: { argb: "FFD9D9D9" } };
    const box = { top: gridLine, bottom: gridLine, left: gridLine, right: gridLine };

    type Sheet = ReturnType<typeof wb.addWorksheet>;

    /*
      Шапка листа — одним местом на все четыре листа.

      Надпись на заливке бралась белым. Фирменный цвет задаёт арендатор, и он
      бывает светлым: на латунном #c9a227 белым по светлому — 1.9:1, заголовки
      колонок пропадали. readableInk выбирает чернила по яркости заливки, тем
      же правилом, что и на экране.
    */
    const addHead = (ws: Sheet, titles: string[]) => {
      const row = ws.addRow(titles);
      row.eachCell((c) => {
        c.font = { bold: true, size: 11, color: { argb: headInk } };
        c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: headFill } };
        c.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
        c.border = box;
      });
      row.height = 26;
      return row;
    };

    const addTitle = (ws: Sheet, title: string, subtitle: string, span: number) => {
      ws.mergeCells(1, 1, 1, span);
      const t1 = ws.getCell("A1");
      t1.value = title;
      t1.font = { bold: true, size: 14 };
      ws.mergeCells(2, 1, 2, span);
      const t2 = ws.getCell("A2");
      t2.value = subtitle;
      t2.font = { size: 10, color: { argb: "FF6B6760" } };
      ws.addRow([]);
    };

    /*
      Ширина колонки — по самому длинному значению в ней.

      Ширины были расставлены руками (22, 18, 14…), и длинные названия товаров
      обрезались, а короткие колонки занимали половину листа пустотой.
    */
    const autoWidth = (ws: Sheet, headerRow: number) => {
      ws.columns.forEach((col, i) => {
        let max = 8;
        ws.eachRow((row, n) => {
          if (n < headerRow) return;
          const v = row.getCell(i + 1).value;
          const len =
            typeof v === "number"
              ? Math.round(v).toLocaleString("ru-RU").length
              : String(v ?? "").length;
          if (len > max) max = len;
        });
        col.width = Math.min(max + 4, 42);
      });
    };

    const zebra = (row: ReturnType<Sheet["addRow"]>, index: number) => {
      row.eachCell((c) => {
        c.border = box;
        c.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: index % 2 === 0 ? "FFF7F6F4" : "FFFFFFFF" },
        };
      });
    };

    const MONEY = "#,##0";
    const SHARE = "0.0%";

    // ── Лист 1: Сводка ────────────────────────────────────────────────────
    const ws1 = wb.addWorksheet("Сводка");
    addTitle(
      ws1,
      `Доходы и расходы: ${human(from)} — ${human(to)}`,
      `Сформирован: ${new Date().toLocaleDateString("ru-RU", { day: "2-digit", month: "long", year: "numeric" })}`,
      3
    );
    const head1 = addHead(ws1, ["Показатель", "Сумма", "Доля от выручки"]);

    const revenue = current.revenue;
    /*
      Суммы уходили в файл СТРОКАМИ: `fmtMoney(value)` возвращал «5 520 500», а
      формат «#,##0» вешался поверх текста и ничего не менял. Excel такую
      ячейку не складывает, не сортирует и подсвечивает уголком «число как
      текст» — владелец не мог даже выделить колонку и увидеть сумму внизу
      окна. Числа теперь числа, а вид им задаёт numFmt.

      Доля тоже число: 0,235 с форматом «0.0%», а не текст «23.5%».
    */
    const summary: Array<[string, number, number | null, boolean]> = [
      ["Выручка", revenue, revenue > 0 ? 1 : null, true],
      ["Скидки", current.discount, revenue > 0 ? current.discount / revenue : null, false],
      ["Себестоимость (COGS)", current.cogs, revenue > 0 ? current.cogs / revenue : null, false],
      ["Валовая прибыль", current.grossProfit, current.grossMarginPct / 100, true],
      ["Расходы на доставку", current.operatingExpenses, revenue > 0 ? current.operatingExpenses / revenue : null, false],
      ["Чистая прибыль", current.netProfit, current.netMarginPct / 100, true],
      ["Заказов, шт.", current.orderCount, null, false],
    ];
    summary.forEach(([label, value, share, bold], i) => {
      const row = ws1.addRow([label, value, share]);
      row.getCell(2).numFmt = label === "Заказов, шт." ? "#,##0" : MONEY;
      row.getCell(3).numFmt = SHARE;
      zebra(row, i);
      if (bold) row.eachCell((c) => { c.font = { bold: true }; });
    });
    autoWidth(ws1, head1.number);

    // ── Лист 2: Сравнение периодов ────────────────────────────────────────
    if (data?.previous && data.prevPeriod) {
      const ws2 = wb.addWorksheet("Сравнение периодов");
      addTitle(
        ws2,
        "Сравнение с предыдущим периодом",
        `Текущий: ${human(from)} — ${human(to)} · прошлый: ${human(data.prevPeriod.from)} — ${human(data.prevPeriod.to)}`,
        4
      );
      const head2 = addHead(ws2, ["Показатель", "Текущий период", "Прошлый период", "Изменение"]);

      /*
        Изменение пересчитывалось прямо здесь: `prev > 0 ? (curr-prev)/prev : 0`.
        Сервер считает его иначе — от модуля прошлого значения, — и при убытке в
        прошлом периоде (prev < 0) здешняя ветка отдавала «0.0%». На экране
        стояло одно число, в файле по тем же данным другое. Берём готовое.

        Рост — не всегда хорошо: у себестоимости и расходов он красный. Зелёная
        строка «Себестоимость +38%» поздравляла с утечкой денег.
      */
      const comparisons: Array<[string, number, number, number | null | undefined, boolean]> = [
        ["Выручка", current.revenue, data.previous.revenue, deltas?.revenue, true],
        ["Себестоимость (COGS)", current.cogs, data.previous.cogs, deltas?.cogs, false],
        ["Валовая прибыль", current.grossProfit, data.previous.grossProfit, deltas?.grossProfit, true],
        ["Расходы на доставку", current.operatingExpenses, data.previous.operatingExpenses, deltas?.operatingExpenses, false],
        ["Чистая прибыль", current.netProfit, data.previous.netProfit, deltas?.netProfit, true],
      ];
      comparisons.forEach(([label, curr, prev, delta, higherIsBetter], i) => {
        const row = ws2.addRow([label, curr, prev, delta == null ? "нет данных" : delta / 100]);
        row.getCell(2).numFmt = MONEY;
        row.getCell(3).numFmt = MONEY;
        zebra(row, i);
        if (delta != null) {
          row.getCell(4).numFmt = "+0.0%;−0.0%";
          const good = delta === 0 ? null : delta > 0 === higherIsBetter;
          if (good !== null) {
            row.getCell(4).font = { bold: true, color: { argb: good ? "FF157A45" : "FFA32D2D" } };
          }
        }
      });
      autoWidth(ws2, head2.number);
    }

    // ── Лист 3: По товарам ────────────────────────────────────────────────
    if (cogsByProduct.data && cogsByProduct.data.length > 0) {
      const ws3 = wb.addWorksheet("По товарам");
      addTitle(
        ws3,
        "На чём заработали",
        "До 20 товаров с наибольшей выручкой. Выручка здесь считается по цене отгрузки, без скидок по заказу, — с выручкой на листе «Сводка» она не совпадает.",
        6
      );
      const head3 = addHead(ws3, ["Товар", "Объём", "Выручка", "Себестоимость", "Прибыль", "Маржа"]);

      const products = cogsByProduct.data
        .map((p) => {
          const rev = Number(p.totalRevenue ?? 0);
          const cost = Number(p.totalCost ?? 0);
          return {
            // Товар мог быть удалён — LEFT JOIN отдаёт по нему null, и в файле
            // оставалась пустая ячейка.
            name: p.productName ?? "Без названия",
            qty: Number(p.totalQty ?? 0),
            rev,
            cost,
            profit: rev - cost,
            margin: rev > 0 ? (rev - cost) / rev : 0,
          };
        })
        .sort((a, b) => b.profit - a.profit);

      products.forEach((p, i) => {
        const row = ws3.addRow([p.name, p.qty, p.rev, p.cost, p.profit, p.margin]);
        [2, 3, 4, 5].forEach((c) => (row.getCell(c).numFmt = MONEY));
        row.getCell(6).numFmt = SHARE;
        zebra(row, i);
      });

      /*
        Итоговая строка называлась «ИТОГО» — и это была неправда: сервер отдаёт
        двадцать лучших товаров, а не все. Директор пытался свести её с выручкой
        со «Сводки» и не сводил. Строка теперь говорит, по чему именно итог.
      */
      const totalRev = products.reduce((s, p) => s + p.rev, 0);
      const totalCost = products.reduce((s, p) => s + p.cost, 0);
      const totals = ws3.addRow([
        `Итого по ${products.length} показанным товарам`,
        products.reduce((s, p) => s + p.qty, 0),
        totalRev,
        totalCost,
        totalRev - totalCost,
        totalRev > 0 ? (totalRev - totalCost) / totalRev : 0,
      ]);
      [2, 3, 4, 5].forEach((c) => (totals.getCell(c).numFmt = MONEY));
      totals.getCell(6).numFmt = SHARE;
      totals.eachCell((c) => {
        c.font = { bold: true };
        c.border = { ...box, top: { style: "medium", color: { argb: headFill } } };
      });
      autoWidth(ws3, head3.number);
    }

    // ── Лист 4: По способам оплаты ────────────────────────────────────────
    if (paymentBreakdown.data && paymentBreakdown.data.length > 0) {
      const ws4 = wb.addWorksheet("По способам оплаты");
      addTitle(ws4, "Чем платят", `Период: ${human(from)} — ${human(to)}`, 6);
      const head4 = addHead(ws4, [
        "Способ оплаты",
        "Выручка",
        "Себестоимость",
        "Прибыль",
        "Маржа",
        "Заказов",
      ]);

      const methods = [...paymentBreakdown.data].sort((a, b) => b.revenue - a.revenue);
      methods.forEach((m, i) => {
        // Запасным значением стоял сам код способа оплаты, и в файл владельцу
        // уходило «unknown» — внутреннее слово базы в отчёте для директора.
        const row = ws4.addRow([
          paymentLabel(m.paymentMethod, "ru"),
          m.revenue,
          m.cogs ?? 0,
          m.grossProfit ?? 0,
          (m.grossMarginPct ?? 0) / 100,
          m.orderCount ?? 0,
        ]);
        [2, 3, 4].forEach((c) => (row.getCell(c).numFmt = MONEY));
        row.getCell(5).numFmt = SHARE;
        zebra(row, i);
      });

      const sum = (pick: (m: (typeof methods)[number]) => number) =>
        methods.reduce((s, m) => s + pick(m), 0);
      const revAll = sum((m) => m.revenue);
      const totals = ws4.addRow([
        "ИТОГО",
        revAll,
        sum((m) => m.cogs ?? 0),
        sum((m) => m.grossProfit ?? 0),
        revAll > 0 ? sum((m) => m.grossProfit ?? 0) / revAll : 0,
        sum((m) => m.orderCount ?? 0),
      ]);
      [2, 3, 4].forEach((c) => (totals.getCell(c).numFmt = MONEY));
      totals.getCell(5).numFmt = SHARE;
      totals.eachCell((c) => {
        c.font = { bold: true };
        c.border = { ...box, top: { style: "medium", color: { argb: headFill } } };
      });
      autoWidth(ws4, head4.number);
    }

    const buffer = await wb.xlsx.writeBuffer();
    const blob = new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Доходы-и-расходы-${from}-${to}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportPDF = async () => {
    const fmtNum = (n: number) => n.toLocaleString("ru");
    const pct = (n: number) => `${n.toFixed(1)}%`;
    let html = "";

    html += `<div class="kpi-grid">
      <div class="kpi"><div class="kpi-label">Выручка</div><div class="kpi-value">${fmtNum(current?.revenue ?? 0)} сум</div></div>
      <div class="kpi"><div class="kpi-label">Себестоимость</div><div class="kpi-value">${fmtNum(current?.cogs ?? 0)} сум</div></div>
      <div class="kpi"><div class="kpi-label">Валовая прибыль</div><div class="kpi-value">${fmtNum(current?.grossProfit ?? 0)} сум</div></div>
      <div class="kpi"><div class="kpi-label">Чистая прибыль</div><div class="kpi-value">${fmtNum(current?.netProfit ?? 0)} сум</div></div>
    </div>`;

    html += `<div class="section"><h2>Сводка</h2>
      <table><thead><tr><th>Показатель</th><th class="right">Значение</th></tr></thead><tbody>
      <tr><td>Период</td><td class="right">${human(from)} — ${human(to)}</td></tr>
      <tr><td>Выручка</td><td class="right bold">${fmtNum(current?.revenue ?? 0)} сум</td></tr>
      <tr><td>Скидки</td><td class="right">${fmtNum(current?.discount ?? 0)} сум</td></tr>
      <tr><td>Себестоимость (COGS)</td><td class="right">${fmtNum(current?.cogs ?? 0)} сум</td></tr>
      <tr><td>Валовая прибыль</td><td class="right bold">${fmtNum(current?.grossProfit ?? 0)} сум</td></tr>
      <tr><td>Валовая маржа</td><td class="right">${pct(current?.grossMarginPct ?? 0)}</td></tr>
      <tr><td>Расходы на доставку</td><td class="right">${fmtNum(current?.operatingExpenses ?? 0)} сум</td></tr>
      <tr class="total"><td>Чистая прибыль</td><td class="right">${fmtNum(current?.netProfit ?? 0)} сум</td></tr>
      <tr><td>Чистая маржа</td><td class="right">${pct(current?.netMarginPct ?? 0)}</td></tr>
      <tr><td>Заказов</td><td class="right">${current?.orderCount ?? 0}</td></tr>
      </tbody></table></div>`;

    if (data?.previous && data.prevPeriod) {
      html += `<div class="section"><h2>Сравнение с прошлым периодом (${human(data.prevPeriod.from)} — ${human(data.prevPeriod.to)})</h2>
        <table><thead><tr><th>Показатель</th><th class="right">Текущий</th><th class="right">Прошлый</th><th class="right">Изменение</th></tr></thead><tbody>`;
      // Изменение берётся с сервера — тем же числом, что стоит на экране.
      const rows: Array<[string, number, number, number | null | undefined]> = [
        ["Выручка", current?.revenue ?? 0, data.previous.revenue, deltas?.revenue],
        ["Себестоимость (COGS)", current?.cogs ?? 0, data.previous.cogs, deltas?.cogs],
        ["Валовая прибыль", current?.grossProfit ?? 0, data.previous.grossProfit, deltas?.grossProfit],
        ["Расходы на доставку", current?.operatingExpenses ?? 0, data.previous.operatingExpenses, deltas?.operatingExpenses],
        ["Чистая прибыль", current?.netProfit ?? 0, data.previous.netProfit, deltas?.netProfit],
      ];
      for (const [label, curr, prev, delta] of rows) {
        const change = delta == null ? "—" : `${delta >= 0 ? "+" : "−"}${Math.abs(delta).toFixed(1)}%`;
        html += `<tr><td>${label}</td><td class="right">${fmtNum(curr)}</td><td class="right">${fmtNum(prev)}</td><td class="right">${change}</td></tr>`;
      }
      html += `</tbody></table></div>`;
    }

    if (cogsByProduct.data && cogsByProduct.data.length > 0) {
      html += `<div class="section"><h2>На чём заработали</h2>
        <table><thead><tr><th>Товар</th><th class="right">Объём</th><th class="right">Выручка</th><th class="right">Себестоимость</th><th class="right">Прибыль</th><th class="right">Маржа</th></tr></thead><tbody>`;
      const products = cogsByProduct.data
        .map((p) => {
          const rev = Number(p.totalRevenue);
          const cost = Number(p.totalCost);
          return { name: p.productName ?? "Без названия", qty: Number(p.totalQty), rev, cost, profit: rev - cost };
        })
        .sort((a, b) => b.profit - a.profit);
      for (const p of products) {
        const margin = p.rev > 0 ? pct((p.profit / p.rev) * 100) : "—";
        html += `<tr><td>${p.name}</td><td class="right">${p.qty.toFixed(0)}</td><td class="right">${fmtNum(p.rev)}</td><td class="right">${fmtNum(p.cost)}</td><td class="right bold">${fmtNum(p.profit)}</td><td class="right">${margin}</td></tr>`;
      }
      html += `</tbody></table></div>`;
    }

    if (paymentBreakdown.data && paymentBreakdown.data.length > 0) {
      html += `<div class="section"><h2>Чем платят</h2>
        <table><thead><tr><th>Способ оплаты</th><th class="right">Выручка</th><th class="right">Себестоимость</th><th class="right">Прибыль</th><th class="right">Маржа</th><th class="right">Заказов</th></tr></thead><tbody>`;
      for (const row of [...paymentBreakdown.data].sort((a, b) => b.revenue - a.revenue)) {
        html += `<tr><td>${paymentLabel(row.paymentMethod, "ru")}</td><td class="right">${fmtNum(row.revenue)}</td><td class="right">${fmtNum(row.cogs ?? 0)}</td><td class="right bold">${fmtNum(row.grossProfit ?? 0)}</td><td class="right">${pct(row.grossMarginPct ?? 0)}</td><td class="right">${row.orderCount}</td></tr>`;
      }
      html += `</tbody></table></div>`;
    }

    exportToPDF(`Доходы и расходы: ${human(from)} — ${human(to)}`, html);
  };

  if (isLoadingError) return <QueryErrorFallback onRetry={refetch} />;
  if (isLoading) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
        <div>
          <div
            style={{
              height: "28px",
              width: "240px",
              borderRadius: "8px",
              background: COLORS.surfaceLight,
              marginBottom: "8px",
            }}
          />
          <div
            style={{
              height: "16px",
              width: "180px",
              borderRadius: "6px",
              background: COLORS.surfaceLight,
            }}
          />
        </div>
        {/* Заглушка повторяет настоящую раскладку — крупная карточка с итогом
            и четыре плитки под ней, — чтобы страница не прыгала при загрузке. */}
        <div
          style={{
            height: "220px",
            borderRadius: "24px",
            background: COLORS.surfaceLight,
          }}
        />
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: "16px",
          }}
        >
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              style={{
                height: "150px",
                borderRadius: "24px",
                background: COLORS.surfaceLight,
                animation: `slideUp ${0.4 + i * 0.05}s ease`,
              }}
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
      <PnLPeriodSelector
        range={range}
        onRangeChange={handleRangeChange}
        onExportExcel={handleExportExcel}
        onExportPDF={handleExportPDF}
        from={from}
        to={to}
        t={t}
        lang={lang}
      />

      {showCustom && (
        <div
          className="neo-card-sm"
          style={{
            display: "flex",
            alignItems: "flex-end",
            gap: "16px",
            flexWrap: "wrap",
          }}
        >
          <DateInput value={customFrom} onChange={setCustomFrom} label={t("От", "Dan")} />
          <DateInput value={customTo} onChange={setCustomTo} label={t("До", "Gacha")} />
          <div
            style={{
              fontSize: "12px",
              color: COLORS.textTertiary,
              fontFamily: "'DM Sans', -apple-system, sans-serif",
              paddingBottom: "6px",
            }}
          >
            {t("Выберите период для анализа", "Tahlil uchun davrni tanlang")}
          </div>
        </div>
      )}

      {/* Ответ страницы: заработали или нет, лучше или хуже, куда ушло. */}
      <PnLHeadline
        current={current}
        previous={data?.previous}
        deltas={deltas}
        prevPeriod={data?.prevPeriod}
        fmt={fmt}
        t={t}
        lang={lang}
      />

      <PnLSummaryCards
        current={current}
        previous={data?.previous}
        deltas={deltas}
        fmt={fmt}
        t={t}
      />

      <PnLRevenueChart chartData={chartData} fmt={fmt} t={t} lang={lang} />

      <PnLExpenseBreakdown
        cogsByProduct={cogsByProduct.data}
        // Отказ запроса и пустой период — разные вещи: раздел получал только
        // data и оба случая показывал как «нет данных».
        error={cogsByProduct.isLoadingError}
        onRetry={() => void cogsByProduct.refetch()}
        fmt={fmt}
        lang={lang}
      />

      <PnLPaymentBreakdown
        paymentBreakdown={paymentBreakdown.data}
        paymentTrend={paymentTrend.data}
        error={paymentBreakdown.isLoadingError}
        trendError={paymentTrend.isLoadingError}
        onRetry={() => {
          void paymentBreakdown.refetch();
          void paymentTrend.refetch();
        }}
        fmt={fmt}
        t={t}
        lang={lang}
      />

      <PnLTransportExpenses
        arrivals={arrivals.data?.data}
        from={from}
        to={to}
        error={arrivals.isLoadingError}
        onRetry={() => void arrivals.refetch()}
        fmt={fmt}
        lang={lang}
      />
    </div>
  );
}
