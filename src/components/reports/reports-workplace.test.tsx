// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, screen, fireEvent, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { delta } from "./report-constants";
import { REPORTS, reportColumns, type ReportDef, type Row } from "./report-registry";
import { OverviewTab } from "./OverviewTab";
import { AgentsTab, type AgentRow } from "./AgentsTab";

/**
 * Страница «Отчёты» как рабочее место, а не витрина чисел.
 *
 * Проверяется ровно то, ради чего переделка делалась и что ломается молча:
 *
 *  1. Число без точки отсчёта. Сравнение «не с чем» и сравнение «ноль» — это
 *     разные ответы, и путать их нельзя: «0 %» читается как «не изменилось».
 *  2. Отказ, похожий на пустоту. Упавший запрос печатал «Нет данных» — то
 *     есть выглядел как честный ответ «за месяц не продали ничего».
 *  3. Внутренние коды в выгрузке. Ровно та болезнь, из-за которой владелец
 *     назвал файл движений нечитаемым: «manual_adjustment #null»,
 *     «Заказ: new → delivered», «Статус: active».
 */

// recharts в jsdom меряет контейнер нулевым и сыплет предупреждениями в вывод.
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

describe("точка отсчёта", () => {
  it("считает изменение к прошлому периоду", () => {
    expect(delta(120, 100)?.pct, "рост на пятую часть").toBeCloseTo(20);
    expect(delta(80, 100)?.pct, "падение на пятую часть").toBeCloseTo(-20);
  });

  it("молчит там, где сравнивать не с чем", () => {
    // Не ноль процентов: в прошлом периоде продаж не было вовсе, и «0 %»
    // читалось бы как «не изменилось».
    expect(delta(500, 0), "прошлый период пуст").toBeNull();
    expect(delta(500, null), "данных за прошлый период нет").toBeNull();
    expect(delta(500, undefined)).toBeNull();
  });

  it("сохраняет само прошлое число — процент без него ни о чём", () => {
    expect(delta(120, 100)?.previous).toBe(100);
  });
});

describe("«Сводка» отвечает, а не показывает", () => {
  const summary = {
    totalAgents: 3, activeNow: 1, visitsToday: 4,
    ordersMonth: 40, avgOrdersPerAgent: 13, revenueMonth: 900,
  };

  function поднять(over: Partial<Parameters<typeof OverviewTab>[0]> = {}) {
    return render(
      <OverviewTab
        summary={summary}
        summaryLoading={false}
        chart={[]}
        plans={[]}
        topProducts={[]}
        topShops={[]}
        topAgents={[]}
        days={30}
        fmt={fmt}
        t={t}
        totals={{ revenue: 1200, orders: 10, avgOrder: 120 }}
        previous={{ revenue: 1000, orders: 8, avgOrder: 125 }}
        debt={{ total: 700, shopCount: 2, top: [{ name: "Хумо", debt: 500 }] }}
        {...over}
      />,
    );
  }

  it("рядом с выручкой стоит, с чем её сравнивать", () => {
    поднять();
    // +20 % и само прошлое число: без второго процент не проверяем глазами.
    expect(screen.getByText("+20%")).toBeDefined();
    expect(screen.getByText(/было 1000 за прошлые 30 дней/)).toBeDefined();
  });

  it("падение показывает падением", () => {
    // Средний чек просел со 125 до 120 — при растущей выручке это и есть то,
    // ради чего сравнение вводилось.
    поднять();
    expect(screen.getByText("-4.0%")).toBeDefined();
  });

  it("без прошлого периода не рисует ноль процентов", () => {
    поднять({ previous: { revenue: 0, orders: 0, avgOrder: null } });
    expect(screen.queryByText("0.0%"), "нарисован ложный ноль").toBeNull();
    expect(screen.getAllByText(/сравнить не с чем/).length).toBeGreaterThan(0);
  });

  it("подписи периода не расходятся с числом", () => {
    // getDashboardSummary период не принимает и всегда считает за 30 дней.
    // Раньше его число подписывалось выбранным периодом: «ЗАКАЗЫ 7д» над
    // месячным значением.
    поднять({ days: 7, totals: { revenue: 5, orders: 1, avgOrder: 5 } });
    expect(screen.getByText(/Заказов за 30 дней/), "месячное число подписано месяцем").toBeDefined();
    expect(screen.getByText(/ВЫРУЧКА · за 7 дней/), "периодное число подписано периодом").toBeDefined();
  });

  it("долг не сравнивает с прошлым периодом — это остаток, а не поток", () => {
    поднять();
    expect(screen.getByText(/остаток на сейчас/)).toBeDefined();
  });

  it("отвечает на «где деньги зависли»", () => {
    поднять();
    expect(screen.getByText("Больше всех должны")).toBeDefined();
    expect(screen.getByText("Хумо")).toBeDefined();
  });
});

