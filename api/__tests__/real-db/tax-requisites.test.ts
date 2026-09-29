/**
 * Налоговые реквизиты через настоящие ручки: ИНН/ПИНФЛ магазина, ИКПУ и НДС товара.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * У магазина не было ни ИНН, ни признака плательщика НДС, у товара — ни ИКПУ,
 * ни кода упаковки, ни ставки. 1С получала контрагента без ИНН, ЭСФ без ручной
 * правки не выписывалась, накладная не могла выделить НДС.
 *
 * ── Что проверяется ─────────────────────────────────────────────────────────
 *
 * На настоящей MySQL через shop/product/order-роутеры:
 *   • ИНН с пробелами сохраняется цифрами; 10 цифр — отказ с причиной;
 *     пустая строка стирает; ПИНФЛ (14) принимается; признак НДС пишется;
 *   • реквизиты видны в карточке и в списке (из него — выгрузка в Excel);
 *   • ИКПУ — ровно 17 цифр, ноль в начале сохраняется; ставка — из перечня,
 *     пусто — «не задана»; чужая ставка — отказ;
 *   • вызов без новых полей работает как раньше (так зовут мобилка и старые
 *     экраны) — признак НДС по умолчанию «нет»;
 *   • чужая организация: правка чужого магазина — отказ, строка не тронута;
 *     агент реквизиты не правит (права — как у соседних полей);
 *   • карточка заказа и пачка на печать отдают ставку строки и ИНН магазина.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "@db/schema";
import { ctxFor, hasRealDb, connectRealDb, closeRealDb, truncateAll, seed, type ServiceDb, type Seeded } from "./harness";

let current: ServiceDb;
vi.mock("../../queries/connection", () => ({ getDb: () => current, getPool: () => null }));

describe.skipIf(!hasRealDb)("налоговые реквизиты магазина и товара", () => {
  let db: ServiceDb;
  let s: Seeded;
  let operatorId: number;

  beforeAll(async () => { db = await connectRealDb(); current = db; }, 180_000);
  afterAll(async () => { await closeRealDb(); });
  beforeEach(async () => {
    await truncateAll();
    s = await seed();
    const [op] = await db.insert(schema.users).values({ tenantId: s.tenantId, name: "Оператор", email: "op@test.local", passwordHash: "x", role: "operator" });
    operatorId = Number(op.insertId);
  });

  const shopsAs = async (role = "operator", userId = operatorId) =>
    (await import("../../shop-router")).shopRouter.createCaller(ctxFor(db, s.tenantId, userId, role));
  const productsAs = async (role = "operator", userId = operatorId) =>
    (await import("../../product-router")).productRouter.createCaller(ctxFor(db, s.tenantId, userId, role));
  const shopRow = async (id: number) => (await db.select().from(schema.shops).where(eq(schema.shops.id, id)))[0];
  const productRow = async (id: number) => (await db.select().from(schema.products).where(eq(schema.products.id, id)))[0];

  it("магазин: ИНН с пробелами — цифрами, признак НДС; 10 цифр — отказ; пусто — стёрто; ПИНФЛ — можно", async () => {
    const api = await shopsAs();
    const { id } = await api.create({ name: "ООО Ромашка", taxId: " 301 111-111 ", vatPayer: true });
    expect(await shopRow(id)).toMatchObject({ taxId: "301111111", vatPayer: true });

    await expect(api.create({ name: "Кривой ИНН", taxId: "3011111112" })).rejects.toThrow(/ИНН — 9 цифр, ПИНФЛ — 14 цифр/);
    await expect(api.update({ id, taxId: "30111111" })).rejects.toThrow(/ИНН — 9 цифр/);
    expect((await shopRow(id)).taxId).toBe("301111111");

    await api.update({ id, taxId: "31234567890123", vatPayer: false });
    expect(await shopRow(id)).toMatchObject({ taxId: "31234567890123", vatPayer: false });
    await api.update({ id, taxId: "" });
    expect((await shopRow(id)).taxId).toBeNull();
  });

  it("магазин: без новых полей — как раньше, признак НДС «нет»; реквизиты в карточке и списке", async () => {
    const api = await shopsAs();
    const { id: plain } = await api.create({ name: "Старый вызов", phone: "+998900000001" });
    expect(await shopRow(plain)).toMatchObject({ taxId: null, vatPayer: false });
    await api.update({ id: plain, name: "Старый вызов 2" });
    expect(await shopRow(plain)).toMatchObject({ name: "Старый вызов 2", taxId: null, vatPayer: false });

    const { id } = await api.create({ name: "Бета", taxId: "302222222", vatPayer: true });
    expect(await api.getById({ id })).toMatchObject({ taxId: "302222222", vatPayer: true });
    const listed = await api.list({ pageSize: 50 });
    expect(listed.data.find(r => r.id === id)).toMatchObject({ taxId: "302222222", vatPayer: true });
  });

  it("магазин: чужую точку не правит никто, агент не правит реквизиты вовсе", async () => {
    const [other] = await db.insert(schema.shops).values({ tenantId: s.otherTenantId, name: "Чужой" });
    const otherId = Number(other.insertId);
    const api = await shopsAs();
    await expect(api.update({ id: otherId, taxId: "303333333" })).rejects.toThrow(/не найден/);
    expect((await shopRow(otherId)).taxId).toBeNull();
    expect(await api.getById({ id: otherId })).toBeNull();

    const agent = await shopsAs("agent", s.agentId);
    await expect(agent.update({ id: s.shopId, taxId: "303333333" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await shopRow(s.shopId)).taxId).toBeNull();
  });

  it("товар: ИКПУ 17 цифр с нулём в начале, код упаковки, ставка; 16 цифр и чужая ставка — отказ; пусто — не задано", async () => {
    const api = await productsAs();
    const { id } = await api.create({ code: "W-1", name: "Вода 1.5 л", unitPrice: "4500", ikpu: "02202 001 001000000", packageCode: " 1510583 ", vatRate: "vat12" });
    expect(await productRow(id)).toMatchObject({ ikpu: "02202001001000000", packageCode: "1510583", vatRate: "vat12" });
    expect(await api.getById({ id })).toMatchObject({ ikpu: "02202001001000000", packageCode: "1510583", vatRate: "vat12" });

    await expect(api.create({ code: "W-2", name: "Кривой ИКПУ", unitPrice: "100", ikpu: "0220200100100000" })).rejects.toThrow(/ИКПУ \(МХИК\) — 17 цифр/);
    // Ставки 15 % в Узбекистане нет, и вход её не знает.
    await expect(api.update({ id, vatRate: "vat15" })).rejects.toThrow();
    expect((await productRow(id)).vatRate).toBe("vat12");

    await api.update({ id, vatRate: "exempt", ikpu: "" });
    expect(await productRow(id)).toMatchObject({ vatRate: "exempt", ikpu: null });
    await api.update({ id, vatRate: "" as never });
    expect((await productRow(id)).vatRate).toBeNull();

    // Без новых полей — как раньше.
    const { id: plain } = await api.create({ code: "W-3", name: "Хлеб", unitPrice: "3000" });
    expect(await productRow(plain)).toMatchObject({ ikpu: null, packageCode: null, vatRate: null });
    const listed = await api.list({ pageSize: 50 });
    expect(listed.data.find(p => p.id === id)).toMatchObject({ ikpu: null, vatRate: null, packageCode: "1510583" });
  });

  it("товар: агент ставку не меняет", async () => {
    const agent = await productsAs("agent", s.agentId);
    await expect(agent.update({ id: s.productId, vatRate: "vat12" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await productRow(s.productId)).vatRate).toBeNull();
  });

  it("заказ на печать: ставка строки и ИНН магазина приходят в карточке и в пачке", async () => {
    await db.update(schema.shops).set({ taxId: "304444444" }).where(eq(schema.shops.id, s.shopId));
    await db.update(schema.products).set({ vatRate: "vat12" }).where(eq(schema.products.id, s.productId));
    const [o] = await db.insert(schema.orders).values({
      tenantId: s.tenantId, orderNumber: "ORD-TAX-1", shopId: s.shopId, agentId: s.agentId,
      subtotal: "550.00", total: "550.00",
    });
    const orderId = Number(o.insertId);
    await db.insert(schema.orderItems).values([
      { orderId, productId: s.productId, quantity: "3.00", unitPrice: "100.00", subtotal: "300.00" },
      { orderId, productId: s.secondProductId, quantity: "1.00", unitPrice: "250.00", subtotal: "250.00" },
    ]);
    const orders = (await import("../../order-router")).orderRouter.createCaller(ctxFor(db, s.tenantId, operatorId, "operator"));

    const card = await orders.getById({ id: orderId });
    expect(card?.shop).toMatchObject({ taxId: "304444444" });
    expect(Object.fromEntries((card?.items ?? []).map(i => [i.productId, i.vatRate]))).toEqual({ [s.productId]: "vat12", [s.secondProductId]: null });

    const batch = await orders.batchPrintInvoices({ orderIds: [orderId] });
    const printed = batch.orders[0];
    expect(printed.shopTaxId).toBe("304444444");
    expect(Object.fromEntries(printed.items.map(i => [i.productId, i.vatRate]))).toEqual({ [s.productId]: "vat12", [s.secondProductId]: null });
  });
});
