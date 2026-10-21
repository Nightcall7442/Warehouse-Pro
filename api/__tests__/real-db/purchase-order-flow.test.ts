import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import * as schema from "@db/schema";
import { ctxFor, hasRealDb, connectRealDb, closeRealDb, truncateAll, seed, stockOf, countOf, type ServiceDb, type Seeded } from "./harness";

/**
 * Заказ поставщику на настоящей MySQL: согласование, приёмка, долг (ADR 0013).
 *
 * Здесь то, чего заглушка не умеет в принципе: замки FOR UPDATE (две приёмки
 * разом, два прихода по заказу разом, проведение против удаления),
 * прибавка `received_qty + ?` в самом запросе, уникальный номер PO-N, день
 * срока оплаты в колонке DATE.
 *
 * Главное правило: долг по заказу рождается только проведением прихода и
 * только на принятое. Согласование, приёмка (заведение прихода), удаление
 * прихода и закрытие остатка поставок не трогают.
 *
 * Нарочная поломка: в services/arrival.ts убери вызов applyReceiptTx из
 * проведения — упадут «частичная приёмка» (нет долга, заказ не «принят
 * частично») и «два прихода разом»; в services/purchase-order.ts заведи
 * приход через createArrival вместо insertArrivalTx — «приёмка разом»
 * заведёт два прихода на один остаток.
 */

const DAY = "2026-10-01";

