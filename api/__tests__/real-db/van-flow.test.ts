import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { eq, and } from "drizzle-orm";
import { hasRealDb, connectRealDb, closeRealDb, truncateAll, seed, type ServiceDb, type Seeded } from "./harness";
import * as schema from "@db/schema";

/**
 * Ван-селлинг на настоящей базе: машина заведена → загрузка под PIN водителя
 * (чужой PIN — отказ) → продажа с колёс: заказ доставлен, товар ушёл с
 * машины, деньги на руках у водителя → возврат на склад → пересчёт: чего нет
 * — долг водителя по цене продажи в кассе → заказ с машины в работу не
 * возвращается → без тарифа и без тумблера — отказ.
 */
let current: ServiceDb;
vi.mock("../../queries/connection", () => ({ getDb: () => current, getPool: () => null }));
vi.mock("../../lib/telegram", async (orig) => ({ ...(await orig<object>()), sendTelegram: vi.fn(async () => true), notifyTenantRole: vi.fn(async () => undefined) }));

describe.skipIf(!hasRealDb)("ван-селлинг: загрузка, продажа с колёс, пересчёт", () => {
  let db: ServiceDb;
  let s: Seeded;
  let ceoId = 0;
  const ceo = () => ({ id: ceoId, name: "Директор", role: "ceo" });
  const courier = () => ({ id: s.courierId, name: "Курьер", role: "courier" });
  const stockOf = async (warehouseId: number, productId: number) => {
    const [r] = await (db as any).select({ a: schema.warehouseStock.available }).from(schema.warehouseStock)
      .where(and(eq(schema.warehouseStock.warehouseId, warehouseId), eq(schema.warehouseStock.productId, productId)));
    return Number(r?.a ?? 0);
  };

  beforeAll(async () => { db = await connectRealDb(); current = db; }, 180_000);
  afterAll(async () => { await closeRealDb(); });
  beforeEach(async () => {
    await truncateAll();
    s = await seed("10.000");
    const [c] = await (db as any).insert(schema.users).values({ tenantId: s.tenantId, name: "Директор", email: "ceo@test.local", passwordHash: "x", role: "ceo" });
    ceoId = Number(c.insertId);
    await (db as any).insert(schema.settings).values({ tenantId: s.tenantId, companyName: "Тест", vanSellingEnabled: true }).catch(() => {});
    await (db as any).update(schema.settings).set({ vanSellingEnabled: true }).where(eq(schema.settings.tenantId, s.tenantId));
  });

  it("машина → загрузка под PIN → продажа → возврат → пересчёт с недостачей → долг водителя", async () => {
    const { VanService, assertVanSelling } = await import("../../services/van");
    const { CashService, ACCOUNT, ledgerBalances, balanceOf } = await import("../../services/cash");
    const { assertReopenable } = await import("../../services/order-reopen");
    await CashService.setPin(db as any, s.tenantId, s.courierId, "2468");

    // Заведена с водителем-курьером; оператора водителем сделать нельзя.
    const { id: vanId } = await VanService.save(db as any, s.tenantId, ceo(), { name: "Газель 1", plate: "01 a 123 aa", driverId: s.courierId });
    await expect(VanService.save(db as any, s.tenantId, ceo(), { name: "Другая", driverId: ceoId })).rejects.toThrow(/курьер, агент или супервайзер/);
    const [van] = await (db as any).select().from(schema.warehouses).where(eq(schema.warehouses.id, vanId));
    expect(van).toMatchObject({ kind: "van", plate: "01 A 123 AA", driverId: s.courierId, isDefault: false });

    // Загрузка: без подписи — отказ, чужой PIN — отказ, свой — товар в машине, перемещение помнит, кто принял.
    const items = [{ productId: s.productId, quantity: 6 }];
    await expect(VanService.load(db as any, s.tenantId, ceo(), { vanId, items })).rejects.toThrow(/PIN-кодом/);
    await expect(VanService.load(db as any, s.tenantId, ceo(), { vanId, items, pin: "0000" })).rejects.toThrow(/PIN не подошёл/);
    await VanService.load(db as any, s.tenantId, ceo(), { vanId, items, pin: "2468" });
    expect(await stockOf(vanId, s.productId)).toBe(6);
    expect(await stockOf(s.warehouseId, s.productId)).toBe(4);
    const [tr] = await (db as any).select().from(schema.stockTransfers).where(eq(schema.stockTransfers.toWarehouseId, vanId));
    expect(tr.acceptedBy).toBe(s.courierId);
    expect(tr.acceptedAt).not.toBeNull();
    // Больше, чем на складе — отказ по имени товара.
    await expect(VanService.load(db as any, s.tenantId, ceo(), { vanId, items: [{ productId: s.productId, quantity: 5 }], paperSigned: true })).rejects.toThrow(/Недостаточно товара.*Товар/);

    // Продажа с колёс: агент чужой машиной не торгует; водитель — да.
    await expect(VanService.sale(db as any, s.tenantId, { id: s.agentId, name: "Агент", role: "agent" }, { vanId, shopId: s.shopId, items: [{ productId: s.productId, quantity: "2" }], paymentMethod: "cash" })).rejects.toThrow(/продаёт её водитель/);
    const sale = await VanService.sale(db as any, s.tenantId, courier(), { vanId, shopId: s.shopId, items: [{ productId: s.productId, quantity: "2" }], paymentMethod: "cash", idempotencyKey: "van-1" });
    expect(sale).toMatchObject({ total: 200, paid: 200, idempotent: false });
    expect(sale.orderNumber).toMatch(/^№\d+$/);
    // Повтор с тем же ключом — тот же заказ, второй продажи нет.
    const again = await VanService.sale(db as any, s.tenantId, courier(), { vanId, shopId: s.shopId, items: [{ productId: s.productId, quantity: "2" }], paymentMethod: "cash", idempotencyKey: "van-1" });
    expect(again).toMatchObject({ id: sale.id, idempotent: true });
    expect(await stockOf(vanId, s.productId)).toBe(4);
    expect(await stockOf(s.warehouseId, s.productId)).toBe(4); // основной склад не тронут
    const [order] = await (db as any).select().from(schema.orders).where(eq(schema.orders.id, sale.id));
    expect(order).toMatchObject({ status: "delivered", deliveryStatus: "delivered", warehouseId: vanId, agentId: s.courierId, courierId: s.courierId, paymentMethod: "cash", deliveryResult: "paid" });
    const [pay] = await (db as any).select().from(schema.payments).where(eq(schema.payments.orderId, sale.id));
    expect(pay).toMatchObject({ amount: "200.00", paymentMethod: "cash", createdBy: s.courierId });
    // Наличные — на руках у водителя, как у любой доставки.
    let b = await ledgerBalances(db as any, s.tenantId);
    expect(balanceOf(b, ACCOUNT.employee(s.courierId))).toBe(200);

    // Больше, чем в машине — отказ по имени; в долг сверх лимита — отказ.
    await expect(VanService.sale(db as any, s.tenantId, courier(), { vanId, shopId: s.shopId, items: [{ productId: s.productId, quantity: "5" }], paymentMethod: "cash" })).rejects.toThrow(/«Товар»: в машине 4/);
    await (db as any).update(schema.shops).set({ creditLimit: "100.00" }).where(eq(schema.shops.id, s.shopId));
    await expect(VanService.sale(db as any, s.tenantId, courier(), { vanId, shopId: s.shopId, items: [{ productId: s.productId, quantity: "2" }], paymentMethod: "debt" })).rejects.toThrow(/Кредитный лимит/);

    // Заказ с машины в работу не возвращается.
    await (db as any).transaction(async (tx: any) => {
      await expect(assertReopenable(tx, s.tenantId, sale.id, sale.orderNumber)).rejects.toThrow(/продажа с машины/);
    });

    // Вернул 3 на склад; в машине 1, а в кузове по пересчёту 0 → недостача 100 долгом водителя.
    await VanService.unload(db as any, s.tenantId, ceo(), { vanId, items: [{ productId: s.productId, quantity: 3 }] });
    expect(await stockOf(s.warehouseId, s.productId)).toBe(7);
    expect(await stockOf(vanId, s.productId)).toBe(1);
    const c = await VanService.count(db as any, s.tenantId, ceo(), { vanId, counted: [{ productId: s.productId, quantity: 0 }] });
    expect(c.shortage).toBe(100);
    expect(c.docId).not.toBeNull();
    expect(await stockOf(vanId, s.productId)).toBe(0);
    b = await ledgerBalances(db as any, s.tenantId);
    expect(balanceOf(b, ACCOUNT.employeeDebt(s.courierId))).toBe(100);
    expect(balanceOf(b, ACCOUNT.stockShortage(vanId))).toBe(-100);
    const o = await CashService.overview(db as any, s.tenantId);
    expect(o.holders.find(h => h.id === s.courierId)).toMatchObject({ onHand: 200, debt: 100 });
    expect(o.ledgerSum).toBe(0);
    // Пересчёт «всё сошлось» долга не рождает; товар, которого не было, — отказ.
    expect((await VanService.count(db as any, s.tenantId, ceo(), { vanId, counted: [{ productId: s.productId, quantity: 0 }] })).shortage).toBe(0);
    await expect(VanService.count(db as any, s.tenantId, ceo(), { vanId, counted: [{ productId: s.secondProductId, quantity: 1 }] })).rejects.toThrow(/которого на машине не было/);

    // Список: водитель видит свою, чужой курьер — ничего; продажи за срок — одна.
    expect((await VanService.list(db as any, s.tenantId, s.courierId)).map(v => v.id)).toEqual([vanId]);
    expect(await VanService.list(db as any, s.tenantId, s.agentId)).toEqual([]);
    const sales = await VanService.sales(db as any, s.tenantId, { from: new Date(Date.now() - 86_400_000), to: new Date(Date.now() + 86_400_000) });
    expect(sales.map(x => x.id)).toEqual([sale.id]);

    // Журнал действий помнит всё.
    const actions = (await (db as any).select({ a: schema.auditLog.action }).from(schema.auditLog).where(eq(schema.auditLog.tenantId, s.tenantId))).map((r: any) => r.a);
    for (const a of ["van.created", "van.loaded", "van.sale", "van.unloaded", "van.counted", "stock.transfer_completed"]) expect(actions, a).toContain(a);

    // Тариф и тумблер.
    await expect(assertVanSelling(db as any, s.tenantId, "basic")).rejects.toThrow(/Pro и Exclusive/);
    await (db as any).update(schema.settings).set({ vanSellingEnabled: false }).where(eq(schema.settings.tenantId, s.tenantId));
    await expect(assertVanSelling(db as any, s.tenantId, "pro")).rejects.toThrow(/выключен/);
  });
});
