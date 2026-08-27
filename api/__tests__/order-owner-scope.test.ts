import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { canActOnAnyOrder } from "../services/order";

/**
 * Чужой заказ провести нельзя.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Три процедуры денежного пути — recordPartialPayment, recordPartialDelivery и
 * recordDeliveryAndPayment — объявлены на fieldSalesQuery, то есть открыты
 * агенту, мерчандайзеру и супервайзеру. А выборка заказа фильтровалась только
 * по id и организации: чей это заказ, не проверялось нигде.
 *
 * Значит, любой из них, зная или перебрав номер заказа, мог:
 *   • вписать приём наличных на всю сумму чужого заказа — деньги при этом
 *     никто не приносил, а долг магазина обнулялся;
 *   • отправить доставку с нулевым количеством по всем позициям: сумма заказа
 *     обрезается до нуля, статус становится «доставлен», и после этого заказ
 *     уже не отменить и не доставить — проверка статуса не пустит.
 *
 * Для мерчандайзера это была не лазейка вбок, а новая способность целиком:
 * собственных заказов у него нет, поэтому любой заказ, который он проводит, —
 * заведомо чужой.
 *
 * Рядом, в OrderService.cancel, такая проверка стояла с самого начала. Именно
 * поэтому здесь она и не бросалась в глаза: образец в файле был.
 */

const SRC = readFileSync(join(process.cwd(), "api", "services", "order.ts"), "utf8").replace(/\r\n/g, "\n");
const ROUTER = readFileSync(join(process.cwd(), "api", "order-router.ts"), "utf8").replace(/\r\n/g, "\n");

describe("кто вправе трогать любой заказ", () => {
  it("операции по заказу доступны руководителю, оператору и суперадмину", () => {
    expect(canActOnAnyOrder("ceo")).toBe(true);
    expect(canActOnAnyOrder("operator")).toBe(true);
    expect(canActOnAnyOrder("superadmin")).toBe(true);
  });

  it("полевым ролям — только свои заказы", () => {
    // Супервайзер здесь намеренно вместе с агентом: то же правило, что в
    // cancel. Разъедься эти списки — и «отменить» с «провести оплату»
    // разошлись бы в правах, хотя по весу это одна и та же операция.
    for (const role of ["agent", "merchandiser", "supervisor", "courier", "finance"]) {
      expect(canActOnAnyOrder(role), `роль ${role} не должна получать чужие заказы`).toBe(false);
    }
  });

  it("неизвестная роль не получает прав по умолчанию", () => {
    expect(canActOnAnyOrder("")).toBe(false);
    expect(canActOnAnyOrder("новая_роль")).toBe(false);
  });
});

/**
 * Проверки проводки — статические: подставить в них живую базу дороже, чем
 * пользы. Смотрят они не на текст правила (оно проверено выше), а на то, что
 * условие владельца попало ВНУТРЬ выборки под блокировкой: проверка после
 * SELECT ... FOR UPDATE — это уже другая ошибка, гонка вместо утечки.
 */
function whereOf(fnName: string): string {
  const start = SRC.indexOf(`async function ${fnName}(`);
  expect(start, `${fnName} не найдена`).toBeGreaterThan(-1);
  const body = SRC.slice(start);
  const forUpdate = body.indexOf('.for("update")');
  expect(forUpdate, `${fnName}: выборка заказа без блокировки`).toBeGreaterThan(-1);
  return body.slice(0, forUpdate);
}

describe("проводка денег и доставки ограничена владельцем", () => {
  for (const fn of ["applyPartialPayment", "applyPartialDelivery"]) {
    it(`${fn} фильтрует заказ по владельцу внутри блокирующей выборки`, () => {
      expect(whereOf(fn)).toContain("...ownerScope(actor)");
    });
  }

  it("роль доходит до сервиса из всех трёх процедур", () => {
    // Без роли в вызове проверка выше бессмысленна: сервис не догадается,
    // кто пришёл.
    for (const proc of ["recordPartialPayment", "recordPartialDelivery", "recordDeliveryAndPayment"]) {
      const at = ROUTER.indexOf(`OrderService.${proc}(`);
      expect(at, `${proc} не вызывается из роутера`).toBeGreaterThan(-1);
      const call = ROUTER.slice(at, at + 200);
      expect(call, `${proc} вызывается без роли`).toContain("role: ctx.user.role");
    }
  });
});

describe("состав частично доставленного заказа не правится", () => {
  it("updateItems отказывает, если по строке уже записано доставленное количество", () => {
    // Функция считает только quantity — заказанное. Пересчёт суммы по нему
    // возвращал магазину в долг стоимость товара, который он уже вернул, а
    // попытка исправить это руками зачисляла возвращённые единицы на склад
    // второй раз.
    const start = SRC.indexOf("async updateItems(");
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 6000);
    expect(body).toContain("deliveredQuantity !== null");
    expect(body).toContain("частично доставлен");
  });
});
