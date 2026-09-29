// @vitest-environment jsdom
/**
 * Плитки «Приходов» — из сводки сервера; выгрузка — по нажатию.
 *
 * Что было: «Всего приходов», «Расходы», «Завершены» и «Долг поставщикам»
 * складывались из 25 строк текущей страницы — долг поставщикам занижен и
 * меняется от листания. И каждое открытие страницы тянуло ВСЕ приходы (до
 * 5000 строк) ради одной кнопки «Excel».
 *
 * Что проверяется: плитки показывают summary из arrival.list, а не сумму
 * строк; долларовый долг — отдельной строкой; при открытии нет запроса на
 * 5000 строк, он уходит по нажатию «Excel» и попадает в файл.
 *
 * Нарочная поломка: верни подсчёт плиток по `arrivals` (строкам страницы) —
 * падает «плитки из сводки»; верни useQuery({ pageSize: 5000 }) — падает
 * «выгрузка по нажатию».
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { LangProvider } from "@/i18n";

const h = vi.hoisted(() => ({
  queries: [] as unknown[],
  fetched: [] as unknown[],
  exported: [] as unknown[],
}));

vi.mock("react-router", () => ({ useNavigate: () => () => {} }));
vi.mock("@/hooks/useScrollTopOnChange", () => ({ useScrollTopOnChange: () => {} }));
vi.mock("@/hooks/useUrlState", () => ({ useUrlState: () => ["arrivals", () => {}], urlEnum: () => ({}) }));
vi.mock("@/hooks/useCurrency", () => ({ useCurrency: () => ({ fmt: (v: unknown) => `${Number(v)} сум` }) }));
vi.mock("@/components/counterparties", () => ({ CounterpartiesSection: () => null }));
vi.mock("@/lib/excel", () => ({
  exportToExcel: vi.fn(async (rows: unknown) => { h.exported.push(rows); }),
  formatArrivalsForExport: (rows: unknown[]) => rows.map(r => (r as { arrivalNumber: string }).arrivalNumber),
}));
vi.mock("@/lib/toast", () => ({ notify: { success: vi.fn(), error: vi.fn() } }));

const row = (id: number) => ({
  id, status: "pending", arrivalNumber: `ARR-${id}`, arrivalDate: new Date("2026-09-24"), truckId: null,
  supplierName: "Завод", supplyAmount: 1000, supplyPaid: 0, supplyDebt: 1000, supplyCurrency: "UZS", totalExpense: "7",
});
vi.mock("@/providers/trpc", () => {
  // Страница — две строки; сводка — по всем тридцати приходам организации.
  const page = {
    data: [row(1), row(2)], total: 30, page: 1, pageSize: 25,
    summary: { total: 30, expenses: 4650, completed: 10, debtUzs: 123456, debtUsd: 600 },
  };
  const mutation = () => ({ mutate: () => {}, isPending: false });
  return {
    trpc: {
      useUtils: () => ({ arrival: { list: {
        invalidate: () => {},
        fetch: async (input: unknown) => { h.fetched.push(input); return { data: [row(1), row(2), row(3)], total: 3 }; },
      } } }),
      arrival: {
        list: { useQuery: (input: unknown) => { h.queries.push(input); return { data: page, isLoading: false, isLoadingError: false, refetch: () => {} }; } },
        update: { useMutation: mutation },
        delete: { useMutation: mutation },
      },
    },
  };
});

const { default: Arrivals } = await import("@/pages/Arrivals");

beforeEach(() => { cleanup(); h.queries.length = 0; h.fetched.length = 0; h.exported.length = 0; });

const tile = (label: string) => screen.getByText(label).closest(".kpi-hero")!.textContent ?? "";

describe("«Приходы»: плитки и выгрузка", () => {
  it("плитки из сводки сервера, а не из строк страницы", () => {
    render(<LangProvider><Arrivals /></LangProvider>);
    expect(tile("ВСЕГО ПРИХОДОВ")).toContain("30");
    expect(tile("РАСХОДЫ")).toContain("4650 сум");
    expect(tile("ЗАВЕРШЕНЫ")).toContain("10");
    const debt = tile("ДОЛГ ПОСТАВЩИКАМ");
    expect(debt, "долг сложен из строк страницы").toContain("123456 сум");
    expect(debt).not.toContain("2000 сум");
    // Доллары — своей строкой, а не прибавлены к сумам.
    expect(debt).toMatch(/600 USD/);
  });

  it("выгрузка по нажатию: при открытии нет запроса на все приходы", async () => {
    render(<LangProvider><Arrivals /></LangProvider>);
    expect(h.queries.some(q => (q as { pageSize?: number })?.pageSize === 5000), "страница при открытии тянет все приходы").toBe(false);

    fireEvent.click(screen.getByRole("button", { name: /Excel/ }));
    await waitFor(() => expect(h.exported).toHaveLength(1));
    expect(h.fetched).toEqual([{ page: 1, pageSize: 5000 }]);
    expect(h.exported[0]).toEqual(["ARR-1", "ARR-2", "ARR-3"]);
  });
});
