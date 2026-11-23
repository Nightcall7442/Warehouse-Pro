/**
 * Комиссия агента — по дню ПЕРВОЙ доставки заказа.
 *
 * Решение владельца 23.11.2026, бизнес-аудит 19.11.2026, пп. 15–16:
 *   · заказ, оформленный 31.01 и доставленный 02.02, — в комиссии февраля
 *     (раньше не попадал ни в январь, ни в февраль);
 *   · заказ, возвращённый в работу и доставленный снова, остаётся в месяце
 *     первой доставки (раньше входил и в новый месяц — комиссия дважды).
 * Те же правила — у «Рассчитать»: строка комиссии одна.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "@db/schema";
import { hasRealDb, connectRealDb, closeRealDb, truncateAll, seed, type ServiceDb, type Seeded } from "./harness";
import { calculateSalary } from "../../services/kpi";
import { clearDeliveryTrace, dateSecondLife } from "../../services/order-reopen";

let current: ServiceDb;
vi.mock("../../queries/connection", () => ({ getDb: () => current, getPool: () => null }));

/** Месяц по Ташкенту: полночь первого числа и последняя секунда последнего. */
const month = (y: number, m: number) => ({
  start: new Date(Date.UTC(y, m - 1, 1) - 5 * 3600_000),
  end: new Date(Date.UTC(y, m, 1) - 5 * 3600_000 - 1000),
});

describe.skipIf(!hasRealDb)("комиссия по дню первой доставки", () => {
  let db: ServiceDb;
  let s: Seeded;

  beforeAll(async () => { db = await connectRealDb(); current = db; }, 180_000);
  afterAll(async () => { await closeRealDb(); });
  afterEach(() => vi.useRealTimers());
  beforeEach(async () => {
    await truncateAll();
    s = await seed();
    // Ставка 10% с октября (условия переходят из месяца в месяц).
    await db.insert(schema.commissions).values({
      tenantId: s.tenantId, userId: s.agentId, periodType: "monthly",
      periodStart: "2026-09-01" as never, periodEnd: "2026-09-30" as never, status: "paid", commissionRate: "10.00",
    } as never);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-12-15T12:00:00+05:00"));
  });

  async function deliveredOrder(createdAt: string, deliveredAt: string) {
    const [o] = await db.insert(schema.orders).values({
      tenantId: s.tenantId, shopId: s.shopId, agentId: s.agentId, orderNumber: `№C-${Math.random().toString(36).slice(2, 7)}`,
      status: "delivered", paymentMethod: "cash", subtotal: "1000000.00", total: "1000000.00",
      createdAt: new Date(createdAt), deliveredAt: new Date(deliveredAt),
    } as never);
    const orderId = Number(o.insertId);
    await db.insert(schema.orderItems).values({ orderId, productId: s.productId, quantity: "10.00", unitPrice: "100000.00", subtotal: "1000000.00" } as never);
    return orderId;
  }
  const sales = async (y: number, m: number) => {
    const p = month(y, m);
    return (await calculateSalary(db as never, s.agentId, s.tenantId, p.start, p.end)).salesAmount;
  };

  it("оформлен 31 октября, доставлен 2 ноября — в ноябре, а не нигде", async () => {
    await deliveredOrder("2026-10-31T18:00:00+05:00", "2026-11-02T11:00:00+05:00");
    expect(await sales(2026, 10)).toBe(0);
    expect(await sales(2026, 11)).toBe(1000000);
  });

  it("возвращён в работу и доставлен снова — остаётся в месяце первой доставки", async () => {
    const id = await deliveredOrder("2026-10-05T10:00:00+05:00", "2026-10-06T10:00:00+05:00");
    // Возврат в работу в декабре: дата оформления двигается, доставка стирается.
    await db.transaction(async (tx) => {
      await clearDeliveryTrace(tx as never, s.tenantId, id);
      await dateSecondLife(tx as never, s.tenantId, id);
    });
    // Доставили снова — в декабре.
    await db.update(schema.orders).set({ status: "delivered", deliveredAt: new Date("2026-12-10T10:00:00+05:00") } as never)
      .where(eq(schema.orders.id, id));

    const [row] = await db.select({ first: schema.orders.firstDeliveredAt }).from(schema.orders).where(eq(schema.orders.id, id));
    expect(row.first?.toISOString()).toBe(new Date("2026-10-06T10:00:00+05:00").toISOString());
    expect(await sales(2026, 10)).toBe(1000000);
    expect(await sales(2026, 12)).toBe(0);
  });
});
