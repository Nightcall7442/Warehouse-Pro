/**
 * Правка заказа читает его строку под замком.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * updateItems выбирал заказ обычным SELECT, по прочитанному статусу решал
 * режим склада (резерв или списание) и лишь потом брал FOR UPDATE на строки
 * остатка. update() так же читал subtotal без замка. Переплетение:
 *
 *   T1 (updateItems, 10 → 15) читает status = new;
 *   T2 (updateStatus new → delivered) блокирует заказ, списывает 10, коммитит;
 *   T1 дожидается замков остатка и резервирует +5 под УЖЕ ДОСТАВЛЕННЫЙ заказ,
 *      переписывает quantity = 15 и сумму.
 *
 * Итог: магазин должен за 15, уехало 10, пять единиц висят в reserved без
 * заказа, который бы их объяснял. Оператор правит состав в вебе, пока курьер
 * закрывает тот же заказ в телефоне — редкий, но живой случай на каждом
 * складе; всплывает только при инвентаризации.
 *
 * ── Что проверяется ─────────────────────────────────────────────────────────
 *
 * В обоих методах ПЕРВОЕ чтение из orders несёт .for("update"). Проверка по
 * тексту метода, потому что подделка базы в стендах замков не знает: она
 * считает арифметику на JavaScript, где порядок не значит ничего.
 *
 * Нарочная поломка: убери .for("update") из чтения заказа в updateItems —
 * проверка называет метод.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ORDER = readFileSync(resolve(__dirname, "../services/order.ts"), "utf-8");

/** Тело метода OrderService от заголовка до следующего метода. */
function methodBody(name: string): string {
  const at = ORDER.indexOf(`  async ${name}(`);
  expect(at, `${name} не найден`).toBeGreaterThan(0);
  const next = ORDER.indexOf("\n  async ", at + 10);
  return ORDER.slice(at, next < 0 ? undefined : next);
}

/** Первое чтение из orders внутри тела: от `.from(orders)` до `.limit(1)`. */
function firstOrderRead(body: string): string {
  const from = body.indexOf(".from(orders)");
  expect(from, "чтение заказа не найдено").toBeGreaterThan(0);
  const end = body.indexOf(".limit(1)", from);
  expect(end, "чтение заказа без .limit(1)").toBeGreaterThan(from);
  return body.slice(from, end);
}

describe("правка заказа держит его строку под замком", () => {
  for (const name of ["updateItems", "update"]) {
    it(`${name}: чтение заказа с .for("update")`, () => {
      expect(firstOrderRead(methodBody(name)), `${name} читает заказ без замка`).toContain('.for("update")');
    });
  }
});
