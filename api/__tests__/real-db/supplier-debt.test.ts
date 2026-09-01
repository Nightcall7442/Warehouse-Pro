/**
 * Расчёты с контрагентами — на настоящей MySQL.
 *
 * ── Почему именно здесь, а не на заглушке ────────────────────────────────────
 *
 * Долг нигде не хранится полем: и он, и «оплачено» выводятся коррелирующими
 * подзапросами в sql``. Заглушка такой SQL не выполняет — она подменяет его
 * расчётом на JavaScript по своим же таблицам. То есть проверяет собственную
 * подделку, а не запрос, который поедет в базу.
 *
 * 1 сентября 2026 это дважды выстрелило за один день, и оба раза заглушка
 * была зелёной:
 *
 *   Страница приходов легла с ER_NON_UNIQ_ERROR. В списке выборки (в отличие
 *   от WHERE) drizzle печатает колонку без имени таблицы, и `${arrivals.id}`
 *   превращался в просто `id`. Внутри подзапроса своё `id` есть и у
 *   внутренней таблицы — MySQL счёл имя неоднозначным.
 *
 *   Та же причина в подзапросах долга НЕ падала. У supplier_payments тоже
 *   есть `id`, и MySQL молча разрешал неуточнённое имя в пользу внутренней
 *   таблицы: условие тихо становилось `p.supply_id = p.id`. Ошибки нет —
 *   есть неверная сумма в графе «оплачено».
 *
 * Второй случай страшнее первого: он не роняет ничего, он просто врёт про
 * деньги. Поймать его можно единственным способом — выполнить настоящий
 * запрос на настоящей базе и сверить число. Этим здесь и занимаемся.
 *
 * ── Про подбор данных ────────────────────────────────────────────────────────
 *
 * Числа подобраны так, чтобы ошибка корреляции давала ДРУГОЙ ответ, а не
 * случайно тот же. Поэтому у платежей свои идентификаторы намеренно не
 * совпадают с идентификаторами поставок, а сумм больше одной.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import * as schema from "@db/schema";
import {
  hasRealDb, connectRealDb, closeRealDb, truncateAll, seed,
  type ServiceDb, type Seeded,
} from "./harness";

/** Контекст tRPC поверх настоящей базы. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ctxFor(db: ServiceDb, tenantId: number, userId: number): any {
  return {
    req: new Request("http://localhost/"),
    resHeaders: new Headers(),
    db,
    user: {
      id: userId, tenantId, role: "operator", status: "active" as const,
      name: "Оператор", email: "op@test.local", passwordHash: "x",
      avatar: null, phone: null,
      createdAt: new Date(), updatedAt: new Date(), lastSignInAt: new Date(),
    },
    tenant: {
      id: tenantId, slug: "test-co", name: "Тестовая компания",
      plan: "pro" as const, status: "active" as const,
      createdAt: new Date(), updatedAt: new Date(),
    },
  };
}

describe.skipIf(!hasRealDb)(
  "долг контрагенту на настоящей MySQL (пропущено без TEST_DATABASE_URL — см. real-db/harness.ts)",
  () => {
  let db: ServiceDb;
  let s: Seeded;
  let supplierId: number;
  let arrivalId: number;
  let supplyId: number;

  beforeAll(async () => { db = await connectRealDb(); }, 180_000);
  afterAll(async () => { await closeRealDb(); });

  beforeEach(async () => {
    await truncateAll();
    s = await seed("10.000");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const d = db as any;

    const [sup] = await d.insert(schema.suppliers).values({
      tenantId: s.tenantId, name: "Завод Ташкент", phone: "+998901112233",
    });
    supplierId = Number(sup.insertId);

    const [arr] = await d.insert(schema.arrivals).values({
      tenantId: s.tenantId, arrivalNumber: "ARR-TEST-0001",
      arrivalDate: new Date("2026-08-12"), status: "completed",
      fuelCost: "0.00", tollCost: "0.00", otherCost: "0.00", totalExpense: "0.00",
    });
    arrivalId = Number(arr.insertId);

    await d.insert(schema.arrivalItems).values({
      arrivalId, productId: s.productId,
      quantity: "100.00", costPrice: "9000.00", sellingPrice: "12000.00",
    });

    const [sup1] = await d.insert(schema.supplies).values({
      tenantId: s.tenantId, supplierId, arrivalId,
      supplyNumber: "SUP-TEST-0001", amount: "500000000.00", currency: "UZS",
      supplyDate: new Date("2026-08-12"), dueDate: new Date("2026-09-12"),
    });
    supplyId = Number(sup1.insertId);

    // Два платежа, суммарно 200 000 000 — остаток 300 000 000.
    await d.insert(schema.supplierPayments).values({
      tenantId: s.tenantId, supplierId, supplyId,
      amount: "150000000.00", paymentMethod: "transfer",
      paidAt: new Date("2026-08-20T14:30:00"), idempotencyKey: "seed-pay-1",
    });
    await d.insert(schema.supplierPayments).values({
      tenantId: s.tenantId, supplierId, supplyId,
      amount: "50000000.00", paymentMethod: "cash",
      paidAt: new Date("2026-08-25T09:15:00"), idempotencyKey: "seed-pay-2",
    });
  });

  /* ── Подзапросы долга ──────────────────────────────────────────────────── */

  it("«оплачено» складывает платежи ИМЕННО этой поставки", async () => {
    // Подставь сюда неуточнённое `id` — и условие станет
    // `p.supply_id = p.id`, а сумма превратится в 0 или в чужую. Заглушка
    // этого не увидит: там подзапрос считает JavaScript.
    const { supplierRouter } = await import("../../supplier-router");
    const res = await supplierRouter
      .createCaller(ctxFor(db, s.tenantId, s.agentId))
      .getSupplyByArrival({ arrivalId });

    expect(res).not.toBeNull();
    expect(res!.amount).toBe(500_000_000);
    expect(res!.paid).toBe(200_000_000);
    expect(res!.debt).toBe(300_000_000);
    expect(res!.payments).toHaveLength(2);
    expect(res!.supplierName).toBe("Завод Ташкент");
  });

  it("долг контрагента в списке считается по валютам и совпадает с прямым счётом", async () => {
    const { supplierRouter } = await import("../../supplier-router");
    const rows = await supplierRouter
      .createCaller(ctxFor(db, s.tenantId, s.agentId))
      .list(undefined);

    const zavod = rows.find(r => r.id === supplierId)!;
    expect(zavod.debtUzs).toBe(300_000_000);
    expect(zavod.debtUsd).toBe(0);
    expect(zavod.suppliesCount).toBe(1);

    // Тот же ответ, посчитанный независимо — обычной группировкой вместо
    // коррелирующих подзапросов. Расхождение здесь означает, что подзапрос
    // соотносится не с той строкой.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = await (db as any).execute(sql`
      SELECT s.amount - COALESCE(SUM(p.amount), 0) AS debt
      FROM supplies s LEFT JOIN supplier_payments p ON p.supply_id = s.id
      WHERE s.supplier_id = ${supplierId} GROUP BY s.id, s.amount`);
    const [list] = raw as unknown as [Array<Record<string, unknown>>, unknown];
    expect(Number(list[0].debt)).toBe(zavod.debtUzs);
  });

  it("платёж по одной поставке не влияет на долг по другой", async () => {
    // Самая коварная форма ошибки корреляции: подзапрос берёт ВСЕ платежи
    // контрагента вместо платежей своей поставки. С одной поставкой такое
    // неотличимо от верного ответа — поэтому здесь их две.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const d = db as any;
    await d.insert(schema.supplies).values({
      tenantId: s.tenantId, supplierId, arrivalId: null,
      supplyNumber: "SUP-TEST-0002", amount: "80000000.00", currency: "UZS",
      supplyDate: new Date("2026-08-15"),
    });

    const { supplierRouter } = await import("../../supplier-router");
    const res = await supplierRouter
      .createCaller(ctxFor(db, s.tenantId, s.agentId))
      .supplies({ supplierId });

    const first  = res.data.find(r => r.supplyNumber === "SUP-TEST-0001")!;
    const second = res.data.find(r => r.supplyNumber === "SUP-TEST-0002")!;

    expect(first.paid).toBe(200_000_000);
    expect(first.debt).toBe(300_000_000);
    // По второй поставке платежей нет вовсе — долг равен полной сумме.
    expect(second.paid).toBe(0);
    expect(second.debt).toBe(80_000_000);
  });

  /* ── Деньги в списке приходов ──────────────────────────────────────────── */

  it("список приходов отдаёт сумму, оплачено и остаток", async () => {
    // Здесь тот самый запрос, который лёг на бою: пять коррелирующих
    // подзапросов в списке выборки. На заглушке он не выполняется вовсе.
    const { arrivalRouter } = await import("../../arrival-router");
    const res = await arrivalRouter
      .createCaller(ctxFor(db, s.tenantId, s.agentId))
      .list({ page: 1, pageSize: 25 });

    const row = res.data.find(a => a.id === arrivalId)!;
    expect(row.supplierName).toBe("Завод Ташкент");
    expect(row.supplyAmount).toBe(500_000_000);
    expect(row.supplyPaid).toBe(200_000_000);
    expect(row.supplyDebt).toBe(300_000_000);
    // Сумма товаров прихода: 100 × 9000.
    expect(row.goodsTotal).toBe(900_000);
  });

  it("приход без поставщика отдаёт пустые деньги, а не нули", async () => {
    // Разница существенная: 0 значит «должны ноль», null — «поставщика нет».
    // Спутать их — показать долг там, где его не заводили.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const d = db as any;
    const [plain] = await d.insert(schema.arrivals).values({
      tenantId: s.tenantId, arrivalNumber: "ARR-TEST-0002",
      arrivalDate: new Date("2026-09-01"), status: "pending",
      fuelCost: "0.00", tollCost: "0.00", otherCost: "0.00", totalExpense: "0.00",
    });

    const { arrivalRouter } = await import("../../arrival-router");
    const res = await arrivalRouter
      .createCaller(ctxFor(db, s.tenantId, s.agentId))
      .list({ page: 1, pageSize: 25 });

    const row = res.data.find(a => a.id === Number(plain.insertId))!;
    expect(row.supplierName).toBeNull();
    expect(row.supplyAmount).toBeNull();
    expect(row.supplyDebt).toBeNull();
    expect(row.goodsTotal).toBe(0);
  });

  /* ── Оплата ────────────────────────────────────────────────────────────── */

  it("переплату отбивает настоящая проверка остатка", async () => {
    const { supplierRouter } = await import("../../supplier-router");
    const caller = supplierRouter.createCaller(ctxFor(db, s.tenantId, s.agentId));

    await expect(caller.pay({
      supplyId, amount: "300000001.00", paymentMethod: "cash",
      idempotencyKey: "11111111-1111-4111-8111-111111111111",
    })).rejects.toThrow(/остатка/i);

    // Ни одна строка не записалась: остаток прежний.
    const after = await caller.getSupplyByArrival({ arrivalId });
    expect(after!.debt).toBe(300_000_000);
  });

  it("повтор платежа с тем же ключом отбивает уникальный индекс базы", async () => {
    // Защита здесь не в коде, а в uq_supplier_payment_idem. На заглушке
    // индексов нет вовсе — там эта проверка прошла бы при любом коде.
    const { supplierRouter } = await import("../../supplier-router");
    const caller = supplierRouter.createCaller(ctxFor(db, s.tenantId, s.agentId));
    const key = "22222222-2222-4222-8222-222222222222";

    const first = await caller.pay({ supplyId, amount: "100000000.00", paymentMethod: "cash", idempotencyKey: key });
    expect(first.debt).toBe(200_000_000);

    const second = await caller.pay({ supplyId, amount: "100000000.00", paymentMethod: "cash", idempotencyKey: key });
    expect(second.duplicate).toBe(true);

    // Долг списан один раз, а не дважды.
    const after = await caller.getSupplyByArrival({ arrivalId });
    expect(after!.debt).toBe(200_000_000);
  });

  it("два одновременных платежа не уводят долг в минус", async () => {
    // Гонка: оба видят остаток 300 000 000 и оба платят по 200 000 000.
    // Проверка остатка идёт внутри транзакции — на заглушке транзакция
    // сквозная, и эта проверка там прошла бы при любом коде.
    const { supplierRouter } = await import("../../supplier-router");
    const caller = supplierRouter.createCaller(ctxFor(db, s.tenantId, s.agentId));

    await Promise.allSettled([
      caller.pay({ supplyId, amount: "200000000.00", paymentMethod: "cash", idempotencyKey: "33333333-3333-4333-8333-333333333333" }),
      caller.pay({ supplyId, amount: "200000000.00", paymentMethod: "cash", idempotencyKey: "44444444-4444-4444-8444-444444444444" }),
    ]);

    const after = await caller.getSupplyByArrival({ arrivalId });
    expect(after!.paid).toBeLessThanOrEqual(500_000_000);
    expect(after!.debt).toBeGreaterThanOrEqual(0);
  });

  /* ── Чужая организация ─────────────────────────────────────────────────── */

  it("контрагент соседней организации не виден и не оплачивается", async () => {
    const { supplierRouter } = await import("../../supplier-router");
    const alien = supplierRouter.createCaller(ctxFor(db, s.otherTenantId, s.agentId));

    expect(await alien.list(undefined)).toHaveLength(0);
    expect(await alien.getSupplyByArrival({ arrivalId })).toBeNull();
    await expect(alien.supplies({ supplierId })).rejects.toThrow(/не найден/i);
    await expect(alien.pay({
      supplyId, amount: "1.00", paymentMethod: "cash",
      idempotencyKey: "55555555-5555-4555-8555-555555555555",
    })).rejects.toThrow(/не найдена/i);
  });

  /* ── Акт сверки ────────────────────────────────────────────────────────── */

  it("акт сверки сходится: входящий остаток плюс обороты равны конечному", async () => {
    const { supplierRouter } = await import("../../supplier-router");
    const res = await supplierRouter
      .createCaller(ctxFor(db, s.tenantId, s.agentId))
      .reconciliation({ supplierId });

    const uzs = res.byCurrency.find(b => b!.currency === "UZS")!;
    expect(uzs.turnoverDebit).toBe(500_000_000);
    expect(uzs.turnoverCredit).toBe(200_000_000);
    expect(uzs.closing).toBe(300_000_000);
    // Арифметика самого документа: он не должен «не сходиться» ни при каких
    // данных, иначе его нельзя везти на сверку.
    expect(uzs.opening + uzs.turnoverDebit - uzs.turnoverCredit).toBe(uzs.closing);
    expect(uzs.rows.at(-1)!.balance).toBe(uzs.closing);
  });
});
