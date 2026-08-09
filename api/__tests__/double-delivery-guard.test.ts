import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Один заказ нельзя провести доставкой дважды — ни с какой стороны.
 *
 * Путей доставки два, и они не знали друг о друге:
 *
 *   курьер   → courier.completeDelivery
 *   оператор → OrderService.applyPartialDelivery (recordDeliveryAndPayment)
 *
 * Операторский путь ставит orders.status='delivered', но не трогает
 * deliveryStatus. Курьерский проверял ТОЛЬКО deliveryStatus. Значит заказ,
 * уже проведённый оператором, проходил у курьера второй раз и списывал остаток
 * ещё раз. И наоборот: курьер завершил заказ, оператор нажал «Выполнен» на
 * закешированной строке списка — и списание повторялось.
 *
 * Пробники аудита показали итог: current_stock 94 → 84 при неизменном
 * available 94. Инвариант current = available + reserved сломан — система
 * считает своими 94 единицы, физически есть 84. GREATEST(0, …) в обоих местах
 * это маскировал: reserved в минус не уходил, а current_stock уходил. Недостача
 * всплывала только при инвентаризации.
 *
 * Проверка идёт по исходникам: обе защиты — это ранний throw внутри процедур,
 * который нельзя вызвать в отрыве от них, а поддельная БД в тестах не
 * воспроизводит блокировки и потому не докажет ничего сверх факта наличия
 * условия.
 */

const API_DIR = join(process.cwd(), "api");

describe("двойное проведение доставки отвергается с обеих сторон", () => {
  it("courier.completeDelivery отказывает по уже завершённому заказу", () => {
    const src = readFileSync(join(API_DIR, "courier-router.ts"), "utf8");
    const proc = src.slice(src.indexOf("completeDelivery:"));

    // Проверять deliveryStatus мало: операторская доставка его не меняет.
    expect(proc, "completeDelivery не проверяет orders.status — операторская доставка пройдёт второй раз")
      .toMatch(/order\.status\s*===\s*"delivered"/);
    for (const status of ["cancelled", "returned"]) {
      expect(proc, `completeDelivery пропускает заказ в статусе ${status}`)
        .toMatch(new RegExp(`order\\.status\\s*===\\s*"${status}"`));
    }
  });

  it("applyPartialDelivery отказывает по уже доставленному заказу", () => {
    const src = readFileSync(join(API_DIR, join("services", "order.ts")), "utf8");
    const fn = src.slice(src.indexOf("async function applyPartialDelivery"));
    const guard = fn.slice(0, fn.indexOf("let newSubtotal"));

    for (const status of ["cancelled", "returned", "delivered"]) {
      expect(guard, `applyPartialDelivery пропускает заказ в статусе ${status} — остаток спишется дважды`)
        .toMatch(new RegExp(`order\\.status\\s*===\\s*"${status}"`));
    }
  });

  it("markDelivered сохраняет свою защиту — она была образцом для остальных", () => {
    const src = readFileSync(join(API_DIR, "courier-router.ts"), "utf8");
    const proc = src.slice(src.indexOf("markDelivered:"), src.indexOf("completeDelivery:"));
    expect(proc).toMatch(/order\.status\s*===\s*"delivered"/);
  });
});
