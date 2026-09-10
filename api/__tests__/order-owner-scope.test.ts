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
    "update", "updateStatus", "delete", "restore",
    "bulkUpdateStatus", "bulkCompleteWithPayment", "bulkAssignAgent", "bulkAssignCourier",
  ];

  for (const proc of GUARDED) {
    it(`${proc} — только оператор и руководитель`, () => {
      const at = ROUTER.indexOf(`\n  ${proc}: `);
      expect(at, `процедура ${proc} не найдена`).toBeGreaterThan(-1);
      expect(ROUTER.slice(at, at + 60), `${proc} открыта шире, чем operatorQuery`).toContain("operatorQuery");
    });
  }

  /*
    updateItems ушла из этого списка сознательно: решение владельца — состав
    своего заказа правит и агент. Заказ оформляет он, и «добавьте ещё две
    коробки, а это уберите» слышит он же, стоя в магазине; раньше выходом был
    только звонок в офис.

    Но открыть шире — не значит открыть настежь, и обе границы должны стоять
    ЗДЕСЬ, в процедуре: сервис их не знает.
  */
  it("updateItems открыт агенту, но только на СВОЙ заказ", () => {
    const at = ROUTER.indexOf("\n  updateItems: ");
    expect(at, "процедура updateItems не найдена").toBeGreaterThan(-1);
    const body = ROUTER.slice(at, ROUTER.indexOf("\n\n  ", at + 10));
    expect(body, "updateItems закрыта полевым — просьба владельца не выполнена").toContain("fieldSalesQuery");
    expect(body, "агент может переписать состав ЧУЖОГО заказа")
      .toContain('assertOrderVisible(ctx.db, ctx.tenant.id, input.id, actor, "Менять состав")');
  });

  it("и только пока заказ не уехал", () => {
    /*
      «shipped» значит, что курьер везёт конкретный набор коробок: допиши агент
      строку — накладная разойдётся с тем, что в машине. По «delivered» уже
      посчитан долг магазина, и правка двигает и склад, и деньги задним числом.
    */
    const at = ROUTER.indexOf("\n  updateItems: ");
    const body = ROUTER.slice(at, ROUTER.indexOf("\n\n  ", at + 10));
    expect(body, "агент правит состав уже отгруженного заказа")
      .toContain("assertItemsEditableBy(ctx.db, ctx.tenant.id, input.id, actor)");

    /*
      Список живёт в contracts: по нему сервер отказывает, а экран решает,
      показывать ли кнопку. Две копии дали бы худшее из двух — кнопка есть, а
      ответом отказ.
    */
    const CONTRACTS = readFileSync(join(process.cwd(), "contracts", "constants.ts"), "utf8");
    const win = CONTRACTS.slice(CONTRACTS.indexOf("export const FIELD_EDITABLE_ORDER_STATUSES"));
    const list = win.slice(0, win.indexOf(";"));
    expect(SRC, "сервер завёл свой список статусов вместо общего")
      .toContain("FIELD_EDITABLE_STATUSES = FIELD_EDITABLE_ORDER_STATUSES;");
    expect(list, "отгруженный заказ попал в окно правки").not.toContain("shipped");
    expect(list, "доставленный заказ попал в окно правки").not.toContain("delivered");
    expect(list, "оформленный заказ выпал из окна правки").toContain("new");

    // Офис правит в любом состоянии — иначе поправить чужую ошибку станет
    // нечем, а именно за этим к оператору и идут.
    const fn = SRC.slice(SRC.indexOf("export async function assertItemsEditableBy"));
    expect(fn.slice(0, fn.indexOf("\n}")), "офису тоже закрыли позднюю правку")
      .toContain("if (canSettleAnyOrder(actor.role)) return;");
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

/**
 * То, что висит на заказе сбоку, — тоже заказ.
 *
 * Список и карточка сужаются до своих через ownerScope, а оплаты, правки
 * состава и переписка читались по одному номеру заказа кем угодно из полевых:
 * агент, подставив чужой номер, видел платежи по чужому магазину — суммы, даты
 * и кто принимал, — и мог оставить там комментарий.
 *
 * Перебор номеров тут ничего не стоит: они идут подряд.
 */
describe("подчинённые данные заказа сужены до своих", () => {
  const SIDE_PROCEDURES = ["getAdjustments", "getOrderPayments", "listComments", "addComment"];

  /*
    Тело ОДНОЙ процедуры: от её объявления до следующего.

    Срез «до ближайшего `}),`» этого не даёт — процедуры лежат подряд, и в
    хвост попадает соседняя вместе со своей проверкой. Тогда снятая защита
    находится у соседа, и тест молча проходит: ровно это и случилось на
    первом прогоне мутаций.
  */
  const procBody = (proc: string): string => {
    const at = ROUTER.indexOf(`\n  ${proc}: `);
    expect(at, `процедура ${proc} не найдена`).toBeGreaterThan(-1);
    const rest = ROUTER.slice(at + 3);
    const next = rest.search(/\n {2}\w+: (fieldSalesQuery|operatorQuery|adminQuery|authedQuery)/);
    return next > 0 ? rest.slice(0, next) : rest;
  };

  for (const proc of SIDE_PROCEDURES) {
    it(`${proc} проверяет, что заказ вообще виден этому человеку`, () => {
      const body = procBody(proc);
      expect(body, `${proc}: чужой заказ читается по одному номеру`).toContain("assertOrderVisible(");
      // Роль обязана дойти до проверки — иначе она пропустит кого угодно.
      expect(body, `${proc}: проверка вызвана без роли`).toContain("role: ctx.user.role");
    });
  }

  it("сама проверка сужает выборку тем же ownerScope", () => {
    // Не своим правилом рядом, а тем же самым: два правила разъезжаются.
    const at = SRC.indexOf("export async function assertOrderVisible(");
    expect(at, "assertOrderVisible не найдена").toBeGreaterThan(-1);
    const body = SRC.slice(at, SRC.indexOf("\n}", at));
    expect(body).toContain("...ownerScope(actor)");
    expect(body, "мягко удалённый заказ проходит проверку").toContain("isNull(orders.deletedAt)");
    expect(body, "отказ отличается от прочих путей").toContain("orderAccessError");
  });
});

/**
 * Отказ по остаткам должен называть товар.
 *
 * «Недостаточно товара на складе: 417, 902» кладовщику не говорит ничего:
 * номера товара нет ни на коробке, ни в накладной. Оформление заказа имена уже
 * называло — остальные четыре отказа остались с номерами.
 */
describe("отказы по остаткам называют товар", () => {
  it("ни одно сообщение не печатает номер товара вместо названия", () => {
    /*
      Отказ виноват, если называет нехватку и НЕ спрашивает имя товара:
      номер остаётся только запасным вариантом внутри самого помощника.
    */
    const offenders = SRC.split("\n").filter(l =>
      /throw new Error\(`(Недостаточно товара|Нет строки склада|Не восстановить)/.test(l)
      && !/productLabel\(|names\.get\(/.test(l)
    );
    expect(offenders, `остались отказы с номером товара:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("имена берутся одним помощником, а не собираются на месте", () => {
    expect(SRC).toContain("async function productNames(");
    expect(SRC).toContain("async function productLabel(");
    // Помощник не должен ронять отказ, если имя не прочиталось.
    const at = SRC.indexOf("async function productNames(");
    expect(SRC.slice(at, SRC.indexOf("\n}", at))).toContain("catch");
  });
});
