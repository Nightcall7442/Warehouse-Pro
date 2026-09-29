import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "@db/schema";
import { priceAt } from "@contracts/price-tiers";
import { cache } from "../../lib/cache";
import { ctxFor, hasRealDb, connectRealDb, closeRealDb, truncateAll, seed, type ServiceDb, type Seeded } from "./harness";

/**
 * «Повторить заказ» и «как в прошлый раз» — на настоящей базе, через ручки.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Телефонный заказ почти всегда «как в прошлый раз», а оператор набирал
 * 10–30 позиций заново: повторить заказ было нечем. Агент набирал по памяти.
 *
 * ── Что проверяется ─────────────────────────────────────────────────────────
 *
 * Всё через order.repeatDraft и order.create, как у человека:
 *   · товар, снятый с продажи (product.delete у товара из заказа), в черновик
 *     не идёт и назван по имени в skipped;
 *   · цена строки черновика — ТЕКУЩАЯ и та же, что у каталога (priceAt по
 *     product.listAll) и у заказа, созданного из черновика: и со ступенями
 *     прайс-листа, и с правилом «к карточке», появившимся после заказа;
 *   · остаток — основного склада, а не сумма по складам;
 *   · агент не повторит заказ чужого магазина и не увидит его состав ни по
 *     номеру, ни через «последний заказ магазина»;
 *   · чужая организация — отказ «не найден» и по заказу, и по магазину;
 *   · магазин в архиве — отказ со словами «в архиве», а не окно с этой точкой
 *     (выбрать её в окне нельзя, а create статус магазина не проверяет);
 *   · «в прошлый раз» — среднее по трём последним заказам магазина, без
 *     отменённых; штуки — целыми, вес — до сотых.
 *
 * Нарочные поломки (каждая роняет свой тест):
 *   · в repeatDraft верни в lines все строки без фильтра по status — падает
 *     «снятый с продажи»;
 *   · возьми цену строки из order_items.unit_price (цена прошлого заказа) —
 *     падают оба теста цен;
 *   · убери условие warehouseId по основному складу — падает «остаток»;
 *   · убери viewerScope из выборки заказа — падают оба теста агента;
 *   · убери условие tenantId у магазина — падает «чужая организация»;
 *   · убери проверку shop.status в repeatDraft — падает «магазин в архиве»;
 *   · убери .limit(LAST_TIME_ORDERS) у производной таблицы — падает среднее;
 *   · убери notInArray(NOT_TAKEN) — падает среднее (отменённый входит в «последний»);
 *   · убери округление штучных единиц в roundLastTime — падает «полбутылки».
 */
let current: ServiceDb;
vi.mock("../../queries/connection", () => ({ getDb: () => current, getPool: () => null }));
vi.mock("../../services/push-service", () => ({ sendPushToUser: vi.fn(async () => undefined), sendPushToRole: vi.fn(async () => undefined) }));
vi.mock("../../services/telegram-notify", async (orig) => ({ ...(await orig<object>()), notifyEvent: vi.fn(async () => undefined) }));

