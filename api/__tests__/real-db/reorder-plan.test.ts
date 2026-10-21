import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import * as schema from "@db/schema";
import { ctxFor, hasRealDb, connectRealDb, closeRealDb, truncateAll, seed, countOf, type ServiceDb, type Seeded } from "./harness";

/**
 * «Дозаказ» на настоящей MySQL: что и сколько, у кого — и черновики
 * заказов поставщикам по одному на поставщика.
 *
 * Здесь то, что заглушка не проверит: какие склады и какие заказы
 * считаются «в пути» (статусы, склад заказа, COALESCE склада у прихода без
 * заказа), ROW_NUMBER по последнему приходу, остаток заказа
 * GREATEST(quantity − received_qty, 0) и одна транзакция на все черновики.
 *
 * Нарочная поломка: в services/reorder.ts считай «в пути» и приходы по
 * заказу (убери isNull(arrivals.purchaseOrderId)) — «в пути» насчитает
 * принятый заказ дважды; убери eq(purchaseOrders.warehouseId, whId) —
 * чужой склад уменьшит заказ основного.
 */

const DAY = "2026-10-01";

describe.skipIf(!hasRealDb)("дозаказ: склад, свободный остаток, в пути, поставщик", () => {
  let db: ServiceDb;
  let s: Seeded;
  let ceoId: number;
  let secondWh: number;
  let thirdProduct: number;
  let supA: number;
  let supB: number;
  let supC: number;

  beforeAll(async () => { db = await connectRealDb(); }, 180_000);
  afterAll(async () => { await closeRealDb(); });
  beforeEach(async () => {
    await truncateAll();
    s = await seed("10.000");
    const d = db as any;
    const [ceo] = await d.insert(schema.users).values({ tenantId: s.tenantId, name: "Директор", email: "ceo@test.local", passwordHash: "x", role: "ceo" });
    ceoId = Number(ceo.insertId);
    const [wh] = await d.insert(schema.warehouses).values({ tenantId: s.tenantId, name: "Второй склад", isDefault: false });
    secondWh = Number(wh.insertId);
    const [a] = await d.insert(schema.suppliers).values({ tenantId: s.tenantId, name: "Завод А" });
    const [b] = await d.insert(schema.suppliers).values({ tenantId: s.tenantId, name: "Завод Б" });
    const [c] = await d.insert(schema.suppliers).values({ tenantId: s.tenantId, name: "Завод В" });
    supA = Number(a.insertId); supB = Number(b.insertId); supC = Number(c.insertId);
    const [p3] = await d.insert(schema.products).values({ tenantId: s.tenantId, code: "P-3", name: "Третий товар", unitPrice: "50.00", costPrice: "20.00" });
    thirdProduct = Number(p3.insertId);
    await d.insert(schema.warehouseStock).values({ tenantId: s.tenantId, productId: thirdProduct, warehouseId: s.warehouseId, currentStock: "1.000", reserved: "0.000", available: "1.000" });

    // Товар: точка 20, на полке 10, из них 4 под заказы магазинов — свободно 6.
    await runSql(sql`UPDATE products SET reorder_point = 20, cost_price = 75 WHERE id = ${s.productId}`);
    await runSql(sql`UPDATE warehouse_stock SET reserved = 4, available = 6 WHERE product_id = ${s.productId} AND warehouse_id = ${s.warehouseId}`);
    // Второй товар: точка 5, свободно 10 — не заканчивается.
    await runSql(sql`UPDATE products SET reorder_point = 5, cost_price = 30 WHERE id = ${s.secondProductId}`);
  });

  const runSql = (q: ReturnType<typeof sql>) => (db as any).execute(q);
  const rows = async <T,>(q: ReturnType<typeof sql>): Promise<T[]> => ((await runSql(q)) as [T[]])[0];
  const wh = async (role = "operator", tenantId = s.tenantId, userId = s.agentId) =>
    (await import("../../warehouse-router")).warehouseRouter.createCaller(ctxFor(db, tenantId, userId, role));
  const po = async (role = "operator", userId = s.agentId) =>
    (await import("../../purchase-order-router")).purchaseOrderRouter.createCaller(ctxFor(db, s.tenantId, userId, role));
  const arr = async () => (await import("../../arrival-router")).arrivalRouter.createCaller(ctxFor(db, s.tenantId, s.agentId));
  const plan = async (warehouseId?: number) => (await wh()).reorderSuggestions(warehouseId ? { warehouseId } : undefined);
  const rowOf = async (productId: number, warehouseId?: number) => (await plan(warehouseId)).find(r => r.productId === productId);

  it("склад не выбран — основной, строка на товар; размер — от свободного, до 2 × точки", async () => {
    // На втором складе того же товара нет вовсе — раньше он давал вторую строку.
    await (db as any).insert(schema.warehouseStock).values({ tenantId: s.tenantId, productId: s.productId, warehouseId: secondWh, currentStock: "0.000", reserved: "0.000", available: "0.000" });

    const main = await plan();
    expect(main.map(r => r.productId)).toEqual([s.productId]);
    expect(main[0]).toMatchObject({ warehouseId: s.warehouseId, target: 40, inbound: 0, suggestedQty: 34, suggestedCost: 34 * 75 });
    expect(Number(main[0].available)).toBe(6);
    expect(Number(main[0].currentStock)).toBe(10);

    // Выбран второй склад — его остаток и его план.
    const second = await rowOf(s.productId, secondWh);
    expect(second).toMatchObject({ warehouseId: secondWh, suggestedQty: 40 });

    // Максимум запаса задан — до него.
    await runSql(sql`UPDATE products SET reorder_max = 50 WHERE id = ${s.productId}`);
    expect(await rowOf(s.productId)).toMatchObject({ target: 50, suggestedQty: 44 });
    // Выключенный товар не дозаказывают.
    await runSql(sql`UPDATE products SET status = 'inactive' WHERE id = ${s.productId}`);
    expect(await rowOf(s.productId)).toBeUndefined();
  });

  it("в пути: остаток открытых заказов на этот склад и приходы без заказа — каждый раз один раз", async () => {
    await runSql(sql`UPDATE products SET reorder_max = 50 WHERE id = ${s.productId}`);
    const c = await po();
    const line = (quantity: string) => [{ productId: s.productId, quantity, unitPrice: "80" }];

    // Черновик на основной склад — 10.
    await c.create({ supplierId: supA, currency: "UZS", items: line("10") });
    // Согласован и принимается: приход по заказу заведён, но не проведён — 8 считаются один раз.
    const { id: accepted } = await c.create({ supplierId: supA, currency: "UZS", items: line("8") });
    await (await po("ceo", ceoId)).approve({ id: accepted });
    await c.receive({ id: accepted, arrivalDate: DAY });
    // Принят частично: заказано 6, принято 4 — едет 2.
    const { id: partial } = await c.create({ supplierId: supA, currency: "UZS", items: line("6") });
    await runSql(sql`UPDATE purchase_orders SET status = 'partially_received' WHERE id = ${partial}`);
    await runSql(sql`UPDATE purchase_order_items SET received_qty = 4 WHERE purchase_order_id = ${partial}`);
    // Отменённый и закрытый не едут; заказ на второй склад едет туда, а не сюда.
    const { id: cancelled } = await c.create({ supplierId: supA, currency: "UZS", items: line("100") });
    await c.cancel({ id: cancelled });
    const { id: closed } = await c.create({ supplierId: supA, currency: "UZS", items: line("100") });
    await runSql(sql`UPDATE purchase_orders SET status = 'closed' WHERE id = ${closed}`);
    await c.create({ supplierId: supA, currency: "UZS", warehouseId: secondWh, items: line("7") });

    // Приход без заказа, не проведён: «по накладной» 4 — едет 4.
    const a = await arr();
    await a.create({ arrivalDate: DAY, items: [{ productId: s.productId, quantity: "0", expectedQuantity: "4" }] });
    // Тот же, но на второй склад, — не сюда.
    const other = await a.create({ arrivalDate: DAY, items: [{ productId: s.productId, quantity: "0", expectedQuantity: "6" }] });
    await runSql(sql`UPDATE arrivals SET warehouse_id = ${secondWh} WHERE id = ${other.id}`);
    // Проведённый уже лежит на полке — не едет.
    const done = await a.create({ arrivalDate: DAY, items: [{ productId: s.productId, quantity: "0", expectedQuantity: "9" }] });
    await runSql(sql`UPDATE arrivals SET status = 'completed' WHERE id = ${done.id}`);

    // 10 + 8 + 2 + 4 = 24; цель 50, свободно 6 — заказать 20.
    expect(await rowOf(s.productId)).toMatchObject({ inbound: 24, target: 50, suggestedQty: 20 });
    // На втором складе — свой «в пути»: заказ 7 и приход 6.
    await (db as any).insert(schema.warehouseStock).values({ tenantId: s.tenantId, productId: s.productId, warehouseId: secondWh, currentStock: "0.000", reserved: "0.000", available: "0.000" });
    expect(await rowOf(s.productId, secondWh)).toMatchObject({ inbound: 13, suggestedQty: 37 });
  });

  it("поставщик: из карточки, если действует; иначе кто привёз последним; иначе никто", async () => {
    // Все три товара заканчиваются.
    await runSql(sql`UPDATE products SET reorder_point = 20 WHERE id IN (${s.secondProductId}, ${thirdProduct})`);
    await runSql(sql`UPDATE products SET default_supplier_id = ${supA} WHERE id = ${s.productId}`);
    await runSql(sql`UPDATE products SET default_supplier_id = ${supC} WHERE id = ${s.secondProductId}`);
    await runSql(sql`UPDATE suppliers SET status = 'inactive' WHERE id = ${supC}`);

    // Второй товар привозили: сначала Завод А, позже — Завод Б.
    const a = await arr();
    for (const [supplierId, day] of [[supA, "2026-09-01"], [supB, "2026-09-20"]] as const) {
      const { id } = await a.create({
        arrivalDate: day, items: [{ productId: s.secondProductId, quantity: "1", costPrice: "30" }],
        supplier: { supplierId, amount: "30", currency: "UZS" },
      });
      await a.update({ id, status: "completed" });
    }

    const byId = new Map((await plan()).map(r => [r.productId, r]));
    expect(byId.get(s.productId)).toMatchObject({ supplierId: supA, supplierName: "Завод А", supplierSource: "default" });
    // Поставщик из карточки выключен — последний, кто привёз.
    expect(byId.get(s.secondProductId)).toMatchObject({ supplierId: supB, supplierName: "Завод Б", supplierSource: "last" });
    expect(byId.get(thirdProduct)).toMatchObject({ supplierId: null, supplierName: null, supplierSource: null });
  });

  it("черновики по одному на поставщика: «Дозаказ», цены из прошлых заказов или себестоимость; сразу «в пути»", async () => {
    await runSql(sql`UPDATE products SET reorder_point = 20 WHERE id = ${thirdProduct}`);
    // Прежние заказы у Завода А: по 82 — действующий, по 80 — позже, но отменён.
    const c = await po();
    await c.create({ supplierId: supA, currency: "UZS", items: [{ productId: s.productId, quantity: "1", unitPrice: "82" }] });
    const { id: dropped } = await c.create({ supplierId: supA, currency: "UZS", items: [{ productId: s.productId, quantity: "1", unitPrice: "80" }] });
    await c.cancel({ id: dropped });
    const before = await countOf("purchase_orders");

    const res = await c.createFromSuggestions({
      groups: [
        { supplierId: supA, items: [{ productId: s.productId, quantity: "34" }] },
        { supplierId: supB, items: [{ productId: s.secondProductId, quantity: "5" }] },
        // Тот же поставщик второй группой — тот же заказ.
        { supplierId: supA, items: [{ productId: thirdProduct, quantity: "2" }] },
      ],
    });
    expect(res.orders).toHaveLength(2);
    expect(res.orders.map(o => [o.supplierName, o.lines])).toEqual([["Завод А", 2], ["Завод Б", 1]]);
    expect(await countOf("purchase_orders")).toBe(before + 2);

    const heads = await rows<{ id: number; status: string; source: string; currency: string; wh: number }>(sql`
      SELECT id, status, source, currency, warehouse_id AS wh FROM purchase_orders WHERE id IN (${res.orders[0].id}, ${res.orders[1].id}) ORDER BY id`);
    for (const h of heads) expect(h).toMatchObject({ status: "draft", source: "reorder", currency: "UZS", wh: s.warehouseId });

    const lines = await rows<{ po: number; productId: number; q: string; price: string }>(sql`
      SELECT purchase_order_id AS po, product_id AS productId, quantity AS q, unit_price AS price
      FROM purchase_order_items WHERE purchase_order_id IN (${res.orders[0].id}, ${res.orders[1].id}) ORDER BY purchase_order_id, product_id`);
    expect(lines.map(l => [Number(l.po), Number(l.productId), Number(l.q), Number(l.price)])).toEqual([
      // Последняя цена у этого поставщика (82, а не отменённые 80).
      [res.orders[0].id, s.productId, 34, 82],
      // Заказов не было — себестоимость.
      [res.orders[0].id, thirdProduct, 2, 20],
      [res.orders[1].id, s.secondProductId, 5, 30],
    ]);

    // Долга и прихода черновик не создаёт (ADR 0013); в журнале — «из дозаказа».
    expect(await countOf("supplies")).toBe(0);
    expect(await countOf("arrivals")).toBe(0);
    const audit = await rows<{ meta: unknown }>(sql`SELECT meta FROM audit_log WHERE action = 'purchase_order.created' AND target_id = ${res.orders[0].id}`);
    expect(JSON.stringify(audit[0].meta)).toContain("fromReorder");

    // Заказанное сразу «в пути»: второй раз то же не предлагается.
    expect(await rowOf(s.productId)).toMatchObject({ suggestedQty: 0 });
  });

  it("одна транзакция: отказ по одному поставщику — ни одного черновика", async () => {
    await runSql(sql`UPDATE suppliers SET status = 'inactive' WHERE id = ${supC}`);
    const before = await countOf("purchase_orders");
    await expect((await po()).createFromSuggestions({
      groups: [
        { supplierId: supA, items: [{ productId: s.productId, quantity: "34" }] },
        { supplierId: supC, items: [{ productId: s.secondProductId, quantity: "5" }] },
      ],
    })).rejects.toThrow(/«Завод В» выключен/);
    expect(await countOf("purchase_orders")).toBe(before);
    expect(await countOf("purchase_order_items")).toBe(0);
  });

  it("чужое: склад — не найден; поставщик, товар и склад в черновике — отказ", async () => {
    const d = db as any;
    const [foreignWh] = await d.insert(schema.warehouses).values({ tenantId: s.otherTenantId, name: "Чужой склад", isDefault: true });
    const [foreignSup] = await d.insert(schema.suppliers).values({ tenantId: s.otherTenantId, name: "Чужой завод" });
    const [foreignProduct] = await d.insert(schema.products).values({ tenantId: s.otherTenantId, code: "X-1", name: "Чужой товар", unitPrice: "1.00" });

    await expect(plan(Number(foreignWh.insertId))).rejects.toMatchObject({ code: "NOT_FOUND" });
    const c = await po();
    await expect(c.createFromSuggestions({ groups: [{ supplierId: Number(foreignSup.insertId), items: [{ productId: s.productId, quantity: "1" }] }] }))
      .rejects.toThrow("Поставщик не найден");
    await expect(c.createFromSuggestions({ groups: [{ supplierId: supA, items: [{ productId: Number(foreignProduct.insertId), quantity: "1" }] }] }))
      .rejects.toThrow(/не найден в вашей организации/);
    await expect(c.createFromSuggestions({ warehouseId: Number(foreignWh.insertId), groups: [{ supplierId: supA, items: [{ productId: s.productId, quantity: "1" }] }] }))
      .rejects.toThrow("Склад не найден");
    expect(await countOf("purchase_orders")).toBe(0);
  });

  it("организация в долларах — черновик в долларах, себестоимость подходит как цена", async () => {
    await (db as any).insert(schema.settings).values({ tenantId: s.tenantId, currency: "USD" });
    const res = await (await po()).createFromSuggestions({ groups: [{ supplierId: supA, items: [{ productId: s.productId, quantity: "3" }] }] });
    const [head] = await rows<{ currency: string }>(sql`SELECT currency FROM purchase_orders WHERE id = ${res.orders[0].id}`);
    expect(head.currency).toBe("USD");
    const [line] = await rows<{ price: string }>(sql`SELECT unit_price AS price FROM purchase_order_items WHERE purchase_order_id = ${res.orders[0].id}`);
    expect(Number(line.price)).toBe(75);
  });
});
