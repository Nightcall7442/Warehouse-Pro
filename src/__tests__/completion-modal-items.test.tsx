// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { LangProvider } from "@/i18n";
import { CompletionFlowModal } from "@/components/orders/CompletionFlowModal";

/**
 * Окно завершения заказа должно отправлять позиции заказа.
 *
 * ── Что ломалось ────────────────────────────────────────────────────────────
 *
 * Сброс полей окна переписали с эффекта на условие прямо в отрисовке:
 *
 *     const resetKey = open ? itemsKey : null;
 *     const [lastResetKey, setLastResetKey] = useState(resetKey);   // ← вот тут
 *     if (lastResetKey !== resetKey) { ...заполнить позиции... }
 *
 * useState(resetKey) запоминает ТЕКУЩЕЕ значение при первой отрисовке.
 * Поэтому если окно появляется сразу открытым и сразу с позициями — а на
 * странице «Заказы» именно так: разметка окна стоит под условием
 * `{completionOrderData && …}`, то есть до прихода данных его в дереве нет
 * вовсе, — то на первой же отрисовке lastResetKey уже равен resetKey.
 * Условие не срабатывает, позиции не заполняются, и в запрос уходит пустой
 * список.
 *
 * Сервер отвечает отказом проверки: deliveredItems должен содержать хотя бы
 * одну позицию. Для человека это выглядит так: заказ на экране, товары
 * перечислены, сумма верная — и «ошибка» на кнопке.
 *
 * Молчаливость здесь полная: разметка правильная, типы сходятся, товары в
 * окне видны (они рисуются из props, а не из состояния). Не совпадает только
 * то, что уходит на сервер.
 *
 * ── Почему проверка именно такая ────────────────────────────────────────────
 *
 * Окно монтируется СРАЗУ открытым и с позициями — это воспроизводит порядок
 * со страницы «Заказы». Проверяется не разметка, а то, что получает onSave:
 * именно этот список уходит в запрос.
 */

const ITEMS = [
  { id: 2624, productName: "Buchinger 1,5 L", quantity: 2, unitPrice: "130000.00", subtotal: "260000.00", deliveredQuantity: null, returnReason: null },
  { id: 2625, productName: "TOSHKENT suv", quantity: 2, unitPrice: "59500.00", subtotal: "119000.00", deliveredQuantity: null, returnReason: null },
];

function open(onSave: (d: unknown) => void, mode: "partial_payment" | "combined" = "partial_payment") {
  return render(
    <LangProvider>
      <CompletionFlowModal
        open
        onClose={() => {}}
        mode={mode}
        orderNumber="№1165"
        orderTotal="379000.00"
        items={ITEMS}
        currency="сум"
        saving={false}
        onSave={onSave}
      />
    </LangProvider>,
  );
}

afterEach(cleanup);

describe("окно завершения заказа", () => {
  it("отправляет все позиции, когда открывается сразу с ними", () => {
    const onSave = vi.fn();
    open(onSave);

    fireEvent.change(screen.getByLabelText(/Сумма оплаты|To'lov summasi/), { target: { value: "300000" } });
    fireEvent.click(screen.getByRole("button", { name: /Сохранить|Saqlash|Завершить|Tugatish/ }));

    expect(onSave, "onSave не вызван — окно отказало ещё на своей проверке").toHaveBeenCalledTimes(1);
    const sent = onSave.mock.calls[0][0] as { items: Array<{ itemId: number; deliveredQuantity: number }> };

    // Главное: список не пустой. Пустой уходил на сервер и возвращался
    // отказом «deliveredItems должен содержать хотя бы одну позицию».
    expect(sent.items, "в запрос ушёл пустой список позиций").toHaveLength(ITEMS.length);
    expect(sent.items.map(i => i.itemId).sort()).toEqual([2624, 2625]);
    // Возвратов не отмечали — значит доставлено всё заказанное.
    expect(sent.items.every(i => i.deliveredQuantity === 2)).toBe(true);
  });

  it("сумма оплаты доходит до onSave", () => {
    const onSave = vi.fn();
    open(onSave);
    fireEvent.change(screen.getByLabelText(/Сумма оплаты|To'lov summasi/), { target: { value: "300000" } });
    fireEvent.click(screen.getByRole("button", { name: /Сохранить|Saqlash|Завершить|Tugatish/ }));
    expect((onSave.mock.calls[0][0] as { paidAmount?: string }).paidAmount).toBe("300000");
  });

  /*
    «Полностью» и «Ничего» у поля суммы.

    Сумму набирали руками при каждом завершении, а она почти всегда одна из
    двух. «Полностью» — итог за вычетом вернувшегося товара: с полным итогом
    при частичном возврате поле уходило бы за проверку «не больше суммы».
  */
  it("«Ничего» ставит 0, «Полностью» — итог заказа", () => {
    const onSave = vi.fn();
    open(onSave);
    const поле = screen.getByLabelText(/Сумма оплаты|To'lov summasi/) as HTMLInputElement;

    fireEvent.click(screen.getByRole("button", { name: /^Ничего$|^Hech narsa$/ }));
    expect(поле.value).toBe("0");

    fireEvent.click(screen.getByRole("button", { name: /^Полностью$|^To'liq$/ }));
    expect(поле.value).toBe("379000");

    fireEvent.click(screen.getByRole("button", { name: /Завершить|Tugatish/ }));
    expect((onSave.mock.calls[0][0] as { paidAmount?: string; debtAmount?: string }).paidAmount).toBe("379000");
    expect((onSave.mock.calls[0][0] as { debtAmount?: string }).debtAmount).toBe("0");
  });

  it("«Полностью» вычитает вернувшийся товар", () => {
    const onSave = vi.fn();
    open(onSave, "combined");
    // Первая позиция вернулась целиком: 2 × 130 000.
    fireEvent.click(screen.getAllByRole("button", { name: /^Оставил$|^Oldi$/ })[0]);
    fireEvent.click(screen.getByRole("button", { name: /^Полностью$|^To'liq$/ }));

    const поле = screen.getByLabelText(/Сумма оплаты|To'lov summasi/) as HTMLInputElement;
    expect(поле.value, "в поле ушёл итог с возвращённым товаром").toBe("119000");
  });
});
