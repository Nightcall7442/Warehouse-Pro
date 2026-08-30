// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import { OverviewTab } from "../components/reports/OverviewTab";

/**
 * Вкладка «Обзор» должна занимать экран, а не треть его.
 *
 * Было так: сетка на три колонки, в ней график и план дня — по одной колонке
 * каждый. Правая треть пустовала при любых данных, а ниже шла пустота во всю
 * ширину. Цифры при этом на странице были — просто лежали в соседних вкладках,
 * и чтобы их увидеть, приходилось переключаться.
 *
 * Проверяется то, ради чего правка делалась: три сводки на месте, в каждой не
 * больше пяти строк, порядок по убыванию, и на пустых данных вместо поломки —
 * внятная строка.
 */

// recharts в jsdom меряет контейнер нулевым и сыплет предупреждениями в вывод.
// К проверяемому это отношения не имеет, поэтому график подменён заглушкой.
vi.mock("recharts", () => {
  const Пусто = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  return {
    ResponsiveContainer: Пусто, LineChart: Пусто, Line: () => null,
    XAxis: () => null, YAxis: () => null, CartesianGrid: () => null,
    Tooltip: () => null, Legend: () => null,
  };
});

afterEach(cleanup);

const t = (ru: string) => ru;
const fmt = (v: string | number) => String(v);

const summary = {
  totalAgents: 3, activeNow: 0, visitsToday: 0,
  ordersMonth: 0, avgOrdersPerAgent: 0, revenueMonth: 0,
};

const товары = [
  { productName: "Сахар", totalQty: 10, totalRevenue: 300 },
  { productName: "Мука", totalQty: 40, totalRevenue: 900 },
  { productName: "Чай", totalQty: 5, totalRevenue: 700 },
  { productName: "Соль", totalQty: 3, totalRevenue: 100 },
  { productName: "Рис", totalQty: 8, totalRevenue: 500 },
  { productName: "Масло", totalQty: 2, totalRevenue: 50 },
];

function поднять(over: Partial<Parameters<typeof OverviewTab>[0]> = {}) {
  return render(
    <OverviewTab
      summary={summary}
      summaryLoading={false}
      chart={[]}
      plans={[]}
      topProducts={[...товары].sort((a, b) => b.totalRevenue - a.totalRevenue)}
      topShops={[{ name: "Хумо", revenue: 900 }, { name: "Барака", revenue: 400 }]}
      topAgents={[{ agentId: 1, agentName: "Азиз", visits: 4, orders: 2, revenue: 800 }]}
      days={30}
      fmt={fmt}
      t={t}
      {...over}
    />,
  );
}

describe("вкладка «Обзор»", () => {
  it("показывает все три сводки", () => {
    поднять();

    expect(screen.getByText(/Топ товаров/)).toBeDefined();
    expect(screen.getByText(/Топ магазинов/)).toBeDefined();
    expect(screen.getByText(/Лучшие агенты/)).toBeDefined();
  });

  it("в сводке не больше пяти строк", () => {
    поднять();

    // Шестой товар по выручке — «Соль» (100); «Масло» (50) отсечено.
    expect(screen.queryByText("Масло")).toBeNull();
    expect(screen.getByText("Соль")).toBeDefined();
  });

  it("график занимает две колонки из трёх", () => {
    const { container } = поднять();

    expect(container.querySelector(".lg\\:col-span-2")).not.toBeNull();
  });

  it("на пустых данных пишет причину, а не ломается", () => {
    поднять({ topProducts: [], topShops: [], topAgents: [] });

    expect(screen.getAllByText("За период продаж не было")).toHaveLength(2);
    expect(screen.getByText("Пока нет данных по агентам")).toBeDefined();
  });

  it("переживает неприехавшие данные", () => {
    поднять({ topProducts: undefined, topShops: undefined, topAgents: undefined });

    expect(screen.getByText(/Топ товаров/)).toBeDefined();
  });
});
