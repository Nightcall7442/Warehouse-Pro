/**
 * Оплата по заказу не записывается дважды при повторе запроса.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Уникальный индекс uq_payments_idempotency стоял в базе с самого начала, и
 * shop.addPayment им пользовался. А три денежные процедуры заказа —
 * recordPartialPayment, recordDeliveryAndPayment и путь курьера — ключа не
 * принимали и в INSERT его не клали. Агент вносит 400 из 1 000, связь рвётся
 * после commit, он вводит снова: в базе 800, долг магазина занижен на 400, а
 * наличных на 400 меньше, чем система считает собранным. Аудит 29.08 это
 * нашёл и пометил «не в этот раз».
 *
 * Вторая беда рядом: страж «не больше суммы заказа» сравнивал double, и
 * точный остаток с копейками отвергался примерно в 11 % случаев.
 *
 * ── Что проверяется ─────────────────────────────────────────────────────────
 *
 * 1. С ключом отказ по uq_payments_idempotency превращается в
 *    { success: true, duplicate: true } — повтор не ошибка.
 * 2. Без ключа тот же отказ пробрасывается: конфликтовать нечему, значит это
 *    нарушение другого индекса, и выдавать его за успех нельзя.
 * 3. Отказ по ДРУГОМУ индексу пробрасывается даже с ключом.
 * 4. Ключ доходит до INSERT, сравнение сумм идёт в тийинах, ключ принимают
 *    обе процедуры роутера.
 *
 * Нарочная поломка: убери разбор isDuplicateOf в recordPartialPayment —
 * первая проверка падает с «promise rejected».
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

vi.mock("../lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../lib/cache", () => ({ cache: { invalidate: vi.fn(), invalidatePrefix: vi.fn(), get: vi.fn(), set: vi.fn() }, CacheKeys: new Proxy({}, { get: () => () => "k" }) }));

const { OrderService } = await import("../services/order");

/** Ошибка в том виде, в каком её отдаёт mysql2 сквозь drizzle: код в cause. */
function dupError(indexName: string): Error {
  const inner = Object.assign(new Error(`Duplicate entry '1-abc' for key 'payments.${indexName}'`), {
    code: "ER_DUP_ENTRY", errno: 1062,
    sqlMessage: `Duplicate entry '1-abc' for key 'payments.${indexName}'`,
  });
  return new Error("Failed query", { cause: inner });
}

const dbThrowing = (err: Error) => ({ transaction: vi.fn(async () => { throw err; }) }) as never;
const actor = { id: 7, role: "agent" as const };

describe("повтор оплаты по заказу", () => {
  it("с ключом — повтор, а не ошибка", async () => {
    const res = await OrderService.recordPartialPayment(
      dbThrowing(dupError("uq_payments_idempotency")), 1, actor,
      { orderId: 5, paidAmount: "400", method: "cash", idempotencyKey: "11111111-2222-3333-4444-555555555555" },
    );
    expect(res).toEqual({ success: true, duplicate: true });
  });

  it("без ключа тот же отказ пробрасывается", async () => {
    await expect(OrderService.recordPartialPayment(
      dbThrowing(dupError("uq_payments_idempotency")), 1, actor,
      { orderId: 5, paidAmount: "400", method: "cash" },
    )).rejects.toThrow(/Failed query/);
  });

  it("отказ по другому индексу пробрасывается и с ключом", async () => {
    await expect(OrderService.recordPartialPayment(
      dbThrowing(dupError("uq_orders_idempotency")), 1, actor,
      { orderId: 5, paidAmount: "400", method: "cash", idempotencyKey: "11111111-2222-3333-4444-555555555555" },
    )).rejects.toThrow(/Failed query/);
  });

  it("доставка с оплатой разбирает повтор так же", async () => {
    const res = await OrderService.recordDeliveryAndPayment(
      dbThrowing(dupError("uq_payments_idempotency")), 1, actor,
      { orderId: 5, deliveredItems: [], payment: { paidAmount: "400", method: "cash", idempotencyKey: "11111111-2222-3333-4444-555555555555" } },
    );
    expect(res).toEqual({ success: true, duplicate: true });
  });
});

describe("форма кода", () => {
  const ORDER = readFileSync(resolve(__dirname, "../services/order.ts"), "utf-8");
  const ROUTER = readFileSync(resolve(__dirname, "../order-router.ts"), "utf-8");
  const body = ORDER.slice(ORDER.indexOf("async function applyPartialPayment"), ORDER.indexOf("async function", ORDER.indexOf("async function applyPartialPayment") + 10));

  it("ключ доходит до INSERT платежа", () => {
    expect(body).toContain("idempotencyKey: input.idempotencyKey ?? null");
  });

  it("сумма сравнивается в тийинах, а не в double", () => {
    expect(body).toContain("tiyin(priorPaid) + tiyin(paid) > tiyin(total)");
    expect(body).not.toMatch(/priorPaid \+ paid > total/);
  });

  it("обе процедуры роутера принимают ключ", () => {
    const partial = ROUTER.slice(ROUTER.indexOf("recordPartialPayment: fieldSalesQuery"), ROUTER.indexOf("recordPartialDelivery: fieldSalesQuery"));
    const delivery = ROUTER.slice(ROUTER.indexOf("recordDeliveryAndPayment: fieldSalesQuery"), ROUTER.indexOf(".mutation", ROUTER.indexOf("recordDeliveryAndPayment: fieldSalesQuery")));
    expect(partial).toContain("idempotencyKey: z.string()");
    expect(delivery).toContain("idempotencyKey: z.string()");
  });
});
