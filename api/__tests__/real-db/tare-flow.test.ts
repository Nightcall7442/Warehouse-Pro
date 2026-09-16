import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { eq, and } from "drizzle-orm";
import { hasRealDb, connectRealDb, closeRealDb, truncateAll, seed, type ServiceDb, type Seeded } from "./harness";
import * as schema from "@db/schema";

/**
 * Возвратная тара на настоящей базе, оба режима сразу: кега с залогом и
 * ящик «только штуками». Тара следует за товаром через единственную дверь
 * остатка: приход → склад; загрузка машины → с склада в кузов; продажа с
 * колёс → с кузова магазину. Приём пустой тары — не больше, чем числится;
 * невозвращённая — в долг магазина по залогу (ноль залога — долга нет,
 * штуки снимаются); пересчёт машины кладёт недостачу тары по залогу в тот
 * же долг водителя. Без тарифа и без тумблера — отказ.
 */
let current: ServiceDb;
vi.mock("../../queries/connection", () => ({ getDb: () => current, getPool: () => null }));
vi.mock("../../lib/telegram", async (orig) => ({ ...(await orig<object>()), sendTelegram: vi.fn(async () => true), notifyTenantRole: vi.fn(async () => undefined) }));

describe.skipIf(!hasRealDb)("тара: штуки и залог, следом за товаром", () => {
  let db: ServiceDb;
  let s: Seeded;
  let ceoId = 0;
  const ceo = () => ({ id: ceoId, name: "Директор", role: "ceo" });
  const courier = () => ({ id: s.courierId, name: "Курьер", role: "courier" });
  const held = async (kind: "warehouse" | "shop", id: number, tareTypeId: number) => {
    const rows = await (db as any).select({ d: schema.tareMovements.delta }).from(schema.tareMovements)
      .where(and(eq(schema.tareMovements.holderKind, kind), eq(schema.tareMovements.holderId, id), eq(schema.tareMovements.tareTypeId, tareTypeId)));
    return Math.round(rows.reduce((a: number, r: any) => a + Number(r.d), 0) * 1000) / 1000;
  };

  beforeAll(async () => { db = await connectRealDb(); current = db; }, 180_000);
  afterAll(async () => { await closeRealDb(); });
  beforeEach(async () => {
    await truncateAll();
    s = await seed("10.000");
    const [c] = await (db as any).insert(schema.users).values({ tenantId: s.tenantId, name: "Директор", email: "ceo@test.local", passwordHash: "x", role: "ceo" });
    ceoId = Number(c.insertId);
    await (db as any).insert(schema.settings).values({ tenantId: s.tenantId, companyName: "Тест", vanSellingEnabled: true, tareEnabled: true }).catch(() => {});
    await (db as any).update(schema.settings).set({ vanSellingEnabled: true, tareEnabled: true }).where(eq(schema.settings.tenantId, s.tenantId));
  });

  it("виды → тара товара → приход → машина → продажа → приём → списание в долг → пересчёт", async () => {
    const { TareService, assertTare } = await import("../../services/tare");
    const { VanService } = await import("../../services/van");
    const { CashService, ACCOUNT, ledgerBalances, balanceOf } = await import("../../services/cash");
    const { recordStockMovement } = await import("../../services/stock-ledger");

    // Два вида: кега с залогом и ящик только штуками. Отрицательный залог и пустое имя — отказ.
    const { id: keg } = await TareService.saveType(db as any, s.tenantId, ceo(), { name: "Кега 50 л", depositPrice: 50000 });
    const { id: box } = await TareService.saveType(db as any, s.tenantId, ceo(), { name: "Ящик", depositPrice: 0 });
    await expect(TareService.saveType(db as any, s.tenantId, ceo(), { name: "Бутылка", depositPrice: -1 })).rejects.toThrow(/отрицательным/);
    await expect(TareService.saveType(db as any, s.tenantId, ceo(), { name: "  ", depositPrice: 0 })).rejects.toThrow(/название/);
    expect((await TareService.types(db as any, s.tenantId)).map(t => [t.name, t.depositPrice])).toEqual([["Кега 50 л", 50000], ["Ящик", 0]]);

    // Тара товара: «Товар» — 2 кеги на единицу; «Второй товар» — 1 ящик. Ноль на единицу — отказ; чужой вид — отказ.
    await TareService.setProductTare(db as any, s.tenantId, ceo(), { productId: s.productId, tareTypeId: keg, perUnit: 2 });
    await TareService.setProductTare(db as any, s.tenantId, ceo(), { productId: s.secondProductId, tareTypeId: box, perUnit: 1 });
    await expect(TareService.setProductTare(db as any, s.tenantId, ceo(), { productId: s.productId, tareTypeId: keg, perUnit: 0 })).rejects.toThrow(/больше нуля/);
    await expect(TareService.setProductTare(db as any, s.tenantId, ceo(), { productId: s.productId, tareTypeId: 999, perUnit: 1 })).rejects.toThrow(/не найден/);
    const [p] = await (db as any).select({ t: schema.products.tareTypeId, u: schema.products.tarePerUnit }).from(schema.products).where(eq(schema.products.id, s.productId));
    expect(p).toEqual({ t: keg, u: "2.000" });

    // Приход 5 «Товара» через дверь остатка — на складе 10 кег; приход без тары у товара — молчит.
    await (db as any).transaction(async (tx: any) => {
      await recordStockMovement(tx, { tenantId: s.tenantId, warehouseId: s.warehouseId, productId: s.productId, type: "in", quantity: 5, reason: "arrival", referenceId: null });
    });
    expect(await held("warehouse", s.warehouseId, keg)).toBe(10);
    expect(await held("warehouse", s.warehouseId, box)).toBe(0);

    // Машина: загрузка 3 «Товара» и 2 «Второго» — тара едет следом.
    await CashService.setPin(db as any, s.tenantId, s.courierId, "2468");
    const { id: vanId } = await VanService.save(db as any, s.tenantId, ceo(), { name: "Газель", driverId: s.courierId });
    await VanService.load(db as any, s.tenantId, ceo(), { vanId, items: [{ productId: s.productId, quantity: 3 }, { productId: s.secondProductId, quantity: 2 }], pin: "2468" });
    expect(await held("warehouse", s.warehouseId, keg)).toBe(4);
    expect(await held("warehouse", vanId, keg)).toBe(6);
    expect(await held("warehouse", vanId, box)).toBe(2);

    // Продажа с колёс: 2 «Товара» и 1 «Второй» — 4 кеги и 1 ящик уехали магазину.
    const sale = await VanService.sale(db as any, s.tenantId, courier(), { vanId, shopId: s.shopId, items: [{ productId: s.productId, quantity: "2" }, { productId: s.secondProductId, quantity: "1" }], paymentMethod: "cash" });
    expect(await held("warehouse", vanId, keg)).toBe(2);
    expect(await held("shop", s.shopId, keg)).toBe(4);
    expect(await held("shop", s.shopId, box)).toBe(1);
    const follow = await (db as any).select().from(schema.tareMovements).where(and(eq(schema.tareMovements.reason, "follow"), eq(schema.tareMovements.referenceId, sale.id)));
    expect(follow).toHaveLength(4);
    const shopTare = await TareService.shop(db as any, s.tenantId, s.shopId);
    expect([...shopTare].sort((a, b) => a.tareTypeId - b.tareTypeId).map(x => [x.name, x.qty, x.deposit])).toEqual([["Кега 50 л", 4, 200000], ["Ящик", 1, 0]]);
    const ov = await TareService.overview(db as any, s.tenantId);
    expect(ov.totals).toEqual({ atShops: 5, depositAtShops: 200000 });
    expect(ov.warehouses.find(w => w.id === vanId)).toMatchObject({ van: true, units: 3 });

    // Приём пустой тары: больше, чем числится — отказ по имени магазина; одну кегу на склад.
    await expect(TareService.returnFromShop(db as any, s.tenantId, ceo(), { shopId: s.shopId, warehouseId: s.warehouseId, items: [{ tareTypeId: keg, quantity: 5 }] })).rejects.toThrow(/«Магазин Альфа» числится 4 Кега 50 л — принять 5 нельзя/);
    await expect(TareService.returnFromShop(db as any, s.tenantId, ceo(), { shopId: s.shopId, warehouseId: s.warehouseId, items: [{ tareTypeId: keg, quantity: 0 }] })).rejects.toThrow(/сколько тары вернулось/);
    expect(await TareService.returnFromShop(db as any, s.tenantId, ceo(), { shopId: s.shopId, warehouseId: s.warehouseId, items: [{ tareTypeId: keg, quantity: 1 }], note: "привёз сам" })).toEqual({ units: 1 });
    expect(await held("shop", s.shopId, keg)).toBe(3);
    expect(await held("warehouse", s.warehouseId, keg)).toBe(5);

    // Невозвращённая тара: без причины — отказ; 2 кеги → долг магазина 100 000 обычной строкой долга; ящик → штуки снимаются, денег нет.
    await expect(TareService.charge(db as any, s.tenantId, ceo(), { shopId: s.shopId, tareTypeId: keg, quantity: 2, reason: " " })).rejects.toThrow(/без причины/);
    await expect(TareService.charge(db as any, s.tenantId, ceo(), { shopId: s.shopId, tareTypeId: keg, quantity: 4, reason: "разбили" })).rejects.toThrow(/числится 3 Кега 50 л — списать 4 нельзя/);
    expect(await TareService.charge(db as any, s.tenantId, ceo(), { shopId: s.shopId, tareTypeId: keg, quantity: 2, reason: "разбили" })).toEqual({ amount: 100000 });
    expect(await TareService.charge(db as any, s.tenantId, ceo(), { shopId: s.shopId, tareTypeId: box, quantity: 1, reason: "потеряли" })).toEqual({ amount: 0 });
    expect(await held("shop", s.shopId, keg)).toBe(1);
    expect(await held("shop", s.shopId, box)).toBe(0);
    const debts = await (db as any).select().from(schema.payments).where(and(eq(schema.payments.shopId, s.shopId), eq(schema.payments.type, "debt")));
    expect(debts).toHaveLength(1);
    expect(debts[0]).toMatchObject({ amount: "100000.00", orderId: null, createdBy: ceoId });
    expect(debts[0].notes).toContain("2 × Кега 50 л по залогу · разбили");
    const [shop] = await (db as any).select({ debt: schema.shops.debt }).from(schema.shops).where(eq(schema.shops.id, s.shopId));
    expect(Number(shop.debt)).toBe(100000);

    // Пересчёт машины: товар сошёлся, кег по факту 1 из 2 — недостача 50 000 по залогу в долг водителя; ящик сошёлся.
    const c = await VanService.count(db as any, s.tenantId, ceo(), { vanId, counted: [{ productId: s.productId, quantity: 1 }, { productId: s.secondProductId, quantity: 1 }], tare: [{ tareTypeId: keg, quantity: 1 }, { tareTypeId: box, quantity: 1 }] });
    expect(c.shortage).toBe(50000);
    expect(c.tare.map(l => [l.name, l.system, l.counted, l.deposit])).toEqual([["Кега 50 л", 2, 1, 50000], ["Ящик", 1, 1, 0]]);
    expect(await held("warehouse", vanId, keg)).toBe(1);
    const b = await ledgerBalances(db as any, s.tenantId);
    expect(balanceOf(b, ACCOUNT.employeeDebt(s.courierId))).toBe(50000);
    expect(balanceOf(b, ACCOUNT.stockShortage(vanId))).toBe(-50000);
    // Неизвестный вид и отрицательное — отказ.
    await expect(VanService.count(db as any, s.tenantId, ceo(), { vanId, counted: [{ productId: s.productId, quantity: 1 }], tare: [{ tareTypeId: 999, quantity: 1 }] })).rejects.toThrow(/Вид тары не найден/);
    await expect(VanService.count(db as any, s.tenantId, ceo(), { vanId, counted: [{ productId: s.productId, quantity: 1 }], tare: [{ tareTypeId: keg, quantity: -1 }] })).rejects.toThrow(/отрицательным/);

    // Журнал движений: причины на месте; журнал действий помнит всё.
    const mv = await TareService.movements(db as any, s.tenantId, { from: new Date(Date.now() - 86_400_000), to: new Date(Date.now() + 86_400_000) });
    const reasons = new Set(mv.map(m => m.reason));
    for (const r of ["follow", "return", "charge", "count"]) expect([...reasons], r).toContain(r);
    expect(mv.every(m => m.tareName.length > 0)).toBe(true);
    const actions = (await (db as any).select({ a: schema.auditLog.action }).from(schema.auditLog).where(eq(schema.auditLog.tenantId, s.tenantId))).map((r: any) => r.a);
    for (const a of ["tare.type_created", "tare.product_set", "tare.returned", "tare.charged", "van.counted"]) expect(actions, a).toContain(a);

    // Тариф и тумблер.
    await expect(assertTare(db as any, s.tenantId, "basic")).rejects.toThrow(/Pro и Exclusive/);
    await (db as any).update(schema.settings).set({ tareEnabled: false }).where(eq(schema.settings.tenantId, s.tenantId));
    await expect(assertTare(db as any, s.tenantId, "pro")).rejects.toThrow(/выключен/);
  });
});
