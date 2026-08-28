/**
 * Форма редактирования заказа: скидка и полнота отправки.
 *
 * Два бага, найденных проверкой интерфейса, оба денежные и оба молчаливые:
 *
 *   1. В поле «Скидка (%)» подставлялась сумма в сумах. Заказ со скидкой
 *      5000 сум становился нередактируемым целиком, а заказ со скидкой
 *      50 сум при сохранении превращался в скидку 50% — сервер резал его
 *      вдвое и отвечал зелёным «Заказ обновлён».
 *   2. Способ оплаты выбирался, но в запрос не попадал. Человек менял
 *      «Наличные» на «Долг», видел успех — и оплата оставалась прежней.
 *
 * Первое проверяется по-настоящему: пересчёт вынесен в чистую функцию.
 * Второе — разбором исходника: собрать форму целиком в тесте значило бы
 * поднимать роутер, tRPC и тему ради одной строки, а сам вопрос — «отправляем
 * ли то, что человек правит» — виден в коде прямо.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { discountMoneyToPct } from "../lib/order-discount";

describe("скидка: деньги в базе, проценты в форме", () => {
  it("обычный случай: 5000 из 50000 — это 10%", () => {
    expect(discountMoneyToPct({ discount: "5000.00", subtotal: "50000.00" })).toBe(10);
  });

  it("та самая скидка, которая запирала заказ", () => {
    // Раньше в поле уезжало 5000, проверка «от 0 до 100» не пускала, и заказ
    // нельзя было отредактировать вообще — включая примечание и оплату.
    const pct = discountMoneyToPct({ discount: "5000.00", subtotal: "50000.00" });
    expect(pct).toBeLessThanOrEqual(100);
    expect(pct).toBeGreaterThan(0);
  });

  it("та самая скидка, которая резала заказ вдвое", () => {
    // Скидка 50 сум на заказ в 200 000 — это 0.03%, а не 50%.
    expect(discountMoneyToPct({ discount: "50.00", subtotal: "200000.00" })).toBe(0.03);
  });

  it("округляется до двух знаков — столько принимает поле", () => {
    expect(discountMoneyToPct({ discount: 1, subtotal: 3 })).toBe(33.33);
  });

  it("заказ без суммы не даёт ни NaN, ни бесконечности", () => {
    expect(discountMoneyToPct({ discount: "100.00", subtotal: "0.00" })).toBe(0);
    expect(discountMoneyToPct({ discount: "100.00", subtotal: null })).toBe(0);
    expect(discountMoneyToPct({})).toBe(0);
  });

  it("мусор вместо чисел не превращается в скидку", () => {
    expect(discountMoneyToPct({ discount: "abc", subtotal: "50000" })).toBe(0);
    expect(discountMoneyToPct({ discount: "-500", subtotal: "50000" })).toBe(0);
  });

  it("скидка во всю сумму — это сто процентов, а не больше", () => {
    expect(discountMoneyToPct({ discount: "50000", subtotal: "50000" })).toBe(100);
  });
});

describe("форма отправляет всё, что в ней правят", () => {
  const src = fs.readFileSync(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../pages/OrderDetail.tsx"),
    "utf8",
  );

  /**
   * Тело запроса, и только оно.
   *
   * Первая версия этой проверки резала полторы тысячи знаков от «const
   * saveEditing» и искала имя поля где угодно внутри. Она проходила и с
   * ВЫРЕЗАННЫМ paymentMethod: имя оставалось в списке зависимостей
   * useCallback пятью строками ниже. То есть проверка ловила не отправку, а
   * упоминание, и от возврата бага не защищала совсем — поймал это только
   * прогон с намеренно сломанным кодом.
   *
   * Теперь берётся ровно объект, который уходит на сервер: от «mutate({» до
   * парной закрывающей скобки.
   */
  function mutatePayload(): string {
    const start = src.indexOf("updateOrder.mutate({");
    if (start < 0) throw new Error("вызов updateOrder.mutate не найден");
    let depth = 0;
    for (let i = src.indexOf("{", start); i < src.length; i++) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}") {
        depth--;
        if (depth === 0) return src.slice(start, i + 1);
      }
    }
    throw new Error("не закрылась скобка объекта запроса");
  }

  const payload = mutatePayload();

  it.each([
    ["editNotes", "примечание"],
    ["editDiscount", "скидка"],
    ["editPaymentMethod", "способ оплаты"],
  ])("%s (%s) уходит на сервер", (field) => {
    expect(
      payload.includes(field),
      `Поле ${field} есть в форме, но в теле updateOrder.mutate его нет. ` +
        "Человек его правит, видит зелёное «Заказ обновлён» — и ничего не меняется. " +
        "Ровно так молчал способ оплаты.",
    ).toBe(true);
  });

  it("скидку можно снять, а не только изменить", () => {
    // Стояло `discount: editDiscount !== "0" ? editDiscount : undefined`, а
    // сервер неопределённое поле пропускает мимо: ноль в поле не снимал
    // скидку.
    expect(
      /editDiscount\s*!==\s*"0"/.test(payload),
      "Вернулось условие, при котором ноль не отправляется — скидку снова нельзя снять.",
    ).toBe(false);
  });

  it("в поле подставляется процент, а не сумма из базы", () => {
    // Чистая функция проверена выше, но толку от неё нет, если форма её не
    // зовёт. Вырезанный вызов — это ровно исходный баг: в поле «Скидка (%)»
    // снова уезжают сумы.
    const start = src.indexOf("const startEditing");
    const startEditing = src.slice(start, src.indexOf("}, [", start));
    expect(
      startEditing.includes("discountMoneyToPct("),
      "startEditing перестал пересчитывать деньги в проценты. В базе скидка в " +
        "сумах, ручка принимает проценты: подставив сумму, форма либо запрёт " +
        "заказ проверкой «от 0 до 100», либо сохранит 50 сум как 50% и срежет " +
        "заказ вдвое.",
    ).toBe(true);
  });
});
