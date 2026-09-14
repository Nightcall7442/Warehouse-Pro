import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { eq, and } from "drizzle-orm";
import * as schema from "@db/schema";
import { hasRealDb, connectRealDb, closeRealDb, truncateAll, seed, countOf, type ServiceDb, type Seeded } from "./harness";
import { FakeOneC } from "../helpers/fake-onec";
import { seal } from "../../lib/secret-box";
import { PRESETS } from "../../lib/onec-presets";

/**
 * Обмен с 1С целиком на настоящей базе: настройки → контрагенты → очередь →
 * журнал → крон. 1С — эмулятор OData (helpers/fake-onec.ts), всё остальное
 * настоящее: клиент, пресет, журнал с повторами, связи id_mappings.
 */
let current: ServiceDb;
vi.mock("../../queries/connection", () => ({ getDb: () => current, getPool: () => null }));
const { fake } = vi.hoisted(() => ({ fake: { current: null as null | { fetch: (u: string, i?: RequestInit) => Promise<Response> } } }));
vi.mock("../../lib/safe-fetch", () => ({ safeFetch: (u: string, i?: RequestInit) => fake.current!.fetch(u, i) }));

import { oneCSync } from "../../services/onec-sync";
import { syncCounterparties, createCounterpartyFor, unmappedShops } from "../../services/onec-counterparties";
import { OnecJournal } from "../../services/onec-journal";
import { clearBridgeCache } from "../../lib/onec-bridge";

const N = PRESETS.bp_uz;

