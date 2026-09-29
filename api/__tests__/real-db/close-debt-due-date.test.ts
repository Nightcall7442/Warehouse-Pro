import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import * as schema from "@db/schema";
import { ctxFor, hasRealDb, connectRealDb, closeRealDb, truncateAll, seed, type ServiceDb, type Seeded } from "./harness";

/**
 * «Закрыть расчёт» с остатком в долг: срок не теряется.
 *
 * Что было: оператор в блоке «Деньги» ставил «остаток в долг магазину» и
 * вводил «Срок». Сервер писал срок только в НОВЫЕ строки платежей (наличные
 * сверх заявленного, «Ещё принято»). В обычном случае — курьер сдал часть,
 * остаток в долг, доплаты нет — строк не было, и срок пропадал: напоминания о
 * долге офис не заводил никогда, их делал только курьер. А оплата по частям
 * со сроком вставляла новое напоминание на каждый платёж — по одному заказу
 * их копилось несколько.
 *
 * Что проверяется — на настоящей базе:
 *   · остаток в долг без доплаты → напоминание со сроком и суммой остатка;
 *   · курьер уже завёл напоминание → закрытие не дублирует, а обновляет его;
 *   · повторное закрытие (агент собрал часть, расчёт открылся заново) — всё
 *     ещё одно напоминание, с новой суммой и сроком;
 *   · две оплаты по частям со сроком — одно напоминание;
 *   · без срока напоминание не заводится (как у курьера).
 *
 * Нарочная поломка: убери вызов upsertDebtReminder из OrderCloseService.close —
 * падает «остаток в долг без доплаты»; в upsertDebtReminder всегда вставляй
 * новую строку — падают «курьер уже завёл» и «две оплаты».
 */
let current: ServiceDb;
vi.mock("../../queries/connection", () => ({ getDb: () => current, getPool: () => null }));
vi.mock("../../lib/telegram", async (orig) => ({ ...(await orig<object>()), sendTelegram: vi.fn(async () => true), notifyTenantRole: vi.fn(async () => undefined) }));

