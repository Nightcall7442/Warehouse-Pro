// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { LangProvider } from "@/i18n";
import { BulkCompletionModal } from "@/components/orders/BulkCompletionModal";
import type { BulkEntry, BulkOrder } from "@/components/orders/BulkCompletionModal";

/**
 * Массовое завершение заказов.
 *
 * Проверяется не разметка, а то, что уходит в запрос: этот список пишет
 * деньги по десяткам заказов сразу, и отменить его нельзя. Ошибка здесь стоит
 * дороже обычной — она не падает, а тихо записывает не те суммы.
 *
 * Четыре вещи, каждая из которых ломается молча:
 *
 * 1. По умолчанию предлагается ОСТАТОК, а не полная сумма. Часть денег по
 *    заказу могла быть принята раньше; предложить взять её повторно значит
 *    удвоить выручку и обнулить долг, которого никто не гасил.
 * 2. Возврат уменьшает сумму заказа, а с ней и долг. Иначе магазин остаётся
 *    должен за товар, который вернул.
 * 3. В запрос уходят ВСЕ строки заказа, включая доставленные полностью:
 *    сервер отказывает, если хоть одна пропущена, — «не указана» одинаково
 *    читается и как «доставлена», и как «возвращена».
 * 4. Итог внизу совпадает с тем, что уходит на сервер. Он и есть то
 *    единственное, что человек видит перед нажатием.
 */

const ORDERS: BulkOrder[] = [
  {
    id: 1, orderNumber: "№101", shopName: "Первый", total: "300000.00",
    subtotal: "300000.00", discount: "0.00", alreadyPaid: "0.00", paymentMethod: "cash",
    items: [
      { id: 11, productName: "Товар А", quantity: "2", unitPrice: "100000.00", unit: "шт" },
      { id: 12, productName: "Товар Б", quantity: "1", unitPrice: "100000.00", unit: "шт" },
    ],
  },
  {
    id: 2, orderNumber: "№102", shopName: "Второй", total: "200000.00",
    subtotal: "200000.00", discount: "0.00", alreadyPaid: "50000.00", paymentMethod: "cash",
    items: [{ id: 21, productName: "Товар В", quantity: "4", unitPrice: "50000.00", unit: "шт" }],
  },
];

function open(onSave: (e: BulkEntry[]) => void) {
  return render(
    <LangProvider>
      <BulkCompletionModal open onClose={() => {}} orders={ORDERS} currency="сум" saving={false} onSave={onSave} />
    </LangProvider>,
  );
}

const payField = (orderNumber: string) => screen.getByLabelText(new RegExp(`Оплачено ${orderNumber}`));
const save = () => fireEvent.click(screen.getByRole("button", { name: /Записать/ }));

afterEach(cleanup);

describe("массовое завершение заказов", () => {
  it("по умолчанию предлагает остаток, а не полную сумму", () => {
    const onSave = vi.fn();
    open(onSave);
    // Первый заказ ничего не платил — остаток равен сумме.
    expect((payField("№101") as HTMLInputElement).value).toBe("300000");
    // По второму уже принято 50 000 из 200 000 — предлагается 150 000.
    expect((payField("№102") as HTMLInputElement).value).toBe("150000");
  });

  it("отправляет все строки каждого заказа", () => {
    const onSave = vi.fn();
    open(onSave);
    save();

    const entries = onSave.mock.calls[0][0] as BulkEntry[];
    expect(entries).toHaveLength(2);
    expect(entries[0].deliveredItems.map(i => i.itemId).sort()).toEqual([11, 12]);
    expect(entries[1].deliveredItems.map(i => i.itemId)).toEqual([21]);
    // Возвратов не отмечали — доставлено всё заказанное.
    expect(entries[0].deliveredItems).toEqual([
      { itemId: 11, deliveredQuantity: 2 },
      { itemId: 12, deliveredQuantity: 1 },
    ]);
  });

  it("частичная оплата уходит в запрос и видна в итоге", () => {
    const onSave = vi.fn();
    open(onSave);
    fireEvent.change(payField("№101"), { target: { value: "120000" } });

    // Итог «В долг» — 180 000: столько недоплачено по первому заказу.
    // По второму долга нет: там оставлен предложенный остаток целиком.
    //
    // Пробелы нормализуются: русский формат разделяет разряды НЕРАЗРЫВНЫМ
    // пробелом, и точное сравнение со строкой не сходится ни на глаз, ни в
    // выводе теста.
    const norm = (x: string) => x.replace(/\s+/g, " ").trim();
    expect(
      screen.getAllByText((_, el) => norm(el?.textContent ?? "") === "180 000 сум").length,
      "итог «В долг» не сошёлся",
    ).toBeGreaterThan(0);

    save();
    const entries = onSave.mock.calls[0][0] as BulkEntry[];
    expect(entries.find(e => e.orderId === 1)!.paidAmount).toBe("120000.00");
  });

  it("возврат уменьшает сумму заказа и долг", () => {
    const onSave = vi.fn();
    open(onSave);

    // Раскрыть первый заказ и вернуть одну штуку товара А (100 000).
    fireEvent.click(screen.getByRole("button", { expanded: false, name: /Первый/ }));
    fireEvent.change(screen.getByLabelText(/Вернули Товар А/), { target: { value: "1" } });

    save();
    const entries = onSave.mock.calls[0][0] as BulkEntry[];
    const first = entries.find(e => e.orderId === 1)!;
    expect(first.deliveredItems).toEqual([
      { itemId: 11, deliveredQuantity: 1 },
      { itemId: 12, deliveredQuantity: 1 },
    ]);
    // Поле оплаты осталось на 300 000, но заказ теперь стоит 200 000 —
    // больше суммы заказа принять нельзя, иначе сервер откажет.
    expect(Number(first.paidAmount)).toBeLessThanOrEqual(200000);
  });

  it("нулевая оплата допустима — весь заказ уходит в долг", () => {
    const onSave = vi.fn();
    open(onSave);
    fireEvent.change(payField("№101"), { target: { value: "0" } });
    save();
    const entries = onSave.mock.calls[0][0] as BulkEntry[];
    expect(entries.find(e => e.orderId === 1)!.paidAmount).toBe("0.00");
  });
});