describe.skipIf(!hasRealDb)("обмен с 1С на настоящей базе", () => {
  let db: ServiceDb;
  let s: Seeded;
  let onec: FakeOneC;
  let org: Record<string, unknown>;

  beforeAll(async () => { db = await connectRealDb(); current = db; }, 180_000);
  afterAll(async () => { await closeRealDb(); });

  beforeEach(async () => {
    await truncateAll();
    clearBridgeCache();
    s = await seed("10.000");
    onec = new FakeOneC();
    fake.current = onec;
    org = onec.add(N.organizations.set, { Description: "ООО Ромашка" });
    const wh = onec.add(N.warehouses.set, { Description: "Основной" });
    const pt = onec.add(N.priceTypes.set, { Description: "Оптовая" });
    await db.insert(schema.onecConfig).values({
      tenantId: s.tenantId, url: "http://onec.example.test/base", username: "odata", password: seal("secret"),
      preset: "bp_uz", organizationKey: String(org.Ref_Key), warehouseKey: String(wh.Ref_Key), priceTypeKey: String(pt.Ref_Key),
      enabled: true, intervalMinutes: 5, syncPayments: true,
      // Подключили «вчера»: заказы, доставленные раньше, в очередь не идут.
      createdAt: new Date(Date.now() - 86_400_000),
    });
    // Товары организации сопоставлены с номенклатурой 1С.
    for (const pid of [s.productId, s.secondProductId]) {
      const item = onec.add(N.nomenclature.set, { Description: `Товар ${pid}`, Code: String(pid), Артикул: `P-${pid}` });
      await db.insert(schema.idMappings).values({ tenantId: s.tenantId, entityType: "product", externalId: String(item.Ref_Key), internalId: pid });
    }
  });

  async function deliveredOrder(deliveredAt = new Date()) {
    const [o] = await db.insert(schema.orders).values({
      tenantId: s.tenantId, orderNumber: `ORD-${Date.now()}`, shopId: s.shopId, agentId: s.agentId, status: "delivered",
      subtotal: "300.00", total: "300.00", deliveredAt, deliveryStatus: "delivered",
    });
    const orderId = Number(o.insertId);
    await db.insert(schema.orderItems).values({ orderId, productId: s.productId, quantity: "3.00", unitPrice: "100.00", subtotal: "300.00" });
    return orderId;
  }

  it("контрагенты: совпавший по названию магазин связывается сам, остальной — заводится в 1С", async () => {
    const alpha = onec.add(N.counterparties.set, { Description: "Магазин «Альфа»", ИНН: "301111111" });
    await db.insert(schema.shops).values({ tenantId: s.tenantId, name: "Магазин Бета", phone: "+998901234567" });

    const r = await syncCounterparties(s.tenantId);
    expect(r).toMatchObject({ total: 1, matched: 1, unmatched: 1 });
    const [m] = await db.select().from(schema.idMappings).where(and(eq(schema.idMappings.entityType, "shop"), eq(schema.idMappings.internalId, s.shopId)));
    expect(m.externalId).toBe(alpha.Ref_Key);

    const left = await unmappedShops(s.tenantId);
    expect(left.unmapped.map(x => x.name)).toEqual(["Магазин Бета"]);

    const created = await createCounterpartyFor(s.tenantId, left.unmapped[0].id);
    expect(onec.rows(N.counterparties.set).find(c => c.Ref_Key === created.externalId)).toMatchObject({ Description: "Магазин Бета" });
    expect((await unmappedShops(s.tenantId)).unmapped).toEqual([]);
    // Повторный вызов не заводит второго контрагента.
    expect(await createCounterpartyFor(s.tenantId, left.unmapped[0].id)).toEqual(created);
    expect(onec.rows(N.counterparties.set)).toHaveLength(2);
  });

  it("очередь: доставленный после подключения заказ выгружается, старый — нет, отказ ждёт с паузой", async () => {
    await syncCounterparties(s.tenantId); // магазина в 1С нет — не связан
    const fresh = await deliveredOrder();
    await deliveredOrder(new Date(Date.now() - 3 * 86_400_000)); // доставлен до подключения

    expect(await oneCSync.enqueueDelivered(s.tenantId)).toEqual({ orders: 1, payments: 0 });
    // Повторный вызов не дублирует строки журнала.
    expect(await oneCSync.enqueueDelivered(s.tenantId)).toEqual({ orders: 0, payments: 0 });
    expect(await countOf("onec_journal")).toBe(1);

    // Магазин не связан с контрагентом → отказ, попытка записана, следующая — через 5 минут.
    expect(await oneCSync.processQueue(s.tenantId)).toEqual({ processed: 1, done: 0, failed: 1, skipped: 0 });
    const [row] = await db.select().from(schema.onecJournal).where(eq(schema.onecJournal.entityId, fresh));
    expect(row).toMatchObject({ status: "failed", attempts: 1 });
    expect(row.lastError).toMatch(/not mapped to 1C/);
    expect(row.nextAt!.getTime()).toBeGreaterThan(Date.now() + 4 * 60_000);
    // Пауза не истекла — вторая попытка не делается.
    expect(await oneCSync.processQueue(s.tenantId)).toEqual({ processed: 0, done: 0, failed: 0, skipped: 0 });

    // Связали магазин руками и нажали «Повторить» — документ создан и проведён.
    const cp = onec.add(N.counterparties.set, { Description: "Магазин Альфа" });
    await db.insert(schema.idMappings).values({ tenantId: s.tenantId, entityType: "shop", externalId: String(cp.Ref_Key), internalId: s.shopId });
    expect(await OnecJournal.retry(db as never, s.tenantId, row.id)).toBe(true);
    expect(await oneCSync.processQueue(s.tenantId)).toEqual({ processed: 1, done: 1, failed: 0, skipped: 0 });

    const [done] = await db.select().from(schema.onecJournal).where(eq(schema.onecJournal.id, row.id));
    const [doc] = onec.rows(N.sale.set);
    expect(done).toMatchObject({ status: "done", externalId: doc.Ref_Key });
    expect(doc).toMatchObject({ Организация_Key: org.Ref_Key, Контрагент_Key: cp.Ref_Key, Posted: true });
    expect(doc.Товары).toEqual([expect.objectContaining({ Количество: 3, Цена: 100, Сумма: 300 })]);
    // Договор заведён автоматически — Бухгалтерия без него реализацию не проводит.
    expect(onec.rows(N.contracts!.set)).toHaveLength(1);
  });

  it("оплата после подключения становится ПКО; журнал не путает организации", async () => {
    const cp = onec.add(N.counterparties.set, { Description: "Магазин Альфа" });
    await syncCounterparties(s.tenantId);
    const orderId = await deliveredOrder();
    await db.insert(schema.payments).values({ tenantId: s.tenantId, shopId: s.shopId, orderId, amount: "300.00", type: "payment", paymentMethod: "cash" });
    // Чужая организация с таким же платежом — в нашу очередь не попадает.
    await db.insert(schema.payments).values({ tenantId: s.otherTenantId, shopId: s.shopId, amount: "999.00", type: "payment" });

    expect(await oneCSync.enqueueDelivered(s.tenantId)).toEqual({ orders: 1, payments: 1 });
    expect(await oneCSync.processQueue(s.tenantId)).toEqual({ processed: 2, done: 2, failed: 0, skipped: 0 });
    const [pko] = onec.rows(N.cashIn!.set);
    expect(pko).toMatchObject({ Контрагент_Key: cp.Ref_Key, СуммаДокумента: 300, ВидОперации: "ОплатаПокупателя", Posted: true });
    expect(await countOf("onec_journal", `tenant_id = ${s.otherTenantId}`)).toBe(0);
  });

  it("второй круг заказа: очередь не перепроводит старый документ, а ждёт решения человека", async () => {
    onec.add(N.counterparties.set, { Description: "Магазин Альфа" });
    await syncCounterparties(s.tenantId);
    const orderId = await deliveredOrder();
    await oneCSync.enqueueDelivered(s.tenantId);
    await oneCSync.processQueue(s.tenantId);
    expect(onec.rows(N.sale.set)).toHaveLength(1);

    // Вернули в работу: created_at стал позже выгрузки. Снова доставили.
    await db.update(schema.orders).set({ createdAt: new Date(Date.now() + 60_000) }).where(eq(schema.orders.id, orderId));
    const [row] = await db.select().from(schema.onecJournal).where(eq(schema.onecJournal.entityId, orderId));
    await OnecJournal.retry(db as never, s.tenantId, row.id);

    expect(await oneCSync.processQueue(s.tenantId)).toEqual({ processed: 1, done: 0, failed: 0, skipped: 1 });
    const [after] = await db.select().from(schema.onecJournal).where(eq(schema.onecJournal.id, row.id));
    expect(after.status).toBe("skipped");
    expect(after.lastError).toMatch(/возвращали в работу/);
    expect(onec.rows(N.sale.set)).toHaveLength(1);
    expect(onec.posted).toHaveLength(1);

    // Прямое решение директора — новый документ.
    await oneCSync.syncOrderTo1C(s.tenantId, orderId, { asNewDocument: true });
    expect(onec.rows(N.sale.set)).toHaveLength(2);
  });

  it("крон: номенклатура приезжает, очередь выгружается, отметка времени ставится; повтор в тот же интервал молчит", async () => {
    onec.add(N.counterparties.set, { Description: "Магазин Альфа" });
    const unit = onec.add(N.units.set, { Description: "кг" });
    const item = onec.add(N.nomenclature.set, { Description: "Сахар", Code: "00000777", Артикул: "SUG-1", ЕдиницаИзмерения_Key: unit.Ref_Key });
    onec.add(N.prices.set, { Номенклатура_Key: item.Ref_Key, ТипЦен_Key: (await db.select().from(schema.onecConfig))[0].priceTypeKey, Цена: 12500 });
    await deliveredOrder();

    expect(await oneCSync.runScheduled()).toEqual({ tenants: 1 });
    const [sugar] = await db.select().from(schema.products).where(eq(schema.products.code, "SUG-1"));
    expect(sugar).toMatchObject({ name: "Сахар", unit: "kg", unitPrice: "12500.00" });
    expect(onec.rows(N.sale.set)).toHaveLength(1);
    const [cfg] = await db.select().from(schema.onecConfig);
    expect(cfg.lastSyncAt).not.toBeNull();

    // Интервал пять минут не прошёл — второй прогон организацию не трогает.
    const before = onec.requests.length;
    expect(await oneCSync.runScheduled()).toEqual({ tenants: 0 });
    expect(onec.requests.length).toBe(before);
    // Выключенная организация кроном не обслуживается.
    await db.update(schema.onecConfig).set({ enabled: false, lastSyncAt: null });
    expect(await oneCSync.runScheduled()).toEqual({ tenants: 0 });
  });
});
