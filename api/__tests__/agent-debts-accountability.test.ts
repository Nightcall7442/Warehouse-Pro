import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Долги агента: он их видит, может собрать — и не может сделать это незаметно.
 *
 * Долговый заказ — обещание магазина заплатить позже, и собирать его едет тот
 * же агент. Деньги при этом оказываются у него на руках, поэтому у каждого
 * способа уменьшить долг должен оставаться след.
 *
 * Способов ровно два, и оба открыты полевому агенту:
 *
 *   1. Записать оплату (order.recordPartialPayment).
 *   2. Отменить долговый заказ. Долговый заказ должен деньгами С МОМЕНТА
 *      оформления, ещё до отгрузки (services/shop-debt.ts), так что отмена —
 *      это списание долга. Агент мог взять наличные и вместо оплаты отменить
 *      заказ: долг исчезал, деньги оставались, в системе не было ни строки.
 *
 * Ни один из двух путей раньше не писал ни в журнал действий, ни в уведомления.
 */
const read = (p: string) => fs.readFileSync(path.resolve(process.cwd(), p), "utf8");
const ORDER = read("api/services/order.ts");
const AGENT = read("api/agent-router.ts");
const ORDER_ROUTER = read("api/order-router.ts");

describe("список долгов агента", () => {
  it("сужен до его собственных заказов", () => {
    const proc = AGENT.slice(AGENT.indexOf("myDebts: fieldSalesQuery"), AGENT.indexOf("availableShops: fieldSalesQuery"));
    expect(proc, "выборка не ограничена автором заказа").toContain("o.agent_id  = ${ctx.user.id}");
    expect(proc, "выборка не ограничена организацией").toContain("o.tenant_id = ${ctx.tenant.id}");
  });

  it("считает долг тем же правилом, что и долг магазина", () => {
    /*
      Иначе суммы у агента и у офиса разошлись бы, и первым же вопросом стало
      бы «кому верить». Три условия из services/shop-debt.ts: отменённые и
      возвращённые не должны; «в долг» должен сразу, остальные — с отгрузки;
      вычитается оплаченное по этому заказу.
    */
    const proc = AGENT.slice(AGENT.indexOf("myDebts: fieldSalesQuery"), AGENT.indexOf("availableShops: fieldSalesQuery"));
    expect(proc).toContain("o.status NOT IN ('cancelled', 'returned')");
    expect(proc).toContain("o.payment_method = 'debt' OR o.status = 'delivered'");
    expect(proc).toContain("type = 'payment'");
  });
});

describe("уменьшить долг незаметно нельзя", () => {
  it("оплата оставляет след и уведомляет офис", () => {
    const at = ORDER.indexOf("async recordPartialPayment");
    expect(at, "recordPartialPayment не найден").toBeGreaterThan(0);
    const body = ORDER.slice(at, ORDER.indexOf("async recordPartialDelivery", at));
    expect(body, "оплата больше не оставляет следа").toContain("traceDebtChange");
    expect(body, "след пишется до подтверждения сделки").toContain("await db.transaction");
  });

  it("отмена долгового заказа тоже", () => {
    const at = ORDER.indexOf("async cancel(");
    expect(at, "cancel не найден").toBeGreaterThan(0);
    // До следующего метода сервиса, а не на глазок: функция длинная, и срез
    // фиксированной длины не доставал до её конца — проверка падала на
    // собственной близорукости, а не на настоящей беде.
    const body = ORDER.slice(at, ORDER.indexOf("  async ", at + 10));
    expect(body, "отмена долгового заказа проходит без следа").toContain("traceDebtChange");
    expect(body, "след ставят и на обычную отмену — это шум").toContain('order.paymentMethod === "debt"');
  });

  it("след пишется и в журнал, и уведомлением", () => {
    const at = ORDER.indexOf("async function traceDebtChange");
    expect(at, "помощник следа не найден").toBeGreaterThan(0);
    const body = ORDER.slice(at, ORDER.indexOf("async function applyPartialPayment", at));
    expect(body, "запись в журнал пропала").toContain("recordAudit");
    expect(body, "уведомление офису пропало").toContain("notifications");
    // Офису — значит руководителю и оператору, а не всем подряд.
    expect(body).toContain("'ceo', 'operator'");
  });

  it("о собственных действиях офис себе не пишет", () => {
    // Иначе оператор получал бы уведомление на каждый свой же платёж и
    // перестал бы читать уведомления вовсе.
    const at = ORDER.indexOf("async function traceDebtChange");
    const body = ORDER.slice(at, ORDER.indexOf("async function applyPartialPayment", at));
    expect(body).toContain("if (canSettleAnyOrder(actor.role)) return;");
  });

  it("удалить оплату по-прежнему нечем", () => {
    /*
      Вся подотчётность держится на том, что записи только добавляются. Если
      появится удаление платежей, след перестанет быть следом.
    */
    for (const f of fs.readdirSync(path.resolve(process.cwd(), "api")).filter(x => x.endsWith("-router.ts"))) {
      expect(read(`api/${f}`), `появилось удаление платежей в ${f}`).not.toMatch(/delete\(payments\)/);
    }
  });

  it("агент может записать оплату только по своему заказу", () => {
    // Ограничение живёт в ownerScope: без него агент гасил бы чужие долги.
    expect(ORDER).toContain("function ownerScope(actor: Actor)");
    expect(ORDER).toContain("canSettleAnyOrder(actor.role) ? [] : [eq(orders.agentId, actor.id)]");
    expect(ORDER_ROUTER).toMatch(/recordPartialPayment: fieldSalesQuery/);
  });
});
