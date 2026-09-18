import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { eq, and } from "drizzle-orm";
import { hasRealDb, connectRealDb, closeRealDb, truncateAll, seed, type ServiceDb, type Seeded } from "./harness";
import * as schema from "@db/schema";

/**
 * Безнал на настоящей базе: курьер записал перевод и карту → оба «в пути»,
 * старый — «просрочен» → курьер сам подтвердить не может → кассир
 * подтверждает пакетом с номером выписки → повтор отвергается → «не пришло»
 * — сторно, и платёж уходит из списка ожидающих → наличные сюда не попадают
 * → сводка по людям и кошелёк сотрудника сходятся → журнал действий помнит,
 * кто записал.
 */
let current: ServiceDb;
vi.mock("../../queries/connection", () => ({ getDb: () => current, getPool: () => null }));
vi.mock("../../lib/telegram", async (orig) => ({ ...(await orig<object>()), sendTelegram: vi.fn(async () => true), notifyTenantRole: vi.fn(async () => undefined) }));

describe.skipIf(!hasRealDb)("безнал: в пути, подтверждение выпиской, сторно", () => {
  let db: ServiceDb;
  let s: Seeded;
  let ceoId = 0, operatorId = 0;
  const now = new Date("2026-09-16T09:00:00Z");
  const pay = (over: Partial<typeof schema.payments.$inferInsert>) => (db as any).insert(schema.payments).values({
    tenantId: s.tenantId, shopId: s.shopId, amount: "100000.00", type: "payment", paymentMethod: "transfer", createdBy: s.courierId, createdAt: now, ...over,
  }).then((r: any) => Number(r[0].insertId));

  beforeAll(async () => { db = await connectRealDb(); current = db; }, 180_000);
  afterAll(async () => { await closeRealDb(); });
  beforeEach(async () => {
    await truncateAll();
    s = await seed("10.000");
    const [ceo] = await (db as any).insert(schema.users).values({ tenantId: s.tenantId, name: "Директор", email: "ceo@test.local", passwordHash: "x", role: "ceo" });
    ceoId = Number(ceo.insertId);
    const [op] = await (db as any).insert(schema.users).values({ tenantId: s.tenantId, name: "Кассир", email: "op@test.local", passwordHash: "x", role: "operator" });
    operatorId = Number(op.insertId);
    await (db as any).insert(schema.settings).values({ tenantId: s.tenantId, companyName: "Тест", bankConfirmDays: 3 }).catch(() => {});
  });

  const courier = () => ({ id: s.courierId, name: "Курьер", role: "courier" });
  const cashier = () => ({ id: operatorId, name: "Кассир", role: "operator" });
  const ceo = () => ({ id: ceoId, name: "Директор", role: "ceo" });

  it("перевод ждёт выписки, свой не подтверждается, кассир подтверждает пакетом, не пришло — сторно", async () => {
    const { NonCashService } = await import("../../services/noncash");
    const { PaymentService } = await import("../../services/payment");

    const fresh = await pay({});
    const card = await pay({ paymentMethod: "card", amount: "50000.00" });
    const stale = await pay({ createdAt: new Date("2026-09-10T09:00:00Z"), amount: "70000.00" });
    const cash = await pay({ paymentMethod: "cash", amount: "999.00" });
    const byCeo = await pay({ createdBy: ceoId, amount: "20000.00" });

    // Сводка: три в пути (свежий, карта, директорский), один просрочен; наличные — не здесь.
    let sum = await NonCashService.summary(db as any, s.tenantId, now);
    expect(sum).toMatchObject({ days: 3, transit: { count: 3, total: 170_000 }, overdue: { count: 1, total: 70_000 } });
    expect(sum.byEmployee[0]).toMatchObject({ name: "Курьер", count: 3, total: 220_000, overdueCount: 1, overdueTotal: 70_000 });

    const list = await NonCashService.list(db as any, s.tenantId, { from: new Date("2026-09-01T00:00:00Z"), to: new Date("2026-09-17T00:00:00Z") }, now);
    expect(list.rows.map(r => r.id).sort()).toEqual([fresh, card, stale, byCeo].sort());
    expect(list.rows.find(r => r.id === stale)?.state).toBe("overdue");
    expect(list.rows.find(r => r.id === card)?.state).toBe("transit");
    expect(list.totals).toMatchObject({ card: 50_000, transfer: 190_000, transit: 170_000, overdue: 70_000, confirmed: 0 });
    expect(list.rows.every(r => r.id !== cash)).toBe(true);

    // Курьер сам себе «пришло» не ставит; кассир — чужие может, свои директорские тоже (он не автор).
    await expect(NonCashService.confirm(db as any, s.tenantId, courier(), { ids: [fresh] }, now)).rejects.toThrow(/свой же платёж/);
    await expect(NonCashService.confirm(db as any, s.tenantId, cashier(), { ids: [cash] }, now)).rejects.toThrow(/не карта и не перевод/);
    const r = await NonCashService.confirm(db as any, s.tenantId, cashier(), { ids: [fresh, card, byCeo], bankRef: " ВЫП-0916 " }, now);
    expect(r).toEqual({ confirmed: 3, total: 170_000 });
    await expect(NonCashService.confirm(db as any, s.tenantId, cashier(), { ids: [fresh] }, now)).rejects.toThrow(/уже подтверждён/);

    const [row] = await (db as any).select().from(schema.payments).where(eq(schema.payments.id, fresh));
    expect(row.bankConfirmedBy).toBe(operatorId);
    expect(row.bankRef).toBe("ВЫП-0916");
    expect(row.bankConfirmedAt).toEqual(now);

    // Директор может подтвердить и свой; здесь — чужой просроченный он не подтверждает, а сторнирует: денег нет.
    await PaymentService.reverse(db as any, s.tenantId, { paymentId: stale, reason: "в выписке нет", actor: cashier() });
    await expect(NonCashService.confirm(db as any, s.tenantId, ceo(), { ids: [stale] }, now)).rejects.toThrow(/сторнирован/);

    sum = await NonCashService.summary(db as any, s.tenantId, now);
    expect(sum.transit).toEqual({ count: 0, total: 0 });
    expect(sum.overdue).toEqual({ count: 0, total: 0 });
    expect(sum.confirmedToday).toEqual({ count: 3, total: 170_000 });
    expect(sum.byEmployee).toEqual([]);

    const after = await NonCashService.list(db as any, s.tenantId, { from: new Date("2026-09-01T00:00:00Z"), to: new Date("2026-09-17T00:00:00Z"), status: "reversed" }, now);
    expect(after.rows.map(r => r.id)).toEqual([stale]);
    expect(after.totals.transfer).toBe(120_000); // сторно в оборот не входит

    // Кошелёк курьера: переводов в пути не осталось.
    expect(await NonCashService.mineTransit(db as any, s.tenantId, s.courierId)).toEqual({ count: 0, total: 0 });

    // Журнал: три подтверждения, с автором платежа по имени.
    const audit = await (db as any).select().from(schema.auditLog)
      .where(and(eq(schema.auditLog.tenantId, s.tenantId), eq(schema.auditLog.action, "payment.bank_confirm")));
    expect(audit).toHaveLength(3);
    expect(audit.find((a: any) => a.targetId === byCeo)?.meta).toMatchObject({ amount: "20000.00", method: "transfer", bankRef: "ВЫП-0916", recordedBy: "Директор" });
  });

  it("директор подтверждает свой; переводы сотрудника в пути видны в сводке по людям", async () => {
    const { NonCashService } = await import("../../services/noncash");
    const mine = await pay({ createdBy: ceoId });
    await pay({ amount: "40000.00" });
    expect(await NonCashService.confirm(db as any, s.tenantId, ceo(), { ids: [mine] }, now)).toEqual({ confirmed: 1, total: 100_000 });
    const sum = await NonCashService.summary(db as any, s.tenantId, now);
    expect(sum.byEmployee.find(e => e.id === s.courierId)).toMatchObject({ count: 1, total: 40_000 });
  });
});
