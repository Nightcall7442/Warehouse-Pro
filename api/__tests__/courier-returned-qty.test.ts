import { describe, it, expect } from "vitest";
import { z } from "zod";

/**
 * Курьер не должен уметь обнулить сумму заказа.
 *
 * В схеме completeDelivery поле returnedQty стояло как z.number() — без нижней
 * и без верхней границы, — а на сервере считалось `qty - returnedQty` без
 * единой проверки. Пробник аудита показал последствия на настоящей процедуре:
 *
 *   returnedQty=25 по строке из 10 и -3 по строке из 5
 *     → заказ на 1800 записан как 90, deliveredQuantity = -15,
 *       со склада списано 8 единиц при заказанных 5;
 *   returnedQty=25 по обеим строкам
 *     → subtotal '-5500.00', discount '-550.00'.
 *
 * Колонки DECIMAL(12,2) идут без unsigned, поэтому отрицательные значения
 * сохраняются молча и попадают в SUM(orders.discount) отчёта P&L. Роль курьера —
 * наименее доверенная в системе.
 *
 * Проверяются обе границы: нижняя схемой (её видно здесь), верхняя — сервером,
 * поскольку заказанное количество схеме неизвестно.
 */

// Ровно та схема, что стоит в api/courier-router.ts.
const returnedItemSchema = z.object({
  itemId: z.number(),
  returnedQty: z.number().min(0, "Возвращённое количество не может быть отрицательным"),
});

/** Серверная проверка из того же цикла completeDelivery. */
function deliveredQty(orderedQty: number, returnedQty: number): number {
  if (returnedQty > orderedQty) {
    throw new Error(`Возвращено больше, чем в заказе: ${returnedQty} из ${orderedQty}`);
  }
  return orderedQty - returnedQty;
}

describe("courier.completeDelivery: границы returnedQty", () => {
  it("отклоняет отрицательное возвращённое количество", () => {
    // Без .min(0) это давало доставку БОЛЬШЕ заказанного: 5 - (-3) = 8.
    const bad = returnedItemSchema.safeParse({ itemId: 1, returnedQty: -3 });
    expect(bad.success).toBe(false);

    const good = returnedItemSchema.safeParse({ itemId: 1, returnedQty: 0 });
    expect(good.success).toBe(true);
  });

  it("отклоняет возврат больше заказанного", () => {
    expect(() => deliveredQty(10, 25)).toThrow(/Возвращено больше/);
    expect(() => deliveredQty(5, 6)).toThrow(/Возвращено больше/);
  });

  it("пропускает обычный частичный возврат", () => {
    expect(deliveredQty(10, 4)).toBe(6);
    expect(deliveredQty(10, 0)).toBe(10);
    expect(deliveredQty(10, 10)).toBe(0);   // вернули всё — законно
  });

  it("сумма заказа больше не может уйти в минус", () => {
    // Пересчёт из completeDelivery: сумма по строкам с их ценами.
    const lines = [
      { qty: 10, price: 100 },
      { qty: 5,  price: 200 },
    ];
    const subtotalFor = (returned: number[]) =>
      lines.reduce((sum, l, i) => sum + l.price * deliveredQty(l.qty, returned[i]), 0);

    expect(subtotalFor([0, 0])).toBe(2000);
    expect(subtotalFor([10, 5])).toBe(0);          // всё вернули — ноль, но не минус
    expect(subtotalFor([4, 2])).toBe(600 + 600);

    // Прежние сценарии пробника теперь отвергаются, а не пишут минус.
    expect(() => subtotalFor([25, -3])).toThrow();
    expect(() => subtotalFor([25, 25])).toThrow();
  });

  // Проверки выше воспроизводят правила, а не импортируют их: и схема, и цикл
  // живут внутри процедуры и наружу не вынесены. Поэтому отдельно — привязка к
  // настоящему файлу: без неё тест остался бы зелёным, даже если бы обе
  // проверки из роутера убрали.
  it("обе проверки действительно стоят в api/courier-router.ts", async () => {
    const { readFile } = await import("node:fs/promises");
    const src = await readFile("api/courier-router.ts", "utf-8");

    expect(src, "в схеме returnedItems пропал .min(0)")
      .toMatch(/returnedQty:\s*z\.number\(\)\.min\(0/);
    expect(src, "пропала серверная проверка returnedQty > qty")
      .toMatch(/if\s*\(returnedQty\s*>\s*qty\)/);
  });
});