describe("отказ не выглядит как пустота", () => {
  const summary = {
    totalAgents: 0, activeNow: 0, visitsToday: 0,
    ordersMonth: 0, avgOrdersPerAgent: 0, revenueMonth: 0,
  };

  it("упавший запрос товаров говорит о себе, а не пишет «продаж не было»", () => {
    const retry = vi.fn();
    render(
      <OverviewTab
        summary={summary} summaryLoading={false} chart={[]} plans={[]}
        topProducts={undefined} topShops={[]} topAgents={[]}
        days={30} fmt={fmt} t={t}
        errors={{ products: { onRetry: retry } }}
      />,
    );

    expect(screen.getAllByRole("alert").length, "отказ не показан").toBeGreaterThan(0);
    // Магазины приехали пустыми — там «продаж не было» уместно. У товаров,
    // которые не приехали вовсе, такой строки быть не должно.
    expect(screen.getAllByText("За период продаж не было"), "отказ выдан за пустоту").toHaveLength(1);
  });

  it("даёт повторить именно упавший запрос", () => {
    const retry = vi.fn();
    render(
      <OverviewTab
        summary={summary} summaryLoading={false} chart={[]} plans={[]}
        topProducts={[]} topShops={[]} topAgents={[]}
        days={30} fmt={fmt} t={t}
        errors={{ debt: { onRetry: retry } }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Повторить/ }));
    expect(retry).toHaveBeenCalledTimes(1);
  });
});

describe("«Агенты» отвечают, кто просел", () => {
  const agents: AgentRow[] = [
    { agentId: 1, agentName: "Азиз", orders: 10, revenue: 1000, avgOrderValue: 100, prevRevenue: 2000 },
    { agentId: 2, agentName: "Бобур", orders: 2, revenue: 600, avgOrderValue: 300, prevRevenue: 300 },
    { agentId: 3, agentName: "Вали", orders: 1, revenue: 100, avgOrderValue: 100, prevRevenue: null },
  ];

  function поднять(over: Partial<Parameters<typeof AgentsTab>[0]> = {}) {
    return render(
      <AgentsTab agents={agents} days={30} fmt={fmt} t={t}
        onExport={() => {}} onExportPDF={() => {}} {...over} />,
    );
  }

  it("лидер по выручке может быть тем, кто просел вдвое", () => {
    поднять();
    const азиз = screen.getByText("Азиз").closest("tr")!;
    // Первое место по деньгам и −50 % к прошлому периоду одновременно. На
    // пьедестале с медалью этого было не видно вовсе.
    expect(within(азиз).getByText("1")).toBeDefined();
    expect(within(азиз).getByText("-50%")).toBeDefined();
  });

  it("новому агенту ставит прочерк, а не «минус сто процентов»", () => {
    поднять();
    const вали = screen.getByText("Вали").closest("tr")!;
    expect(within(вали).getByText("—")).toBeDefined();
  });

  it("сортируется по любому столбцу, а не только по выручке", () => {
    поднять();
    fireEvent.click(screen.getByRole("button", { name: /Средний чек/ }));
    const первый = screen.getAllByRole("row")[1];
    // По среднему чеку впереди Бобур с 300, хотя денег он принёс меньше.
    expect(within(первый).getByText("Бобур")).toBeDefined();
  });

  it("пустой список объясняет, что это пустота, а отказ — что это отказ", () => {
    const { unmount } = поднять({ agents: [] });
    expect(screen.getByText("За период агенты не продавали")).toBeDefined();
    unmount();

    поднять({ agents: undefined, isError: true, onRetry: () => {} });
    expect(screen.getByRole("alert")).toBeDefined();
    expect(screen.queryByText("За период агенты не продавали")).toBeNull();
  });
});

