/**
 * Склад заказа живёт в заказе — на настоящей базе.
 *
 * Заказ резервирует на складе по умолчанию и запоминает его. Потом умолчание
 * переставляют на другой склад (прямо в базе — роутер такое при открытых
 * заказах запретит), и каждый путь всё равно работает с ПЕРВЫМ складом:
 * отмена снимает резерв с него, удаление и восстановление — тоже, доставка
 * списывает с него, а второй склад не трогается вовсе. Заказ без записи
 * (до колонки) идёт по умолчанию. Здесь же гонка кредитного лимита: два
 * заказа «в долг» одновременно — под лимит проходит ровно один.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { eq, and, sql } from "drizzle-orm";
import * as schema from "@db/schema";
import { OrderService } from "../../services/order";
import { recalcShopDebt } from "../../services/shop-debt";
import {
  hasRealDb, connectRealDb, closeRealDb, truncateAll, seed, countOf,
  type ServiceDb, type Seeded,
} from "./harness";

const describeIf = hasRealDb ? describe : describe.skip;

describeIf("склад заказа", () => {
  let db: ServiceDb;
  let s: Seeded;
  let secondWh = 0;

  beforeAll(async () => { db = await connectRealDb(); });
  afterAll(async () => { await closeRealDb(); });
  beforeEach(async () => {
    await truncateAll(); s = await seed("10.000");
    const [w] = await db.insert(schema.warehouses).values({ tenantId: s.tenantId, name: "Второй", isDefault: false } as never);
    secondWh = Number(w.insertId);
    await db.insert(schema.warehouseStock).values({ tenantId: s.tenantId, productId: s.productId, warehouseId: secondWh, currentStock: "5.000", reserved: "0.000", available: "5.000" } as never);
  });

  const stockAt = async (warehouseId: number) => {
    const [r] = await db.select({ c: schema.warehouseStock.currentStock, r: schema.warehouseStock.reserved, a: schema.warehouseStock.available })
      .from(schema.warehouseStock).where(and(eq(schema.warehouseStock.productId, s.productId), eq(schema.warehouseStock.warehouseId, warehouseId)));
    return { current: Number(r!.c), reserved: Number(r!.r), available: Number(r!.a) };
  };
  const create = (key: string) => OrderService.create(db, s.tenantId, s.agentId, { shopId: s.shopId, items: [{ productId: s.productId, quantity: "3" }], idempotencyKey: key });
  const flipDefault = () => Promise.all([
    db.update(schema.warehouses).set({ isDefault: false }).where(eq(schema.warehouses.id, s.warehouseId)),
    db.update(schema.warehouses).set({ isDefault: true }).where(eq(schema.warehouses.id, secondWh)),
  ]);

  it("оформление пишет склад резерва; отмена после смены умолчания снимает резерв с него", async () => {
    const { id } = await create("wh-1");
    const [o] = await db.select({ warehouseId: schema.orders.warehouseId }).from(schema.orders).where(eq(schema.orders.id, id));
    expect(Number(o!.warehouseId)).toBe(s.warehouseId);
    expect(await stockAt(s.warehouseId)).toEqual({ current: 10, reserved: 3, available: 7 });

    await flipDefault();
    await OrderService.cancel(db, s.tenantId, id, { userId: s.agentId, userRole: "ceo" });
    expect(await stockAt(s.warehouseId)).toEqual({ current: 10, reserved: 0, available: 10 });
    expect(await stockAt(secondWh)).toEqual({ current: 5, reserved: 0, available: 5 });
  });

  it("удаление и восстановление — по складу заказа", async () => {
    const { id } = await create("wh-2");
    await flipDefault();
    await OrderService.delete(db, s.tenantId, id, { id: s.agentId, role: "ceo" });
    expect(await stockAt(s.warehouseId)).toEqual({ current: 10, reserved: 0, available: 10 });
    await OrderService.restore(db, s.tenantId, id, { id: s.agentId, role: "ceo" });
    expect(await stockAt(s.warehouseId)).toEqual({ current: 10, reserved: 3, available: 7 });
    expect(await stockAt(secondWh)).toEqual({ current: 5, reserved: 0, available: 5 });
  });

  it("доставка по частям списывает со склада заказа; без умолчания у старого заказа — отказ, не молчание", async () => {
    const { id } = await create("wh-3");
    await flipDefault();
    const [line] = await db.select({ id: schema.orderItems.id }).from(schema.orderItems).where(eq(schema.orderItems.orderId, id));
    await OrderService.recordDeliveryAndPayment(db, s.tenantId, { id: s.agentId, role: "ceo" }, {
      orderId: id, deliveredItems: [{ itemId: line!.id, deliveredQuantity: 2, returnReason: "не взяли" }],
      payment: { paidAmount: "200", method: "cash" },
    });
    expect(await stockAt(s.warehouseId)).toEqual({ current: 8, reserved: 0, available: 8 });
    expect(await stockAt(secondWh)).toEqual({ current: 5, reserved: 0, available: 5 });

    // Заказ до колонки: склад не записан, умолчания нет — отказ, а не delivered без списания.
    const { id: old } = await create("wh-3b");
    await db.update(schema.orders).set({ warehouseId: null }).where(eq(schema.orders.id, old));
    await db.update(schema.warehouses).set({ isDefault: false }).where(eq(schema.warehouses.tenantId, s.tenantId));
    const [oldLine] = await db.select({ id: schema.orderItems.id }).from(schema.orderItems).where(eq(schema.orderItems.orderId, old));
    await expect(OrderService.recordDeliveryAndPayment(db, s.tenantId, { id: s.agentId, role: "ceo" }, {
      orderId: old, deliveredItems: [{ itemId: oldLine!.id, deliveredQuantity: 3 }], payment: { paidAmount: "300", method: "cash" },
    })).rejects.toThrow("Склад по умолчанию не найден");
    const [still] = await db.select({ status: schema.orders.status }).from(schema.orders).where(eq(schema.orders.id, old));
    expect(still!.status).toBe("new");
  });

  it("статус new → delivered без записи склада идёт по умолчанию", async () => {
    const { id } = await create("wh-4");
    await db.update(schema.orders).set({ warehouseId: null }).where(eq(schema.orders.id, id));
    await OrderService.updateStatus(db, s.tenantId, id, "delivered", { id: s.agentId, role: "ceo" });
    expect(await stockAt(s.warehouseId)).toEqual({ current: 7, reserved: 0, available: 7 });
  });
});

describeIf("гонка кредитного лимита", () => {
  let db: ServiceDb;
  let s: Seeded;

  beforeAll(async () => { db = await connectRealDb(); });
  afterAll(async () => { await closeRealDb(); });
  beforeEach(async () => {
    await truncateAll(); s = await seed("1000.000");
    await db.update(schema.shops).set({ creditLimit: "500.00" }).where(eq(schema.shops.id, s.shopId));
    await db.transaction(tx => recalcShopDebt(tx, s.tenantId, s.shopId));
  });

  it("два заказа «в долг» по 300 одновременно при лимите 500 — проходит ровно один", async () => {
    const order = (key: string) => OrderService.create(db, s.tenantId, s.agentId, {
      shopId: s.shopId, items: [{ productId: s.productId, quantity: "3" }], paymentMethod: "debt", idempotencyKey: key,
    });
    const results = await Promise.allSettled([order("race-1"), order("race-2")]);
    const ok = results.filter(r => r.status === "fulfilled");
    const failed = results.filter(r => r.status === "rejected") as PromiseRejectedResult[];
    expect(ok.length).toBe(1);
    expect(failed.length).toBe(1);
    expect(String(failed[0].reason?.message)).toMatch(/Кредитный лимит магазина .* превышен: долг 300 \+ заказ 300/);
    expect(await countOf("orders", "payment_method = 'debt'")).toBe(1);
    const [shop] = await db.select({ debt: schema.shops.debt }).from(schema.shops).where(eq(schema.shops.id, s.shopId));
    expect(Number(shop!.debt)).toBe(300);
    // Оставшийся резерв — только под один заказ.
    const [st] = await db.execute(sql`SELECT reserved AS r FROM warehouse_stock WHERE product_id = ${s.productId} LIMIT 1`) as unknown as [Array<{ r: string }>, unknown];
    expect(Number(st[0]!.r)).toBe(3);
  });
});