describe.skipIf(!hasRealDb)("повтор заказа и «как в прошлый раз»", () => {
  let db: ServiceDb;
  let s: Seeded;
  let operatorId = 0;

  const addUser = async (tenantId: number, role: string, email: string) =>
    Number((await (db as any).insert(schema.users).values({ tenantId, name: role, email, passwordHash: "x", role }))[0].insertId);
  const orders = async (userId: number, role = "operator", tenantId = s.tenantId) =>
    (await import("../../order-router")).orderRouter.createCaller(ctxFor(db, tenantId, userId, role));
  const create = async (items: Array<[number, string]>, by = { id: operatorId, role: "operator" }, shopId = s.shopId) =>
    (await orders(by.id, by.role)).create({ shopId, items: items.map(([productId, quantity]) => ({ productId, quantity })) });
  const catalog = async (productId: number) => {
    const r = await (await import("../../product-router")).productRouter.createCaller(ctxFor(db, s.tenantId, s.agentId, "agent")).listAll({ shopId: s.shopId });
    return r.find(p => Number(p.id) === productId)!;
  };
  const linePrice = async (orderId: number, productId: number): Promise<string> => {
    const rows: Array<{ productId: number; unitPrice: string }> = await (db as any)
      .select({ productId: schema.orderItems.productId, unitPrice: schema.orderItems.unitPrice })
      .from(schema.orderItems).where(eq(schema.orderItems.orderId, orderId));
    return rows.find(r => Number(r.productId) === productId)!.unitPrice;
  };

  beforeAll(async () => { db = await connectRealDb(); current = db; }, 180_000);
  afterAll(async () => { await closeRealDb(); });
  beforeEach(async () => {
    await truncateAll();
    // Каталог кэшируется по организации, а номера после TRUNCATE повторяются.
    cache.invalidatePrefix("products:");
    s = await seed("100.000");
    operatorId = await addUser(s.tenantId, "operator", "op@test.local");
  });

  it("снятый с продажи товар не идёт в черновик и назван по имени", async () => {
    const o = await create([[s.productId, "3"], [s.secondProductId, "2"]]);
    // Удаление товара из заказа — настоящей ручкой: строка держит его ключом,
    // и товар уходит в «неактивные».
    await (await import("../../product-router")).productRouter.createCaller(ctxFor(db, s.tenantId, operatorId, "operator")).delete({ id: s.secondProductId });

    const d = await (await orders(operatorId)).repeatDraft({ orderId: o.id });
    expect(d.shop).toEqual({ id: s.shopId, name: "Магазин Альфа" });
    expect(d.source?.id).toBe(o.id);
    expect(d.lines.map(l => [l.productId, l.quantity]), "снятый с продажи товар попал в черновик").toEqual([[s.productId, "3.00"]]);
    expect(d.skipped).toEqual([{ productId: s.secondProductId, name: "Второй товар", quantity: "2.00" }]);

    // Черновик проходит обычную дорогу заказа — тот же create.
    const again = await create(d.lines.map(l => [l.productId, l.quantity]));
    expect(again.total).toBe(300);
  });

  it("цены — текущие ступени прайс-листа: как каталог и как заказ из черновика", async () => {
    const o = await create([[s.productId, "12"]]);
    expect(await linePrice(o.id, s.productId)).toBe("100.00"); // списка ещё не было

    // Список со ступенями появился ПОСЛЕ заказа: повтор обязан взять его, а не старую цену.
    const [pl] = await (db as any).insert(schema.priceLists).values({ tenantId: s.tenantId, name: "Опт", priority: 0, isActive: true });
    const listId = Number(pl.insertId);
    await (db as any).insert(schema.priceListItems).values([
      { priceListId: listId, productId: s.productId, minQuantity: "1.00", price: "90.00" },
      { priceListId: listId, productId: s.productId, minQuantity: "10.00", price: "84.00" },
    ]);
    await (db as any).insert(schema.priceListAssignments).values({ priceListId: listId, shopId: s.shopId });

    const d = await (await orders(operatorId)).repeatDraft({ orderId: o.id });
    const line = d.lines[0];
    expect(line.unitPrice, "повтор взял цену прошлого заказа, а не текущую").toBe("84.00");
    const p = await catalog(s.productId);
    expect(priceAt(String(p.unitPrice), p.tiers, Number(line.quantity)), "каталог при том же количестве считает иначе").toBe(line.unitPrice);

    const again = await create(d.lines.map(l => [l.productId, l.quantity]));
    expect(await linePrice(again.id, s.productId), "заказ из черновика лёг по другой цене").toBe(line.unitPrice);
  });

  it("цены — правило «к карточке» списка магазина, тоже как каталог и заказ", async () => {
    const o = await create([[s.secondProductId, "4"]]);
    const [pl] = await (db as any).insert(schema.priceLists).values({ tenantId: s.tenantId, name: "Опт −10", priority: 1, isActive: true, markupPct: "-10.00" });
    await (db as any).insert(schema.priceListAssignments).values({ priceListId: Number(pl.insertId), shopId: s.shopId });

    const d = await (await orders(operatorId)).repeatDraft({ shopId: s.shopId });
    expect(d.source?.id).toBe(o.id);
    expect(d.lines[0].unitPrice).toBe("225.00"); // 250 − 10 %
    const p = await catalog(s.secondProductId);
    expect(priceAt(String(p.unitPrice), p.tiers, 4)).toBe(d.lines[0].unitPrice);
    const again = await create(d.lines.map(l => [l.productId, l.quantity]));
    expect(await linePrice(again.id, s.secondProductId)).toBe("225.00");
  });

  it("остаток — основного склада, а не сумма по всем", async () => {
    const o = await create([[s.productId, "5"]]);
    // Второй склад с большим остатком: продавать с него нельзя, и в черновик он не входит.
    const [wh] = await (db as any).insert(schema.warehouses).values({ tenantId: s.tenantId, name: "Дальний", isDefault: false });
    await (db as any).insert(schema.warehouseStock).values({ tenantId: s.tenantId, warehouseId: Number(wh.insertId), productId: s.productId, currentStock: "500.00", reserved: "0.00", available: "500.00" });

    const d = await (await orders(operatorId)).repeatDraft({ orderId: o.id });
    expect(d.lines[0].available, "остаток не основного склада").toBe("95.00"); // 100 − резерв 5
    expect((await catalog(s.productId)).available, "каталог и черновик разошлись").toBe(d.lines[0].available);
  });

  it("агент не повторит заказ чужого магазина — ни по номеру, ни «последним заказом»", async () => {
    // Магазин закреплён за другим агентом, заказ оформил он.
    const otherAgent = await addUser(s.tenantId, "agent", "agent2@test.local");
    await (db as any).update(schema.shops).set({ agentId: otherAgent }).where(eq(schema.shops.id, s.shopId));
    const theirs = await create([[s.productId, "7"]], { id: otherAgent, role: "agent" });

    const me = await orders(s.agentId, "agent");
    await expect(me.repeatDraft({ orderId: theirs.id }), "агент повторил чужой заказ").rejects.toMatchObject({ code: "FORBIDDEN" });
    const byShop = await me.repeatDraft({ shopId: s.shopId });
    expect(byShop.source, "агенту подсунули чужой заказ как «последний»").toBeNull();
    expect(byShop.lines).toEqual([]);
    expect(byShop.lastTime, "чужие количества утекли в подсказку").toEqual([]);

    // Офис тот же заказ повторяет — это его работа.
    const office = await (await orders(operatorId)).repeatDraft({ orderId: theirs.id });
    expect(office.lines.map(l => l.quantity)).toEqual(["7.00"]);
    // А свой заказ агент повторяет.
    const mine = await create([[s.productId, "2"]], { id: s.agentId, role: "agent" });
    expect((await me.repeatDraft({ shopId: s.shopId })).source?.id).toBe(mine.id);
  });

  it("чужая организация — «не найден» и по заказу, и по магазину", async () => {
    const o = await create([[s.productId, "3"]]);
    const stranger = await addUser(s.otherTenantId, "operator", "op@other.local");
    const them = await orders(stranger, "operator", s.otherTenantId);
    await expect(them.repeatDraft({ orderId: o.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(them.repeatDraft({ shopId: s.shopId })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("магазин в архиве — повтора нет ни по заказу, ни по магазину, и сказано почему", async () => {
    // Заказ оформлен, пока точка работала; потом её убрали в архив настоящей ручкой.
    const o = await create([[s.productId, "3"]]);
    await (await import("../../shop-router")).shopRouter.createCaller(ctxFor(db, s.tenantId, operatorId, "operator")).archive({ ids: [s.shopId] });

    const me = await orders(operatorId);
    await expect(me.repeatDraft({ orderId: o.id }), "повтор открыл окно архивной точке")
      .rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: expect.stringContaining("в архиве") });
    await expect(me.repeatDraft({ shopId: s.shopId })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });

    // Вернули в работу — повтор снова открыт.
    await (await import("../../shop-router")).shopRouter.createCaller(ctxFor(db, s.tenantId, operatorId, "operator")).restore({ id: s.shopId });
    expect((await me.repeatDraft({ orderId: o.id })).lines.map(l => l.quantity)).toEqual(["3.00"]);
  });

  it("«в прошлый раз» — среднее по трём последним заказам, без отменённых", async () => {
    await (db as any).update(schema.products).set({ unit: "kg" }).where(eq(schema.products.id, s.secondProductId));
    await create([[s.productId, "30"]]);                                  // четвёртый с конца — не входит
    await create([[s.productId, "10"], [s.secondProductId, "1.5"]]);
    await create([[s.productId, "11"]]);
    const last = await create([[s.productId, "12"], [s.secondProductId, "2"]]);
    const cancelled = await create([[s.productId, "20"]]);                 // отменён — магазин не брал
    await (await orders(operatorId)).cancel({ id: cancelled.id });

    const d = await (await orders(operatorId)).repeatDraft({ shopId: s.shopId });
    expect(d.source?.id, "«последний» — отменённый").toBe(last.id);
    const hint = new Map(d.lastTime.map(h => [h.productId, h]));
    // (10 + 11 + 12) / 3 = 11 штук; 30 и отменённые 20 не входят.
    expect(hint.get(s.productId), "среднее не по трём последним взятым заказам").toEqual({ productId: s.productId, quantity: "11", orders: 3 });
    // Вес — по тем заказам, где товар был: (1,5 + 2) / 2 = 1,75 кг.
    expect(hint.get(s.secondProductId)).toEqual({ productId: s.secondProductId, quantity: "1.75", orders: 2 });
  });

  it("штучный товар в среднем — целым: полбутылки не заказывают", async () => {
    await create([[s.productId, "10"]]);
    await create([[s.productId, "11"]]);
    const d = await (await orders(operatorId)).repeatDraft({ shopId: s.shopId });
    expect(d.lastTime[0].quantity).toBe("11"); // 10,5 → 11
  });
});
