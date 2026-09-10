import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  linesFromOrder, linesToPayload, validateLines,
  type EditLine, type OrderLine,
} from "@/lib/order-item-edit";

/**
 * Правка состава заказа: строки экрана → запрос к серверу.
 *
 * ── Чем это опасно ──────────────────────────────────────────────────────────
 *
 * Сервер не знает, что строку выкинули. Он видит присланный список, а всё,
 * чего в нём нет, ОСТАВЛЯЕТ КАК БЫЛО (services/order.ts: «Lines the caller did
 * not mention stay as they are»). То есть просто не прислать строку — значит не
 * удалить её, а молча сохранить: товар остался бы в заказе, деньги в сумме, а
 * резерв на складе.
 *
 * Удаление выражается количеством ноль, и это единственное, что нельзя забыть.
 * Экранов, которые правят состав, теперь два — операторская панель и карточка
 * заказа, где это делает агент, — поэтому правило вынесено в один файл, а здесь
 * проверяется числами.
 */

const item = (id: number, productId: number, qty: number, price: number): OrderLine => ({
  id, productId, productName: `Товар ${productId}`, quantity: String(qty), unitPrice: String(price),
});

const line = (over: Partial<EditLine> & { productId: number }): EditLine => ({
  key: `k-${over.productId}`,
  productName: `Товар ${over.productId}`,
  quantity: "1",
  unitPrice: "1000",
  ...over,
});

describe("выброшенная строка удаляется, а не сохраняется молча", () => {
  it("убранная позиция уходит нулём", () => {
    const original = [item(1, 10, 3, 5000), item(2, 20, 2, 7000)];
    // Вторую строку выкинули из редактора.
    const edited = [line({ productId: 10, itemId: 1, quantity: "3", unitPrice: "5000" })];

    const payload = linesToPayload(original, edited);
    expect(payload).toContainEqual({ itemId: 2, quantity: 0 });
  });

  it("оставленная позиция нулём НЕ уходит", () => {
    /*
      Обратная ошибка того же рода: обнули мы всё подряд — с заказа исчезло бы
      то, что человек не трогал.
    */
    const original = [item(1, 10, 3, 5000), item(2, 20, 2, 7000)];
    const edited = linesFromOrder(original);

    const payload = linesToPayload(original, edited);
    expect(payload.filter(p => "quantity" in p && p.quantity === 0)).toEqual([]);
    expect(payload).toHaveLength(2);
  });

  it("убрали всё, кроме одной — нулей ровно столько, сколько выкинули", () => {
    const original = [item(1, 10, 1, 100), item(2, 20, 1, 100), item(3, 30, 1, 100)];
    const edited = [line({ productId: 20, itemId: 2 })];

    const payload = linesToPayload(original, edited);
    const zeros = payload.filter(p => p.quantity === 0).map(p => ("itemId" in p ? p.itemId : null));
    expect(zeros.sort()).toEqual([1, 3]);
  });
});

describe("добавленная строка приходит товаром, а не позицией", () => {
  it("у новой строки productId, у существующей itemId", () => {
    /*
      Сервер различает их именно так: itemId — правка существующей, productId —
      вставка новой. Перепутай — и он ответит «позиция заказа не найдена» на
      добавление товара.
    */
    const original = [item(1, 10, 2, 5000)];
    const edited = [
      line({ productId: 10, itemId: 1, quantity: "5", unitPrice: "5000" }),
      line({ productId: 99, quantity: "2", unitPrice: "3000" }),
    ];

    const payload = linesToPayload(original, edited);
    expect(payload).toContainEqual({ itemId: 1, quantity: 5, unitPrice: "5000" });
    expect(payload).toContainEqual({ productId: 99, quantity: 2, unitPrice: "3000" });
  });

  it("количество уходит числом, а не строкой", () => {
    // В редакторе оно строкой — иначе поле дёргает курсор при наборе. Сервер
    // ждёт число, и «2» строкой он не примет.
    const payload = linesToPayload([], [line({ productId: 7, quantity: "2" })]);
    expect(typeof payload[0].quantity).toBe("number");
  });
});

describe("что не отправляется вовсе", () => {
  it("пустой заказ", () => {
    expect(validateLines([])).toContain("хотя бы одна позиция");
  });

  it("нулевое и отрицательное количество", () => {
    expect(validateLines([line({ productId: 1, quantity: "0" })])).toContain("больше нуля");
    expect(validateLines([line({ productId: 1, quantity: "-3" })])).toContain("больше нуля");
  });

  it("отрицательная цена", () => {
    expect(validateLines([line({ productId: 1, unitPrice: "-5" })])).toContain("отрицательной");
  });

  it("тот же товар второй строкой", () => {
    /*
      Сервер такую пару отвергает: резерв по заказу собирается одним UPDATE с
      `CASE WHEN product_id = ...`, и MySQL берёт первый совпавший — вторая
      строка молча не резервировалась бы. С миграции 0043 это же запрещает
      уникальный индекс.
    */
    const twice = [
      line({ productId: 42, key: "a" }),
      line({ productId: 42, key: "b" }),
    ];
    expect(validateLines(twice)).toContain("Один товар — одна строка");
  });

  it("исправное — пропускает", () => {
    expect(validateLines([line({ productId: 1, quantity: "2", unitPrice: "1000" })])).toBeNull();
  });
});

describe("оба экрана правят состав одним правилом", () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");

  it("ни один не собирает запрос сам", () => {
    /*
      Главное здесь. Пока сборка стояла на месте, забыть нули в одной из копий
      было вопросом времени — а цена ошибки: товар, молча оставшийся в заказе
      вместе с резервом на складе.
    */
    for (const f of [
      "src/components/orders/OrderSlideOver.tsx",
      "src/components/orders/OrderItemsEditor.tsx",
    ]) {
      const src = read(f);
      expect(src, `${f}: запрос собирается на месте`).toContain("linesToPayload(");
      expect(src, `${f}: вернулась своя сборка убранных строк`)
        .not.toMatch(/\.map\(o => \(\{ itemId: o\.id, quantity: 0 \}\)\)/);
    }
  });
});