describe.skipIf(!hasRealDb)("заказ поставщику: согласовать → принять → долг", () => {
  let db: ServiceDb;
  let s: Seeded;
  let supplierId: number;
  let ceoId: number;
  let secondWarehouseId: number;

  beforeAll(async () => { db = await connectRealDb(); }, 180_000);
  afterAll(async () => { await closeRealDb(); });
  beforeEach(async () => {
    await truncateAll();
    s = await seed("10.000");
    const d = db as any;
    const [sup] = await d.insert(schema.suppliers).values({ tenantId: s.tenantId, name: "Завод", paymentTermsDays: 10 });
    supplierId = Number(sup.insertId);
    const [ceo] = await d.insert(schema.users).values({ tenantId: s.tenantId, name: "Директор", email: "ceo@test.local", passwordHash: "x", role: "ceo" });
    ceoId = Number(ceo.insertId);
    const [wh] = await d.insert(schema.warehouses).values({ tenantId: s.tenantId, name: "Второй склад", isDefault: false });
    secondWarehouseId = Number(wh.insertId);
  });

  const po = async (role = "operator", userId = s.agentId, tenantId = s.tenantId) =>
    (await import("../../purchase-order-router")).purchaseOrderRouter.createCaller(ctxFor(db, tenantId, userId, role));
  const director = () => po("ceo", ceoId);
  const arr = async () => (await import("../../arrival-router")).arrivalRouter.createCaller(ctxFor(db, s.tenantId, s.agentId));

  const rows = async <T,>(q: ReturnType<typeof sql>): Promise<T[]> => ((await (db as any).execute(q)) as [T[]])[0];
  const stockAt = async (productId: number, warehouseId: number) =>
    Number((await rows<{ c: string }>(sql`SELECT current_stock AS c FROM warehouse_stock WHERE product_id = ${productId} AND warehouse_id = ${warehouseId}`))[0]?.c ?? 0);
  const order = async (id: number) => (await rows<{ status: string }>(sql`SELECT status FROM purchase_orders WHERE id = ${id}`))[0];
  const received = async (id: number, productId: number) =>
    Number((await rows<{ r: string }>(sql`SELECT received_qty AS r FROM purchase_order_items WHERE purchase_order_id = ${id} AND product_id = ${productId}`))[0]?.r);
  const supplyOf = async (arrivalId: number) =>
    (await rows<{ amount: string; currency: string; rate: string | null; due: string | null; day: string; by: number | null; supplierId: number }>(sql`
      SELECT amount, currency, rate_to_uzs AS rate, DATE_FORMAT(due_date, '%Y-%m-%d') AS due, DATE_FORMAT(supply_date, '%Y-%m-%d') AS day,
             created_by AS \`by\`, supplier_id AS supplierId
      FROM supplies WHERE arrival_id = ${arrivalId}`))[0];
  const itemsOf = async (arrivalId: number) =>
    rows<{ productId: number; quantity: string; expected: string | null; cost: string }>(sql`
      SELECT product_id AS productId, quantity, expected_quantity AS expected, cost_price AS cost
      FROM arrival_items WHERE arrival_id = ${arrivalId} ORDER BY product_id`);

  /** Согласованный заказ: товар 10 × 80, второй — 5 × 200 (в сумах). */
  async function approvedOrder(extra: Partial<{ warehouseId: number; items: Array<{ productId: number; quantity: string; unitPrice: string }> }> = {}) {
    const c = await po();
    const { id, number } = await c.create({
      supplierId, currency: "UZS", warehouseId: extra.warehouseId,
      items: extra.items ?? [
        { productId: s.productId, quantity: "10", unitPrice: "80" },
        { productId: s.secondProductId, quantity: "5", unitPrice: "200" },
      ],
    });
    await (await director()).approve({ id });
    return { id, number };
  }

  it("заказ, отправка и согласование долга не создают и остатка не трогают; номер PO-N", async () => {
    const c = await po();
    const { id, number } = await c.create({ supplierId, currency: "UZS", items: [{ productId: s.productId, quantity: "10", unitPrice: "80" }] });
    expect(number).toBe("PO-1");
    expect((await c.create({ supplierId, currency: "UZS", items: [{ productId: s.productId, quantity: "1", unitPrice: "80" }] })).number).toBe("PO-2");
    // Отсрочка поставщика переехала в заказ.
    expect((await c.getById({ id })).paymentTermsDays).toBe(10);

    await c.submit({ id });
    expect((await order(id)).status).toBe("pending_approval");
    await (await director()).approve({ id });
    expect((await order(id)).status).toBe("approved");

    expect(await countOf("supplies")).toBe(0);
    expect(await countOf("arrivals")).toBe(0);
    expect((await stockOf(s.productId)).current).toBe(10);
    // Каждый шаг — строгий след в журнале.
    for (const action of ["purchase_order.created", "purchase_order.submitted", "purchase_order.approved"]) {
      expect(await countOf("audit_log", `action = '${action}' AND target_id = ${id}`), action).toBe(1);
    }
  });

  it("оператор не согласует и не отклоняет — это директор", async () => {
    const c = await po();
    const { id } = await c.create({ supplierId, currency: "UZS", items: [{ productId: s.productId, quantity: "1", unitPrice: "80" }] });
    await c.submit({ id });
    await expect(c.approve({ id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(c.reject({ id, note: "нет" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await order(id)).status).toBe("pending_approval");
  });

  it("частичная приёмка на неосновной склад: остаток там, долг — принятое × себестоимость, срок — день + отсрочка", async () => {
    const { id } = await approvedOrder({ warehouseId: secondWarehouseId });
    const { arrivalId } = await (await po()).receive({ id, arrivalDate: DAY });

    // Приход заведён по заказу: склад заказа, «по накладной» — заказанное, «пришло» — нули, цена — из заказа.
    const [a] = await rows<{ po: number; wh: number }>(sql`SELECT purchase_order_id AS po, warehouse_id AS wh FROM arrivals WHERE id = ${arrivalId}`);
    expect(Number(a.po)).toBe(id);
    expect(Number(a.wh)).toBe(secondWarehouseId);
    const prefilled = await itemsOf(arrivalId);
    expect(prefilled.map(i => [Number(i.quantity), Number(i.expected), Number(i.cost)])).toEqual([[0, 10, 80], [0, 5, 200]]);
    // До проведения долга нет.
    expect(await countOf("supplies")).toBe(0);

    // Пришло 6 из 10 по цене накладной 85; второго не привезли.
    await (await arr()).setItems({ id: arrivalId, items: [
      { productId: s.productId, quantity: "6", expectedQuantity: "10", costPrice: "85.00" },
      { productId: s.secondProductId, quantity: "0", expectedQuantity: "5", costPrice: "200.00" },
    ] });
    await (await arr()).update({ id: arrivalId, status: "completed" });

    expect(await stockAt(s.productId, secondWarehouseId)).toBe(6);
    expect(await stockAt(s.productId, s.warehouseId)).toBe(10);
    const supply = await supplyOf(arrivalId);
    expect(Number(supply.amount)).toBe(510);
    expect(supply.currency).toBe("UZS");
    expect(supply.day).toBe(DAY);
    expect(supply.due).toBe("2026-10-11");
    expect(Number(supply.by)).toBe(s.agentId);
    expect(Number(supply.supplierId)).toBe(supplierId);

    expect((await order(id)).status).toBe("partially_received");
    expect(await received(id, s.productId)).toBe(6);
    expect(await received(id, s.secondProductId)).toBe(0);
    const view = await (await po()).getById({ id });
    expect(view.items.map(i => [i.productId, i.remaining, i.inTransit])).toEqual([[s.productId, 4, 0], [s.secondProductId, 5, 0]]);
    expect(await countOf("audit_log", `action = 'purchase_order.received' AND target_id = ${id}`)).toBe(1);

    // Следующая приёмка ждёт только остаток.
    const next = await (await po()).receive({ id, arrivalDate: DAY });
    expect((await itemsOf(next.arrivalId)).map(i => Number(i.expected))).toEqual([4, 5]);
  });

  it("два прихода по одному заказу, проведённые разом, складывают принятое", async () => {
    const { id } = await approvedOrder({ items: [{ productId: s.productId, quantity: "10", unitPrice: "80" }] });
    const c = await po();
    const a = (await c.receive({ id, arrivalDate: DAY })).arrivalId;
    // Первая машина везёт 4 — остальное приёмка отдаёт второму приходу.
    await (await arr()).setItems({ id: a, items: [{ productId: s.productId, quantity: "4", expectedQuantity: "4", costPrice: "80.00" }] });
    const b = (await c.receive({ id, arrivalDate: DAY })).arrivalId;
    expect((await itemsOf(b)).map(i => Number(i.expected))).toEqual([6]);
    await (await arr()).setItems({ id: b, items: [{ productId: s.productId, quantity: "6", expectedQuantity: "6", costPrice: "80.00" }] });

    const done = await Promise.allSettled([
      (await arr()).update({ id: a, status: "completed" }),
      (await arr()).update({ id: b, status: "completed" }),
    ]);
    expect(done.map(r => r.status)).toEqual(["fulfilled", "fulfilled"]);
    expect(await received(id, s.productId)).toBe(10);
    expect((await order(id)).status).toBe("received");
    expect(await stockAt(s.productId, s.warehouseId)).toBe(20);
    expect(Number((await supplyOf(a)).amount) + Number((await supplyOf(b)).amount)).toBe(800);
  });

  it("две приёмки разом не заполняют один остаток дважды", async () => {
    const { id } = await approvedOrder();
    const c = await po();
    const results = await Promise.allSettled([c.receive({ id, arrivalDate: DAY }), c.receive({ id, arrivalDate: DAY })]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    const refused = results.find(r => r.status === "rejected") as PromiseRejectedResult;
    expect(String(refused.reason)).toMatch(/уже в приходе/);
    expect(await countOf("arrivals", `purchase_order_id = ${id}`)).toBe(1);
  });

  it("проведение против удаления: побеждает одно, и следов другого нет", async () => {
    const { id } = await approvedOrder({ items: [{ productId: s.productId, quantity: "10", unitPrice: "80" }] });
    const { arrivalId } = await (await po()).receive({ id, arrivalDate: DAY });
    await (await arr()).setItems({ id: arrivalId, items: [{ productId: s.productId, quantity: "10", expectedQuantity: "10", costPrice: "80.00" }] });

    const [complete, remove] = await Promise.allSettled([
      (await arr()).update({ id: arrivalId, status: "completed" }),
      (await arr()).delete({ id: arrivalId }),
    ]);
    // Ровно одно прошло.
    expect([complete.status, remove.status].filter(x => x === "fulfilled")).toHaveLength(1);
    const kept = await countOf("arrivals", `id = ${arrivalId}`);
    const stock = await stockAt(s.productId, s.warehouseId);
    if (complete.status === "fulfilled") {
      expect(kept).toBe(1);
      expect(stock).toBe(20);
      expect(await countOf("supplies", `arrival_id = ${arrivalId}`)).toBe(1);
      expect(await received(id, s.productId)).toBe(10);
    } else {
      expect(kept).toBe(0);
      expect(stock).toBe(10);
      expect(await countOf("supplies")).toBe(0);
      expect(await received(id, s.productId)).toBe(0);
    }
  });

  it("удаление непроведённого прихода по заказу заказ не трогает — приёмку можно начать заново", async () => {
    const { id } = await approvedOrder();
    const { arrivalId } = await (await po()).receive({ id, arrivalDate: DAY });
    await (await arr()).delete({ id: arrivalId });
    expect((await order(id)).status).toBe("approved");
    expect(await received(id, s.productId)).toBe(0);
    expect(await countOf("supplies")).toBe(0);
    const again = await (await po()).receive({ id, arrivalDate: DAY });
    expect((await itemsOf(again.arrivalId)).map(i => Number(i.expected))).toEqual([10, 5]);
  });

  it("отмена и закрытие ждут непроведённый приход; закрытие остатка долга не трогает", async () => {
    const { id } = await approvedOrder();
    const c = await po();
    const { arrivalId } = await c.receive({ id, arrivalDate: DAY });
    await expect(c.cancel({ id })).rejects.toThrow(/непроведённый приход/);
    await expect(c.update({ id, supplierId, currency: "UZS", items: [{ productId: s.productId, quantity: "1", unitPrice: "1" }] }))
      .rejects.toThrow(/заведён приход/);

    await (await arr()).setItems({ id: arrivalId, items: [
      { productId: s.productId, quantity: "6", expectedQuantity: "10", costPrice: "80.00" },
      { productId: s.secondProductId, quantity: "0", expectedQuantity: "5", costPrice: "200.00" },
    ] });
    await (await arr()).update({ id: arrivalId, status: "completed" });
    const before = Number((await supplyOf(arrivalId)).amount);

    const r = await c.cancel({ id, reason: "остальное не привезут" });
    expect(r.status).toBe("closed");
    expect((await order(id)).status).toBe("closed");
    expect(await countOf("supplies")).toBe(1);
    expect(Number((await supplyOf(arrivalId)).amount)).toBe(before);
    await expect(c.receive({ id })).rejects.toThrow(/принимать по нему нельзя/);
  });

  it("излишек принимается, показывается и идёт в долг", async () => {
    const { id } = await approvedOrder({ items: [{ productId: s.productId, quantity: "10", unitPrice: "80" }] });
    const { arrivalId } = await (await po()).receive({ id, arrivalDate: DAY });
    await (await arr()).setItems({ id: arrivalId, items: [{ productId: s.productId, quantity: "12", expectedQuantity: "10", costPrice: "80.00" }] });
    await (await arr()).update({ id: arrivalId, status: "completed" });
    expect((await order(id)).status).toBe("received");
    expect(await received(id, s.productId)).toBe(12);
    expect(Number((await supplyOf(arrivalId)).amount)).toBe(960);
    const view = await (await po()).getById({ id });
    expect(view.items[0]).toMatchObject({ remaining: 0, over: 2 });
  });

  it("товар не из заказа в приход по заказу не вписать — отказ называет товар", async () => {
    const { id } = await approvedOrder({ items: [{ productId: s.productId, quantity: "10", unitPrice: "80" }] });
    const { arrivalId } = await (await po()).receive({ id, arrivalDate: DAY });
    await expect((await arr()).setItems({ id: arrivalId, items: [
      { productId: s.productId, quantity: "10", expectedQuantity: "10", costPrice: "80.00" },
      { productId: s.secondProductId, quantity: "3" },
    ] })).rejects.toThrow(/нет товара «Второй товар»/);
    expect((await itemsOf(arrivalId)).map(i => Number(i.productId))).toEqual([s.productId]);
  });

  it("заказ в долларах: без курса не согласуется; долг в долларах по цене заказа, себестоимость — по курсу и руками не правится", async () => {
    const c = await po();
    const input = { supplierId, currency: "USD" as const, items: [{ productId: s.productId, quantity: "4", unitPrice: "2.50" }] };
    const { id } = await c.create(input);
    await expect((await director()).approve({ id })).rejects.toThrow(/курс/);
    const { updatedAt } = await c.getById({ id });
    await c.update({ id, ...input, rateToUzs: "12700", updatedAt });
    await (await director()).approve({ id });

    const { arrivalId } = await c.receive({ id, arrivalDate: DAY });
    expect(Number((await itemsOf(arrivalId))[0].cost)).toBe(31750);
    // Себестоимость прихода по долларовому заказу правке не поддаётся.
    await (await arr()).setItems({ id: arrivalId, items: [{ productId: s.productId, quantity: "4", expectedQuantity: "4", costPrice: "1.00" }] });
    expect(Number((await itemsOf(arrivalId))[0].cost)).toBe(31750);
    await (await arr()).update({ id: arrivalId, status: "completed" });

    const supply = await supplyOf(arrivalId);
    expect(supply.currency).toBe("USD");
    expect(Number(supply.amount)).toBe(10);
    expect(Number(supply.rate)).toBe(12700);
    const [p] = await (db as any).select({ c: schema.products.costPrice }).from(schema.products).where(eq(schema.products.id, s.productId));
    expect(Number(p.c)).toBe(31750);
  });

  it("правка согласованного заказа возвращает его в черновик — согласовывать заново", async () => {
    const { id } = await approvedOrder();
    const c = await po();
    await c.update({ id, supplierId, currency: "UZS", items: [{ productId: s.productId, quantity: "20", unitPrice: "80" }] });
    const [row] = await rows<{ status: string; approvedAt: string | null }>(sql`SELECT status, approved_at AS approvedAt FROM purchase_orders WHERE id = ${id}`);
    expect(row).toMatchObject({ status: "draft", approvedAt: null });
    await expect(c.receive({ id })).rejects.toThrow(/принимать по нему нельзя/);
    // Директор возвращает с причиной — и она видна в заказе.
    await c.submit({ id });
    await (await director()).reject({ id, note: "Дорого" });
    expect((await c.getById({ id })).rejectNote).toBe("Дорого");
  });

  it("приход по заказу не берёт блок поставщика и проводится только на склад заказа", async () => {
    const { createArrival } = await import("../../services/arrival");
    const { id } = await approvedOrder();
    await expect(createArrival(db as never, s.tenantId, s.agentId, {
      arrivalDate: DAY, fuelCost: "0", tollCost: "0", otherCost: "0", purchaseOrderId: id,
      supplier: { supplierId, amount: "100", currency: "UZS" },
    })).rejects.toThrow(/заводит долг сам/);

    const { arrivalId } = await (await po()).receive({ id, arrivalDate: DAY });
    await (await arr()).setItems({ id: arrivalId, items: [{ productId: s.productId, quantity: "1", expectedQuantity: "10", costPrice: "80.00" }] });
    await expect((await arr()).update({ id: arrivalId, status: "completed", warehouseId: secondWarehouseId })).rejects.toThrow(/склад заказа/);
    expect(await stockAt(s.productId, secondWarehouseId)).toBe(0);
  });

  it("отсрочка из карточки контрагента: заказ берёт её при заведении, долг считает срок от неё", async () => {
    const suppliersApi = (await import("../../supplier-router")).supplierRouter.createCaller(ctxFor(db, s.tenantId, s.agentId));
    const { id: sid } = await suppliersApi.create({ name: "Мельница", paymentTermsDays: 7 });
    expect((await suppliersApi.list()).find(r => r.id === sid)?.paymentTermsDays).toBe(7);

    const c = await po();
    const { id } = await c.create({ supplierId: sid, currency: "UZS", items: [{ productId: s.productId, quantity: "2", unitPrice: "50" }] });
    expect((await c.getById({ id })).paymentTermsDays).toBe(7);
    // Правка карточки потом заказ не трогает: договаривались на прежних условиях.
    await suppliersApi.update({ id: sid, paymentTermsDays: null });
    expect((await suppliersApi.list()).find(r => r.id === sid)?.paymentTermsDays).toBeNull();
    expect((await c.getById({ id })).paymentTermsDays).toBe(7);

    await (await director()).approve({ id });
    const { arrivalId } = await c.receive({ id, arrivalDate: DAY });
    await (await arr()).setItems({ id: arrivalId, items: [{ productId: s.productId, quantity: "2", expectedQuantity: "2", costPrice: "50.00" }] });
    await (await arr()).update({ id: arrivalId, status: "completed" });
    expect((await supplyOf(arrivalId)).due).toBe("2026-10-08");

    // Заказ без отсрочки у поставщика без отсрочки — срока нет.
    const { id: bare } = await c.create({ supplierId: sid, currency: "UZS", items: [{ productId: s.productId, quantity: "1", unitPrice: "50" }] });
    expect((await c.getById({ id: bare })).paymentTermsDays).toBeNull();
  });

  it("приход по заказу в списке и в документе: поставщик и номер заказа, пока поставки нет", async () => {
    const { id, number } = await approvedOrder();
    const { arrivalId } = await (await po()).receive({ id, arrivalDate: DAY });

    // До проведения поставки нет (ADR 0013) — поставщик берётся из заказа, а не прочерк.
    const listed = (await (await arr()).list()).data.find(r => r.id === arrivalId)!;
    expect(listed.supplierName).toBe("Завод");
    expect(listed.purchaseOrderNumber).toBe(number);
    expect(listed.purchaseOrderId).toBe(id);
    const doc = (await (await arr()).getById({ id: arrivalId }))!;
    expect(doc.purchaseOrder).toMatchObject({ id, number, supplierId, supplierName: "Завод", currency: "UZS", paymentTermsDays: 10 });

    // Приход сам по себе — ни заказа, ни поставщика.
    const plain = await (await arr()).create({ arrivalDate: DAY, items: [{ productId: s.productId, quantity: "1", costPrice: "50" }] });
    const plainId = plain.id;
    const plainRow = (await (await arr()).list()).data.find(r => r.id === plainId)!;
    expect(plainRow.supplierName).toBeNull();
    expect(plainRow.purchaseOrderNumber).toBeNull();
    expect((await (await arr()).getById({ id: plainId }))!.purchaseOrder).toBeNull();
  });

  it("ссылка прихода на чужой заказ не раскрывает ни номера, ни поставщика", async () => {
    // Своя организация такой ссылки не заведёт; проверяется, что чтение всё равно смотрит организацию.
    const d = db as any;
    const [foreignSup] = await d.insert(schema.suppliers).values({ tenantId: s.otherTenantId, name: "Чужой завод" });
    const [foreignWh] = await d.insert(schema.warehouses).values({ tenantId: s.otherTenantId, name: "Чужой склад", isDefault: true });
    const [stranger] = await d.insert(schema.users).values({ tenantId: s.otherTenantId, name: "Чужой", email: "y@other.local", passwordHash: "x", role: "operator" });
    const [foreignPo] = await d.insert(schema.purchaseOrders).values({
      tenantId: s.otherTenantId, number: "PO-77", supplierId: Number(foreignSup.insertId), warehouseId: Number(foreignWh.insertId),
      currency: "UZS", status: "approved", createdBy: Number(stranger.insertId),
    });
    const plain = await (await arr()).create({ arrivalDate: DAY, items: [{ productId: s.productId, quantity: "1", costPrice: "50" }] });
    const arrivalId = plain.id;
    await db.execute(sql`UPDATE arrivals SET purchase_order_id = ${Number(foreignPo.insertId)} WHERE id = ${arrivalId}`);

    const row = (await (await arr()).list()).data.find(r => r.id === arrivalId)!;
    expect(row.supplierName).toBeNull();
    expect(row.purchaseOrderNumber).toBeNull();
    expect((await (await arr()).getById({ id: arrivalId }))!.purchaseOrder).toBeNull();
  });

  it("чужая организация: ни заказа, ни поставщика", async () => {
    const { id } = await approvedOrder();
    const d = db as any;
    const [stranger] = await d.insert(schema.users).values({ tenantId: s.otherTenantId, name: "Чужой", email: "x@other.local", passwordHash: "x", role: "operator" });
    await d.insert(schema.warehouses).values({ tenantId: s.otherTenantId, name: "Чужой склад", isDefault: true });
    const other = await po("operator", Number(stranger.insertId), s.otherTenantId);
    await expect(other.getById({ id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(other.receive({ id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(other.create({ supplierId, currency: "UZS", items: [{ productId: s.productId, quantity: "1", unitPrice: "1" }] }))
      .rejects.toThrow(/Поставщик не найден/);
    const list = await other.list();
    expect(list.total).toBe(0);
    const mine = await (await po()).list();
    expect(mine.data.map(r => r.id)).toEqual([id]);
    expect(mine.summary).toMatchObject({ open: 1, plannedUzs: 1800 });
    expect((await d.select().from(schema.purchaseOrders).where(and(eq(schema.purchaseOrders.tenantId, s.otherTenantId)))).length).toBe(0);
  });
});