describe.skipIf(!hasRealDb)("закрытие расчёта: срок долга — в напоминание", () => {
  let db: ServiceDb;
  let s: Seeded;
  let ceoId = 0;
  const ceo = () => ({ id: ceoId, name: "Директор", role: "ceo" });

  beforeAll(async () => { db = await connectRealDb(); current = db; }, 180_000);
  afterAll(async () => { await closeRealDb(); });
  beforeEach(async () => {
    await truncateAll();
    s = await seed("10.000");
    const [c] = await (db as any).insert(schema.users).values({ tenantId: s.tenantId, name: "Директор", email: "ceo@test.local", passwordHash: "x", role: "ceo" });
    ceoId = Number(c.insertId);
  });

  /** Доставленный заказ на 300 с полевыми наличными `cash` от курьера. */
  const delivered = async (cash: string | null) => {
    const [r] = await (db as any).insert(schema.orders).values({
      tenantId: s.tenantId, shopId: s.shopId, agentId: s.agentId, courierId: s.courierId, orderNumber: `№${Math.random().toString(36).slice(2, 7)}`,
      status: "delivered", deliveryStatus: "delivered", paymentMethod: "cash", subtotal: "300.00", total: "300.00", deliveredAt: new Date(),
    });
    const id = Number(r.insertId);
    if (cash) await (db as any).insert(schema.payments).values({ tenantId: s.tenantId, shopId: s.shopId, orderId: id, amount: cash, type: "payment", paymentMethod: "cash", status: "partially_paid", createdBy: s.courierId });
    return id;
  };
  const reminders = async (orderId: number) => (await (db as any).execute(sql`
    SELECT shop_id AS shopId, CAST(amount AS DECIMAL(15,2)) AS amount, DATE_FORMAT(due_date, '%Y-%m-%d') AS dueDate, status
    FROM debt_reminders WHERE order_id = ${orderId} ORDER BY id`) as unknown as [Array<Record<string, unknown>>])[0]
    .map(r => ({ shopId: Number(r.shopId), amount: Number(r.amount), dueDate: String(r.dueDate), status: String(r.status) }));
  const close = async (input: Record<string, unknown>) => {
    const { OrderCloseService } = await import("../../services/order-close");
    return OrderCloseService.close(db as any, s.tenantId, ceo(), input as never);
  };

  it("остаток в долг без доплаты → напоминание со сроком есть", async () => {
    const id = await delivered("100.00");
    expect(await close({ orderId: id, cashReceived: 100, acceptDebt: true, debtDueDate: "2026-10-15" })).toMatchObject({ remainder: 200, added: 0 });
    // Доплаты не было — новых строк платежей нет, срок живёт только в напоминании.
    expect(await (db as any).select().from(schema.payments).where(eq(schema.payments.orderId, id))).toHaveLength(1);
    expect(await reminders(id), "срок из «Закрыть расчёт» пропал").toEqual([{ shopId: s.shopId, amount: 200, dueDate: "2026-10-15", status: "pending" }]);
  });

  it("без срока напоминание не заводится", async () => {
    const id = await delivered(null);
    await close({ orderId: id, cashReceived: 0, acceptDebt: true });
    expect(await reminders(id)).toEqual([]);
  });

  it("курьер уже завёл напоминание — закрытие его обновляет, а не дублирует; повторное закрытие — тоже", async () => {
    const { OrderService } = await import("../../services/order");
    const r = await OrderService.create(db, s.tenantId, s.agentId, {
      shopId: s.shopId, paymentMethod: "cash", items: [{ productId: s.productId, quantity: "3" }],
    });
    const id = (r as { id: number }).id;
    const op = (await import("../../courier-router")).courierRouter.createCaller(ctxFor(db, s.tenantId, s.agentId, "operator"));
    const courier = (await import("../../courier-router")).courierRouter.createCaller(ctxFor(db, s.tenantId, s.courierId, "courier"));
    await op.assignCourier({ orderId: id, courierId: s.courierId });
    await courier.markOutForDelivery({ orderId: id });
    // 3 × 100 = 300; магазин отдал курьеру 100, обещал остаток к 10-му.
    await courier.completeDelivery({ orderId: id, result: "partial_paid", paymentMethod: "cash", paidAmount: "100", debtDueDate: "2026-10-10" });
    expect(await reminders(id)).toEqual([{ shopId: s.shopId, amount: 200, dueDate: "2026-10-10", status: "pending" }]);

    // Офис: курьер сдал 100, остаток — в долг до 20-го.
    await close({ orderId: id, cashReceived: 100, acceptDebt: true, debtDueDate: "2026-10-20" });
    expect(await reminders(id), "закрытие завело второе напоминание").toEqual([{ shopId: s.shopId, amount: 200, dueDate: "2026-10-20", status: "pending" }]);

    // Агент собрал 50 — расчёт открылся; офис закрыл заново с новым сроком.
    await OrderService.recordPartialPayment(db as any, s.tenantId, { id: s.agentId, role: "agent" }, { orderId: id, paidAmount: "50", method: "cash" });
    await close({ orderId: id, cashReceived: 50, acceptDebt: true, debtDueDate: "2026-11-01" });
    expect(await reminders(id), "повторное закрытие задвоило напоминание").toEqual([{ shopId: s.shopId, amount: 150, dueDate: "2026-11-01", status: "pending" }]);
  });

  it("две оплаты по частям со сроком — одно напоминание с последним остатком", async () => {
    const { OrderService } = await import("../../services/order");
    const id = await delivered(null);
    await OrderService.recordPartialPayment(db as any, s.tenantId, { id: ceoId, role: "ceo" }, { orderId: id, paidAmount: "100", method: "cash", debtDueDate: "2026-10-05" });
    await OrderService.recordPartialPayment(db as any, s.tenantId, { id: ceoId, role: "ceo" }, { orderId: id, paidAmount: "50", method: "cash", debtDueDate: "2026-10-12" });
    expect(await reminders(id)).toEqual([{ shopId: s.shopId, amount: 150, dueDate: "2026-10-12", status: "pending" }]);
  });
});
