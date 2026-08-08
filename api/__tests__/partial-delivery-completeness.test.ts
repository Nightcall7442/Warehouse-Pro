import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assertDeliveryCoversAllLines } from "../services/order";

/**
 * Частичная доставка обязана перечислять все позиции заказа.
 *
 * Непереданная позиция исчезала дважды. Из денег: сумма заказа пересобиралась
 * из присланных строк и записывалась в orders.total, поэтому заказ из двух
 * позиций по 10 000, проведённый по одной, становился заказом на 8 000 —
 * магазин недоплачивал 10 000. Из склада: резерв освобождался только по
 * присланным позициям, а заказ получал статус delivered, после которого ни
 * отмена, ни удаление уже неприменимы — товар оставался заперт навсегда.
 *
 * Правило проверяется само по себе, отдельно от блокировок и сырого SQL вокруг
 * него: иначе проверялась бы поддельная база, а не правило.
 */

const lines = (...ids: number[]) => ids;
const sent = (...ids: number[]) => ids.map(itemId => ({ itemId }));

describe("полнота позиций в частичной доставке", () => {
  it("пропущенная позиция отвергается, и в сообщении есть числа", () => {
    // Ровно тот случай, что стоил бы магазину 10 000: две позиции, проведена
    // одна.
    try {
      assertDeliveryCoversAllLines(lines(11, 22), sent(11));
      throw new Error("проверка не сработала — доставка прошла бы без второй позиции");
    } catch (e) {
      const message = (e as Error).message;
      expect(message).toContain("не хватает 1 из 2");
      // Оператору должно быть понятно, что делать: перечислить все позиции,
      // включая доставленные полностью.
      expect(message).toMatch(/доставлены полностью/);
    }
  });

  it("полный список проходит", () => {
    expect(() => assertDeliveryCoversAllLines(lines(11, 22), sent(11, 22))).not.toThrow();
  });

  it("порядок позиций значения не имеет", () => {
    // Клиент собирает список из своего состояния и не обязан хранить порядок
    // строк заказа.
    expect(() => assertDeliveryCoversAllLines(lines(11, 22, 33), sent(33, 11, 22))).not.toThrow();
  });

  it("повтор одной позиции отвергается", () => {
    // Иначе одна строка обработалась бы дважды: остаток списался бы дважды, а
    // её стоимость дважды вошла бы в сумму заказа.
    expect(() => assertDeliveryCoversAllLines(lines(11, 22), sent(11, 11, 22)))
      .toThrow(/#11 передана в запросе дважды/);
  });

  it("чужая позиция отвергается до первой записи", () => {
    expect(() => assertDeliveryCoversAllLines(lines(11, 22), sent(11, 22, 99)))
      .toThrow(/#99 не относится к этому заказу/);
  });

  it("подмена одной позиции на чужую не проходит как полный список", () => {
    // Совпадение по количеству — самая опасная ошибка: длина списка сходится,
    // а позиция 22 остаётся необработанной.
    expect(() => assertDeliveryCoversAllLines(lines(11, 22), sent(11, 99)))
      .toThrow(/#99 не относится к этому заказу/);
  });

  it("заказ без позиций не требует ничего", () => {
    expect(() => assertDeliveryCoversAllLines(lines(), sent())).not.toThrow();
  });

  it("ошибка видна оператору, а не подменяется на «внутреннюю»", () => {
    // Обычный throw new Error tRPC считает внутренним сбоем и в проде заменяет
    // текст на «Внутренняя ошибка сервера». Тогда оператор видит одно и то же
    // непонятное сообщение и повторяет то же действие — поправимая ситуация
    // превращается в тупик.
    try {
      assertDeliveryCoversAllLines(lines(1, 2), sent(1));
      throw new Error("не бросило");
    } catch (e) {
      expect((e as { code?: string }).code).toBe("BAD_REQUEST");
    }
  });
});

describe("правило подключено к самой доставке", () => {
  it("проверка стоит до первой записи в базу", () => {
    const src = readFileSync(join(process.cwd(), "api", "services", "order.ts"), "utf8");
    const fn = src.slice(src.indexOf("async function applyPartialDelivery"));
    const body = fn.slice(0, fn.indexOf("\n}\n"));

    const guardAt = body.indexOf("assertDeliveryCoversAllLines(");
    const firstWriteAt = body.indexOf("tx.update(orderItems)");

    expect(guardAt, "applyPartialDelivery не проверяет полноту позиций вовсе").toBeGreaterThan(-1);
    expect(firstWriteAt, "не найдена первая запись в базу — тест устарел").toBeGreaterThan(-1);
    // Проверка после первой записи оставила бы половину заказа проведённой при
    // отказе, и целостность зависела бы от того, что транзакция откатится.
    expect(guardAt, "проверка полноты стоит ПОСЛЕ первой записи в базу").toBeLessThan(firstWriteAt);
  });
});
