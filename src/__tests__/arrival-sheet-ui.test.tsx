// @vitest-environment jsdom
/**
 * Лист прихода и выбор товаров пачкой — в браузере.
 *
 *   · число в «Пришло» уходит в строку; Enter переводит на ту же ячейку ниже;
 *   · столбец из Excel вставляется в несколько строк разом;
 *   · упаковки пересчитываются в штуки; разница с накладной подсвечена;
 *   · завершённый приход — без полей и без удаления строк;
 *   · выбор: поиск, «отметить все найденные», уже стоящие не выбираются,
 *     «Добавить N» отдаёт ровно отмеченные.
 *
 * Нарочная поломка: убери onKeyDown у ячейки — падает «Enter — вниз».
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { LangProvider } from "@/i18n";

vi.mock("@/hooks/useCurrency", () => ({ useCurrency: () => ({ fmt: (v: unknown) => `${Number(v)} сум`, symbol: "сум", currency: "UZS" }) }));
const { ArrivalSheet } = await import("@/components/arrivals/ArrivalSheet");
const { ProductMultiPicker } = await import("@/components/arrivals/ProductMultiPicker");
const { rowFromProduct } = await import("@/lib/arrival-sheet");
type Row = ReturnType<typeof rowFromProduct>;

afterEach(cleanup);

const juice = { id: 1, name: "Сок", code: "S-1", packSize: "12", costPrice: "9000", unitPrice: "12000" };
const water = { id: 2, name: "Вода", code: "W-1", costPrice: "2000", unitPrice: "3000" };
const cola = { id: 3, name: "Кола", code: "K-1", costPrice: "5000", unitPrice: "7000" };

function Sheet({ initial, readOnly, spy }: { initial: Row[]; readOnly?: boolean; spy?: (r: Row[]) => void }) {
  const [rows, setRows] = useState(initial);
  return <LangProvider><ArrivalSheet rows={rows} readOnly={readOnly} arrivalDate="2026-09-24" onChange={r => { setRows(r); spy?.(r); }} /></LangProvider>;
}
const cellOf = (id: string) => screen.getByTestId(id) as HTMLInputElement;

describe("лист прихода", () => {
  it("число в «Пришло» — в строку; разница с накладной подсвечена", () => {
    const spy = vi.fn();
    render(<Sheet initial={[{ ...rowFromProduct(juice), expected: "24" }, rowFromProduct(water)]} spy={spy} />);
    fireEvent.change(cellOf("arrival-cell-quantity-0"), { target: { value: "22" } });
    expect(spy.mock.calls.at(-1)![0][0].quantity).toBe("22");
    expect(screen.getByTestId("arrival-diff-0").textContent).toBe("-2");
  });

  it("Enter — вниз по столбцу", () => {
    render(<Sheet initial={[rowFromProduct(juice), rowFromProduct(water)]} />);
    const first = cellOf("arrival-cell-quantity-0");
    first.focus();
    fireEvent.keyDown(first, { key: "Enter" });
    expect(document.activeElement).toBe(cellOf("arrival-cell-quantity-1"));
  });

  it("столбец из Excel — в несколько строк разом", () => {
    const spy = vi.fn();
    render(<Sheet initial={[rowFromProduct(juice), rowFromProduct(water), rowFromProduct(cola)]} spy={spy} />);
    fireEvent.paste(cellOf("arrival-cell-quantity-1"), { clipboardData: { getData: () => "5\n6\n" } });
    expect(spy.mock.calls.at(-1)![0].map((r: Row) => r.quantity)).toEqual(["", "5", "6"]);
  });

  it("упаковки → штуки", () => {
    const spy = vi.fn();
    render(<Sheet initial={[rowFromProduct(juice)]} spy={spy} />);
    fireEvent.change(cellOf("arrival-cell-boxes-0"), { target: { value: "2" } });
    expect(spy.mock.calls.at(-1)![0][0].quantity).toBe("24");
  });

  it("завершённый приход — без полей и без удаления строк", () => {
    const { container } = render(<Sheet readOnly initial={[{ ...rowFromProduct(juice), quantity: "10" }]} />);
    expect(container.querySelectorAll("input").length).toBe(0);
    expect(screen.queryByTestId("arrival-remove-0")).toBeNull();
    expect(screen.getByTestId("arrival-row-0").textContent).toContain("10");
  });

  it("строку можно убрать", () => {
    const spy = vi.fn();
    render(<Sheet initial={[rowFromProduct(juice), rowFromProduct(water)]} spy={spy} />);
    fireEvent.click(screen.getByTestId("arrival-remove-0"));
    expect(spy.mock.calls.at(-1)![0].map((r: Row) => r.productId)).toEqual([2]);
  });
});

describe("выбор товаров пачкой", () => {
  const show = (onPick = vi.fn()) => {
    render(<LangProvider><ProductMultiPicker open onClose={() => {}} products={[juice, water, cola]} already={new Set([2])} onPick={onPick} /></LangProvider>);
    return onPick;
  };

  it("уже стоящий в приходе не выбирается; «все найденные» и «Добавить» отдают ровно отмеченные", () => {
    const onPick = show();
    expect((screen.getByTestId("picker-item-2") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId("picker-all"));
    expect(screen.getByTestId("picker-count").textContent).toContain("2");
    fireEvent.click(screen.getByTestId("picker-add"));
    expect(onPick.mock.calls[0][0].map((p: { id: number }) => p.id)).toEqual([1, 3]);
  });

  it("поиск и Enter при единственной находке отмечают её", () => {
    const onPick = show();
    fireEvent.change(screen.getByTestId("picker-search"), { target: { value: "кол" } });
    expect(screen.queryByTestId("picker-item-1")).toBeNull();
    fireEvent.keyDown(screen.getByTestId("picker-search"), { key: "Enter" });
    fireEvent.click(screen.getByTestId("picker-add"));
    expect(onPick.mock.calls[0][0].map((p: { id: number }) => p.id)).toEqual([3]);
  });
});
