import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { canSeeAnyOrder, canSettleAnyOrder, canCancelAnyOrder } from "../services/order";

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

const FIELD_ROLES = ["agent", "merchandiser", "courier", "finance"];
const ALL_ROLES = ["ceo", "operator", "supervisor", "superadmin", ...FIELD_ROLES, "новая_роль", ""];

describe("кто что может с чужим заказом", () => {
  it("руководитель, оператор, суперадмин — всё", () => {
    for (const role of ["ceo", "operator", "superadmin"]) {
      expect(canSeeAnyOrder(role), role).toBe(true);
      expect(canSettleAnyOrder(role), role).toBe(true);
      expect(canCancelAnyOrder(role), role).toBe(true);
    }
  });

  it("супервайзер только смотрит", () => {
    // Решение владельца, принятое явно: супервайзер следит за работой, но
    // деньги и склад по чужим заказам не двигает.
    expect(canSeeAnyOrder("supervisor")).toBe(true);
    expect(canSettleAnyOrder("supervisor")).toBe(false);
    expect(canCancelAnyOrder("supervisor")).toBe(false);
  });

  it("полевым ролям — только свои заказы", () => {
    for (const role of FIELD_ROLES) {
      expect(canSeeAnyOrder(role), `роль ${role} не должна видеть чужие заказы`).toBe(false);
      expect(canSettleAnyOrder(role), `роль ${role} не должна проводить чужие заказы`).toBe(false);
      expect(canCancelAnyOrder(role), `роль ${role} не должна отменять чужие заказы`).toBe(false);
    }
  });

  it("неизвестная роль не получает прав по умолчанию", () => {
    for (const role of ["", "новая_роль"]) {
      expect(canSeeAnyOrder(role)).toBe(false);
      expect(canSettleAnyOrder(role)).toBe(false);
      expect(canCancelAnyOrder(role)).toBe(false);
    }
  });
});

describe("если права расходятся — отказ обязан назвать причину", () => {
  /**
   * Роль, которая ВИДИТ заказ, но не может его провести, — это ловушка:
   * человек открывает заказ, вводит сумму и получает отказ. Сама ловушка
   * допустима и здесь намеренная. Недопустимо другое — отказ, который не
   * объясняет себя.
   *
   * Так и было: «Заказ не найден» отвечали и на «нет такого», и на «чужой»,
   * потому что условие владельца стоит внутри выборки. Супервайзер видел заказ
   * на экране, читал «не найден» и шёл искать поломку в данных. Разбор занял
   * несколько дней, а в боевой базе за это время не записалось ни одной
   * частичной оплаты.
   */
  it("ловушка действительно есть — иначе проверки ниже пусты", () => {
    const trapped = ALL_ROLES.filter(r => canSeeAnyOrder(r) && !canSettleAnyOrder(r));
    expect(trapped, "если список опустел, проверки ниже больше ничего не стерегут").toEqual(["supervisor"]);
  });

  it("отказ по владельцу идёт через orderAccessError везде, где есть ownerScope", () => {
    for (const fn of ["applyPartialPayment", "applyPartialDelivery"]) {
      const at = SRC.indexOf(`async function ${fn}(`);
      expect(at, `${fn} не найдена`).toBeGreaterThan(-1);
      const body = SRC.slice(at, at + 4000);
      expect(body, `${fn}: отказ не объясняет причину`).toContain("orderAccessError");
      expect(body, `${fn}: остался молчаливый отказ`).not.toContain('new Error("Заказ не найден")');
    }
  });

  it("orderAccessError различает «нет такого» и «чужой»", () => {
    const at = SRC.indexOf("async function orderAccessError(");
    expect(at, "orderAccessError не найдена").toBeGreaterThan(-1);
    // Тело именно этой функции: до первой закрывающей скобки в начале
    // строки. Окно «плюс N символов» захватывало соседнюю функцию, и проверка
    // «нет голого Error» падала на её тексте.
    const body = SRC.slice(at).split(/^}/m)[0];
    // Чужой — FORBIDDEN с объяснением; отсутствующий — NOT_FOUND.
    expect(body).toContain('code: "FORBIDDEN"');
    expect(body).toContain('code: "NOT_FOUND"');
    expect(body).toContain("оформил другой сотрудник");
    // Именно TRPCError: голый Error прод подменяет на «Внутренняя ошибка
    // сервера», и объяснение до человека не доходит.
    expect(body).not.toContain("new Error(");
  });
});

describe("менять и удалять заказ супервайзер не может", () => {
  /**
   * Это держится не правилами выше, а уровнем процедуры: operatorQuery — это
   * ceo и operator. Проверка читает роутер, чтобы правило не уехало молча.
   */
  const GUARDED = [
    "update", "updateItems", "updateStatus", "delete", "restore",
    "bulkUpdateStatus", "bulkCompleteWithPayment", "bulkAssignAgent", "bulkAssignCourier",
  ];

  for (const proc of GUARDED) {
    it(`${proc} — только оператор и руководитель`, () => {
      const at = ROUTER.indexOf(`\n  ${proc}: `);
      expect(at, `процедура ${proc} не найдена`).toBeGreaterThan(-1);
      expect(ROUTER.slice(at, at + 60), `${proc} открыта шире, чем operatorQuery`).toContain("operatorQuery");
    });
  }
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
