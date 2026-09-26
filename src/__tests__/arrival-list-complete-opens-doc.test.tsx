// @vitest-environment jsdom
/**
 * «Завершить» в списке приходов открывает документ, а не проводит вслепую.
 *
 * Было: кнопка в строке одним нажатием слала update({status: "completed"}) —
 * без подтверждения и без слова о том, что строки по накладной не посчитаны.
 * Проведённый приход уже не правится, так что пустой документ оставался
 * навсегда. Сверка («N строк не посчитано») и подтверждение живут в
 * документе (ArrivalEditor), туда кнопка и ведёт.
 *
 * Нарочная поломка: верни в onClick `updateStatus.mutate({ id: a.id,
 * status: "completed" })` — падает первый тест.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LangProvider } from "@/i18n";

const navigated: string[] = [];
const mutated: unknown[] = [];

vi.mock("react-router", () => ({ useNavigate: () => (to: string) => navigated.push(to) }));
vi.mock("@/hooks/useScrollTopOnChange", () => ({ useScrollTopOnChange: () => {} }));
vi.mock("@/hooks/useUrlState", () => ({ useUrlState: () => ["arrivals", () => {}], urlEnum: () => ({}) }));
vi.mock("@/hooks/useCurrency", () => ({ useCurrency: () => ({ fmt: (v: unknown) => `${Number(v)} сум` }) }));
vi.mock("@/components/counterparties", () => ({ CounterpartiesSection: () => null }));
vi.mock("@/lib/excel", () => ({ exportToExcel: vi.fn(), formatArrivalsForExport: () => [] }));
vi.mock("@/lib/toast", () => ({ notify: { success: vi.fn(), error: vi.fn() } }));

const row = (id: number, status: string) => ({
  id, status, arrivalNumber: `ARR-${id}`, arrivalDate: new Date("2026-09-24"), truckId: null,
  supplierName: "Завод", supplyAmount: "1000", supplyPaid: "0", supplyDebt: "1000", supplyCurrency: "UZS", totalExpense: "0",
});
vi.mock("@/providers/trpc", () => {
  const list = { data: [row(5, "unloading"), row(6, "pending")], total: 2 };
  const mutation = () => ({ mutate: (v: unknown) => mutated.push(v), isPending: false });
  return {
    trpc: {
      useUtils: () => ({ arrival: { list: { invalidate: () => {} } } }),
      arrival: {
        list: { useQuery: () => ({ data: list, isLoading: false, isLoadingError: false, refetch: () => {} }) },
        update: { useMutation: mutation },
        delete: { useMutation: mutation },
      },
    },
  };
});

const { default: Arrivals } = await import("@/pages/Arrivals");

beforeEach(() => { cleanup(); navigated.length = 0; mutated.length = 0; });

describe("список приходов: «Завершить»", () => {
  it("открывает документ и ничего не проводит", () => {
    render(<LangProvider><Arrivals /></LangProvider>);
    const btn = screen.getByTestId("arrivals-complete-5");
    expect(btn.textContent).toBe("Завершить");
    fireEvent.click(btn);
    expect(navigated).toEqual(["/arrivals/5"]);
    expect(mutated, "список провёл приход вслепую").toEqual([]);
  });

  it("у ожидающего — только «Разгрузка», и она по-прежнему меняет статус", () => {
    render(<LangProvider><Arrivals /></LangProvider>);
    expect(screen.queryByTestId("arrivals-complete-6")).toBeNull();
    fireEvent.click(screen.getByText("Разгрузка", { selector: "button" }));
    expect(mutated).toEqual([{ id: 6, status: "unloading" }]);
  });

  it("в списке нет ни одного пути, шлющего status: completed", () => {
    const src = readFileSync(join(process.cwd(), "src/pages/Arrivals.tsx"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");
    expect(src).not.toMatch(/status:\s*"completed"/);
    expect(src).toContain('t("Завершить", "Yakunlash")');
  });
});
