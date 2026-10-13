/**
 * Ряд «Доходы и расходы» — шагом под длину периода.
 *
 * Помесячный график на «30 днях» рисовал два столбца: половину сентября и
 * половину октября, и октябрьский — за неполные две недели — выглядел
 * обвалом. Здесь закреплено:
 *   1. шаг: до 31 дня — дни, до 92 — недели, дальше — месяцы;
 *   2. дни без продаж стоят нулями, а не выпадают с оси;
 *   3. неделя на краю периода обрезана его границей;
 *   4. суммы по отрезкам сходятся с суммой периода — график не врёт карточке.
 *
 * Нарочная поломка: убери заполнение пустых дней в bucketSeries — упадёт
 * «дни без продаж»; верни 30 вместо 31 — упадёт «30 дней — по дням».
 */
import { describe, it, expect } from "vitest";
import { bucketSeries, monthBounds, seriesGranularity, type SeriesInputRow } from "../services/pnl-series";

const row = (key: string, revenue: number, cogs = 0, operatingExpenses = 0, orderCount = 1): SeriesInputRow =>
  ({ key, revenue, cogs, operatingExpenses, orderCount });

describe("шаг ряда", () => {
  it("«30 дней» (31 день с обоими концами) — по дням", () => {
    expect(seriesGranularity("2026-09-12", "2026-10-12")).toBe("day");
    expect(seriesGranularity("2026-10-06", "2026-10-13")).toBe("day");
    expect(seriesGranularity("2026-10-13", "2026-10-13")).toBe("day");
  });
  it("«90 дней» — по неделям, год — по месяцам", () => {
    expect(seriesGranularity("2026-07-15", "2026-10-13")).toBe("week");
    expect(seriesGranularity("2026-09-11", "2026-10-13")).toBe("week");
    expect(seriesGranularity("2025-10-13", "2026-10-13")).toBe("month");
    expect(seriesGranularity("2026-07-13", "2026-10-13")).toBe("month");
  });
});

describe("по дням", () => {
  it("дни без продаж — нулями, ось не теряет дней", () => {
    const pts = bucketSeries([row("2026-10-02", 500, 300)], "2026-10-01", "2026-10-04", "day");
    expect(pts.map(p => p.start)).toEqual(["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"]);
    expect(pts.map(p => p.revenue)).toEqual([0, 500, 0, 0]);
    expect(pts[1]).toMatchObject({ grossProfit: 200, netProfit: 200, orderCount: 1 });
  });

  it("день только с расходом — убыточный день, а не пропуск", () => {
    const pts = bucketSeries([row("2026-10-03", 0, 0, 120, 0)], "2026-10-01", "2026-10-04", "day");
    expect(pts[2]).toMatchObject({ revenue: 0, operatingExpenses: 120, netProfit: -120 });
  });

  it("десятичные суммы без хвостов", () => {
    const pts = bucketSeries([row("2026-10-01", 0.1), row("2026-10-01", 0.2)], "2026-10-01", "2026-10-01", "day");
    expect(pts[0].revenue).toBe(0.3);
  });
});

describe("по неделям", () => {
  it("недели с понедельника, края обрезаны периодом", () => {
    // 17.09.2026 — четверг, 13.10.2026 — вторник.
    const pts = bucketSeries([], "2026-09-17", "2026-10-13", "week");
    expect(pts.map(p => [p.start, p.end])).toEqual([
      ["2026-09-17", "2026-09-20"],
      ["2026-09-21", "2026-09-27"],
      ["2026-09-28", "2026-10-04"],
      ["2026-10-05", "2026-10-11"],
      ["2026-10-12", "2026-10-13"],
    ]);
  });

  it("сумма недель — сумма периода", () => {
    const rows = [
      row("2026-09-17", 1000, 600), row("2026-09-20", 500, 200),
      row("2026-09-21", 300, 100, 50), row("2026-10-13", 700, 400),
    ];
    const pts = bucketSeries(rows, "2026-09-17", "2026-10-13", "week");
    expect(pts[0]).toMatchObject({ revenue: 1500, cogs: 800, orderCount: 2 });
    expect(pts[1]).toMatchObject({ revenue: 300, netProfit: 150 });
    const total = pts.reduce((s, p) => s + p.revenue, 0);
    expect(total).toBe(2500);
  });
});

describe("месяц внутри периода", () => {
  it("подписан с того числа, с которого он в периоде", () => {
    expect(monthBounds("2026-09", "2026-09-13", "2026-10-13")).toEqual({ start: "2026-09-13", end: "2026-09-30" });
    expect(monthBounds("2026-10", "2026-09-13", "2026-10-13")).toEqual({ start: "2026-10-01", end: "2026-10-13" });
    expect(monthBounds("2026-02", "2026-01-01", "2026-12-31")).toEqual({ start: "2026-02-01", end: "2026-02-28" });
  });
});