/**
 * Файл, который уносят наружу, не должен содержать слов из базы.
 *
 * Разбор для движений товара уже вынесен в lib/stock-movement-text.ts, но
 * реестр отчётов держал ЧЕТВЁРТУЮ копию — со своим словарём типов и
 * значениями referenceType, referenceId и notes как есть.
 */
describe("выгрузки читаемы", () => {
  const source = readFileSync(resolve(__dirname, "report-registry.ts"), "utf8");

  /** Часть записей ждёт обёртку ({ data } у постраничных, { trend } у P&L). */
  function probe(def: ReportDef, row: Record<string, unknown>): Row | undefined {
    const asList = def.toRows([row]);
    return (asList.length ? asList : def.toRows({ data: [row], trend: [row] }))[0];
  }

  it("движения склада названы словами, а не значениями колонок", () => {
    const def = REPORTS.find(r => r.id === "stock-movements")!;
    const row = probe(def, {
      type: "out",
      referenceType: "manual_adjustment",
      referenceId: null,
      notes: "Заказ: new → delivered",
      quantity: "5",
    })!;

    expect(row["Вид"]).toBe("Расход");
    // Ручная правка — событие без документа, номера у него нет и быть не
    // может. Печаталось «manual_adjustment #null».
    expect(row["Документ"]).toBe("Ручная правка");
    expect(row["Примечание"]).toBe("Заказ: Новый → Доставлен");
    expect(JSON.stringify(row)).not.toMatch(/manual_adjustment|#null|new|delivered/);
  });

  it("состояния записей переведены на человеческий", () => {
    const по = (id: string, row: Record<string, unknown>) => probe(REPORTS.find(r => r.id === id)!, row)!;
    expect(по("shops-directory", { status: "active" })["Статус"]).toBe("Работает");
    expect(по("staff", { status: "inactive" })["Статус"]).toBe("Не работает");
    expect(по("arrivals", { status: "unloading" })["Статус"]).toBe("Разгружается");
  });

  it("ни одна запись не печатает состояние или основание как есть", () => {
    // Правило, а не разметка: следующий отчёт со «Статусом» через String()
    // повторит ровно ту же ошибку, и поймать это лучше здесь, чем в переписке
    // с владельцем.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code, "статус уходит в файл значением из базы").not.toMatch(/"Статус":\s*String\(/);

    // Заметка и основание — только у движений склада: там сервер пишет в них
    // коды состояний заказа. Заметку визита человек набирает руками, её
    // разбирать нечего, поэтому проверяется именно эта запись, а не файл.
    const movements = code.slice(code.indexOf('id: "stock-movements"'));
    expect(movements, "основание движения уходит кодом").not.toMatch(/String\(r\.referenceType/);
    expect(movements, "заметка уходит без разбора состояний").not.toMatch(/String\(r\.notes/);
  });

  it("ни в одном отчёте не появляется «null» и «undefined»", () => {
    for (const def of REPORTS) {
      const row = probe(def, {});
      if (!row) continue;
      for (const [column, value] of Object.entries(row)) {
        expect(String(value), `${def.id}, колонка «${column}»`).not.toMatch(/null|undefined|NaN/);
      }
    }
  });
});

describe("карточка обещает то, что окажется в файле", () => {
  it("каждая карточка знает свои колонки", () => {
    for (const def of REPORTS) {
      // Пустой список означал бы, что toRows не пережил пробную строку и
      // карточка молча перестала объяснять, что она выгружает.
      expect(reportColumns(def), `${def.id}: колонок не видно`).not.toHaveLength(0);
    }
  });

  it("колонки взяты из того же toRows, что строит файл", () => {
    const def = REPORTS.find(r => r.id === "sales-by-product")!;
    const columns = reportColumns(def);
    const file = def.toRows([{ productName: "Сахар", totalQty: "3", totalRevenue: "90" }]);
    expect(columns).toEqual(Object.keys(file[0]));
  });
});
