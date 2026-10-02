/**
 * «Сроки» и уценка — на настоящей базе.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Экран сроков отвечал «что и когда сгорает», но не «уйдёт ли само», и
 * подсказку «продать со скидкой» нечем было исполнить: прайс-лист у магазина
 * один, и «распродажа» сняла бы магазины с их цен.
 *
 * ── Что проверяется ─────────────────────────────────────────────────────────
 *
 *  1. Темп: доставленные заказы за 28 полных дней минус проведённые возвраты
 *     по ним; отменённые, старые, сегодняшние и возвраты по отменённым — мимо.
 *     FEFO: вторая партия получает только остаток спроса.
 *  2. Партия второго склада — «не на основном» и спрос основного не ест;
 *     просроченная — отдельно, деньги потеряны.
 *  3. Роль: оператору закупка, маржа и «сгорит по закупке» не уходят.
 *  4. Уценка — потолок в заказе и каталоге: у кого по списку дешевле —
 *     дешевле; ступени срезаны; строка без прайс-листа. Кончилась партия или
 *     прошёл срок — цена обычная, без чьих-либо действий.
 *  5. Права и отказы: ниже закупки — только директор; не ниже карточки нельзя;
 *     просроченная, не с основного, чужая партия — отказ; журнал пишет.
 *  6. Снять уценку — цена обычная; «Сроки» видят уценку и считают её в своде.
 *
 * Нарочная поломка: в price-resolver убрать потолок в resolvePrices —
 * падает 4; в activeMarkdowns убрать условие `quantity > 0` (или join партии)
 * — падает 4 («кончилась партия»); в returnedQtyByProduct убрать
 * revenueOrderConditions — падает 1; в forViewer вернуть строки как есть —
 * падает 3; в setMarkdown убрать проверку роли — падает 5.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import * as schema from "@db/schema";
import { ctxFor, hasRealDb, connectRealDb, closeRealDb, truncateAll, seed, countOf, type ServiceDb, type Seeded } from "./harness";
import { invalidateReports } from "../../lib/report-cache";
import { receiveStock, shipStock } from "../../services/stock-ledger";
import { OrderService } from "../../services/order";
import { dayKey } from "../../lib/period";

let current: ServiceDb;
vi.mock("../../queries/connection", () => ({
  getDb: () => current,
  getPool: () => null,
}));

/** День «через n дней» по календарю сервера — как считает сам план. */
const day = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return dayKey(d); };
/** Полдень n дней назад, целые секунды: MySQL округляет доли ВВЕРХ. */
const noonAgo = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); d.setHours(12, 0, 0, 0); return d; };

describe.skipIf(!hasRealDb)("«Сроки» и уценка на настоящей базе", () => {
  let db: ServiceDb;
  let s: Seeded;
  let k = 0;

  beforeAll(async () => { db = await connectRealDb(); current = db; }, 180_000);
  afterAll(async () => { await closeRealDb(); });
  beforeEach(async () => {
    await truncateAll();
    s = await seed("0.000");
    await invalidateReports(s.tenantId, "test");
    await db.update(schema.products).set({ costPrice: "60.00" } as never).where(eq(schema.products.id, s.productId));
  });

  const receive = (quantity: number, batchNumber: string, expiresIn: number, opts: { cost?: string; warehouseId?: number; productId?: number } = {}) =>
    receiveStock(db as never, {
      tenantId: s.tenantId, warehouseId: opts.warehouseId ?? s.warehouseId, productId: opts.productId ?? s.productId,
      quantity, reason: "arrival", batch: { batchNumber, expiresAt: day(expiresIn), costPrice: opts.cost ?? null },
    });

  async function batchId(batchNumber: string): Promise<number> {
    const [row] = await db.select({ id: schema.stockBatches.id }).from(schema.stockBatches)
      .where(and(eq(schema.stockBatches.tenantId, s.tenantId), eq(schema.stockBatches.batchNumber, batchNumber)));
    return Number(row!.id);
  }

  async function sold(quantity: number, daysAgo: number, status = "delivered", productId = s.productId): Promise<number> {
    const at = noonAgo(daysAgo);
    const [o] = await db.insert(schema.orders).values({
      tenantId: s.tenantId, shopId: s.shopId, agentId: s.agentId, orderNumber: `T-${++k}`,
      status: status as never, paymentMethod: "cash", subtotal: "0", total: "0", createdAt: at,
    } as never);
    const orderId = Number(o.insertId);
    await db.insert(schema.orderItems).values({ orderId, productId, quantity: String(quantity), unitPrice: "100.00", costPrice: "60.00", subtotal: String(quantity * 100) } as never);
    return orderId;
  }

  async function returned(orderId: number, quantity: number, daysAgo: number, status = "completed") {
    const at = noonAgo(daysAgo);
    const [r] = await db.insert(schema.returns).values({
      tenantId: s.tenantId, shopId: s.shopId, orderId, returnNumber: `В-${++k}`, status: status as never,
      totalAmount: String(quantity * 100), createdAt: at,
    } as never);
    await db.insert(schema.returnItems).values({ returnId: Number(r.insertId), productId: s.productId, quantity: String(quantity), unitPrice: "100.00", subtotal: String(quantity * 100) } as never);
  }

  const reports = async (role = "ceo") => (await import("../../warehouse-reports-router")).warehouseReportsRouter.createCaller(ctxFor(current, s.tenantId, s.agentId, role));
  const prices = async (role = "ceo") => (await import("../../price-list-router")).priceListRouter.createCaller(ctxFor(current, s.tenantId, s.agentId, role));
  const fresh = () => invalidateReports(s.tenantId, "test");

  async function orderLine(shopId: number, quantity: string) {
    const r = await OrderService.create(db, s.tenantId, s.agentId, { shopId, items: [{ productId: s.productId, quantity }], idempotencyKey: `md-${++k}` });
    const [line] = await db.select({ unitPrice: schema.orderItems.unitPrice, priceListId: schema.orderItems.priceListId })
      .from(schema.orderItems).where(eq(schema.orderItems.orderId, r.id));
    return line!;
  }

  it("1. темп — 28 полных дней, доставленное минус проведённые возвраты; FEFO делит спрос по сроку", async () => {
    const good = await sold(280, 5);
    await returned(good, 28, 2);                       // −28 → темп (280 − 28) / 28 = 9
    const cancelled = await sold(100, 3, "cancelled"); // отменённый — не продажа
    await returned(cancelled, 50, 2);                  // и возврат по нему не вычитается
    await returned(good, 70, 1, "pending");            // не проведён — не в счёт
    await sold(500, 40);                               // до окна
    await sold(90, 0);                                 // сегодня — день ещё не кончился

    await receive(30, "A", 5, { cost: "60.00" });      // 9 в день × 5 дней = 45 ≥ 30 — успеет за 4 дня
    await receive(100, "B", 10, { cost: "50.00" });    // 9 × 10 = 90, из них 30 съест A → 60 из 100

    const rows = await (await reports()).expiring({ withinDays: 30 });
    const a = rows.find(r => r.batchNumber === "A")!;
    const b = rows.find(r => r.batchNumber === "B")!;
    expect(a).toMatchObject({ pacePerDay: 9, verdict: "sells", sold: 30, unsold: 0, sellOutDays: 4, daysLeft: 5, atRiskCost: 0, advice: null });
    expect(b).toMatchObject({ pacePerDay: 9, verdict: "short", sold: 60, unsold: 40, daysLeft: 10 });
    // Деньги — по закупке ЭТОЙ партии: 40 × 50, а не × 60 из карточки.
    expect(b.atRiskCost).toBe(2000);
    expect(b.atRiskSale).toBe(4000);
    // 10 дней до срока — скидка 20 %: 80 при закупке 50 — маржа 30.
    expect(b.advice).toEqual({ pct: 20, price: 80 });
    expect(b.adviceMoney).toMatchObject({ unitMargin: 30, belowCost: false, recovered: 3200, writeOff: 2000 });
  });

  it("2. партия второго склада — «не на основном», спрос основного не ест; просроченная — отдельно", async () => {
    const [w] = await db.insert(schema.warehouses).values({ tenantId: s.tenantId, name: "Второй", isDefault: false } as never);
    const second = Number(w.insertId);
    await db.insert(schema.warehouseStock).values({ tenantId: s.tenantId, productId: s.productId, warehouseId: second, currentStock: "0", reserved: "0", available: "0" } as never);
    await sold(280, 3);                                  // 10 в день
    await receive(20, "ДАЛЕКО", 3, { warehouseId: second });
    await receive(50, "ТУТ", 5);                         // весь спрос — её: 50 за 5 дней
    await receive(12, "СГОРЕЛА", -2);

    const rows = await (await reports()).expiring({ withinDays: 30 });
    expect(rows.find(r => r.batchNumber === "ДАЛЕКО")).toMatchObject({ verdict: "elsewhere", onDefault: false, sold: 0, unsold: 20, advice: null });
    expect(rows.find(r => r.batchNumber === "ТУТ")).toMatchObject({ verdict: "sells", sold: 50, unsold: 0 });
    expect(rows.find(r => r.batchNumber === "СГОРЕЛА")).toMatchObject({ verdict: "expired", daysLeft: -2, unsold: 12, atRiskCost: 720, state: "expired" });

    const sum = await (await reports()).expiringSummary({ withinDays: 30 });
    expect(sum).toMatchObject({ riskCount: 1, riskCost: 1200, expiredCount: 1, expiredCost: 720, sellsCount: 1 });
  });

  it("3. оператор не получает закупку и маржу — только цену продажи", async () => {
    await receive(100, "B", 10, { cost: "90.00" });     // продаж нет; скидка 20 % → 80 < 90
    const op = await (await reports("operator")).expiring({ withinDays: 30 });
    expect(op[0]).toMatchObject({ verdict: "no_sales", costPrice: null, value: null, atRiskCost: null, adviceMoney: null, atRiskSale: 10000, needsDirector: true, advice: { pct: 20, price: 80 } });
    const sum = await (await reports("operator")).expiringSummary({ withinDays: 30 });
    expect(sum).toMatchObject({ riskCost: null, expiredCost: null, riskSale: 10000 });
    const ceo = await (await reports("ceo")).expiring({ withinDays: 30 });
    expect(ceo[0]).toMatchObject({ costPrice: 90, atRiskCost: 9000, adviceMoney: { belowCost: true } });
  });

  it("4. уценка — потолок в заказе и каталоге; кончилась партия или прошёл срок — цена сама обычная", async () => {
    await receive(100, "B", 10, { cost: "50.00" });
    await receive(20, "СВЕЖАЯ", 200, { cost: "50.00" });
    const b = await batchId("B");
    expect(await (await prices()).setMarkdown({ batchId: b, price: 80 })).toMatchObject({ success: true, endsOn: day(10) });

    // Магазин без списка — 80, и строка без прайс-листа: цену дал не список.
    expect(await orderLine(s.shopId, "2")).toEqual({ unitPrice: "80.00", priceListId: null });

    // Магазин со своим списком дешевле — остаётся дешевле.
    const [cheapShop] = await db.insert(schema.shops).values({ tenantId: s.tenantId, name: "Дешёвый" } as never);
    const cheap = Number(cheapShop.insertId);
    const [pl] = await db.insert(schema.priceLists).values({ tenantId: s.tenantId, name: "Опт", priority: 1, isActive: true } as never);
    await db.insert(schema.priceListItems).values({ priceListId: Number(pl.insertId), productId: s.productId, minQuantity: "1", price: "70.00" } as never);
    await db.insert(schema.priceListAssignments).values({ priceListId: Number(pl.insertId), shopId: cheap } as never);
    expect(await orderLine(cheap, "2")).toEqual({ unitPrice: "70.00", priceListId: Number(pl.insertId) });

    // Ступень «от 10 — 90» срезана до 80 — и в каталоге, и в заказе.
    const [tierShop] = await db.insert(schema.shops).values({ tenantId: s.tenantId, name: "Ступени" } as never);
    const tiered = Number(tierShop.insertId);
    const [tl] = await db.insert(schema.priceLists).values({ tenantId: s.tenantId, name: "Объём", priority: 1, isActive: true } as never);
    await db.insert(schema.priceListItems).values({ priceListId: Number(tl.insertId), productId: s.productId, minQuantity: "10", price: "90.00" } as never);
    await db.insert(schema.priceListAssignments).values({ priceListId: Number(tl.insertId), shopId: tiered } as never);
    const { resolveCatalog } = await import("../../services/price-resolver");
    const cat = (await resolveCatalog(db, s.tenantId, { shopId: tiered }, new Map([[s.productId, "100.00"]]))).get(s.productId)!;
    expect(cat.price).toBe("80.00");
    expect(cat.tiers?.map(t => t.price)).toEqual(["80.00"]);
    expect(cat.markdown).toMatchObject({ price: "80.00", endsOn: day(10), batchId: b });
    expect((await orderLine(tiered, "12")).unitPrice).toBe("80.00");

    // Каталог агента без магазина: цена срезана, карточка рядом, уценка названа.
    const products = (await import("../../product-router")).productRouter.createCaller(ctxFor(current, s.tenantId, s.agentId, "agent"));
    const feed = await products.listAll();
    expect(feed.find(p => p.id === s.productId)).toMatchObject({ unitPrice: "80.00", basePrice: "100.00", markdown: { price: "80.00", endsOn: day(10) } });

    // Партия ушла (FEFO отгружает её первой) — уценки больше нет.
    await shipStock(db as never, { tenantId: s.tenantId, warehouseId: s.warehouseId, items: [{ productId: s.productId, orderedQuantity: 100, deliveredQuantity: 100 }], reason: "order_delivery" });
    expect(await countOf("stock_batches", "batch_number = 'B'"), "партия не кончилась — проверка ниже ни о чём").toBe(0);
    expect((await orderLine(s.shopId, "1")).unitPrice).toBe("100.00");

    // Срок прошёл — тоже обычная цена, даже если партия есть.
    await receive(100, "C", 10, { cost: "50.00" });
    await (await prices()).setMarkdown({ batchId: await batchId("C"), price: 75 });
    expect((await orderLine(s.shopId, "1")).unitPrice).toBe("75.00");
    await db.execute(sql`UPDATE markdowns SET ends_on = ${day(-1)} WHERE tenant_id = ${s.tenantId}`);
    expect((await orderLine(s.shopId, "1")).unitPrice).toBe("100.00");
  });

  it("5. права и отказы: ниже закупки — только директор; не ниже карточки; просроченная, чужой склад, чужая партия — нет", async () => {
    await receive(100, "B", 10, { cost: "60.00" });
    const b = await batchId("B");
    await expect((await prices("operator")).setMarkdown({ batchId: b, price: 55 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await countOf("markdowns")).toBe(0);
    await expect((await prices("operator")).setMarkdown({ batchId: b, price: 65 })).resolves.toMatchObject({ success: true });
    await expect((await prices("ceo")).setMarkdown({ batchId: b, price: 55 })).resolves.toMatchObject({ success: true });
    // Одна уценка на товар: вторая перезаписала первую.
    expect(await countOf("markdowns")).toBe(1);
    await expect((await prices()).setMarkdown({ batchId: b, price: 100 })).rejects.toMatchObject({ code: "BAD_REQUEST" });

    await receive(5, "СГОРЕЛА", -1);
    await expect((await prices()).setMarkdown({ batchId: await batchId("СГОРЕЛА"), price: 50 })).rejects.toMatchObject({ code: "BAD_REQUEST" });

    const [w] = await db.insert(schema.warehouses).values({ tenantId: s.tenantId, name: "Второй", isDefault: false } as never);
    await db.insert(schema.warehouseStock).values({ tenantId: s.tenantId, productId: s.productId, warehouseId: Number(w.insertId), currentStock: "0", reserved: "0", available: "0" } as never);
    await receive(5, "ДАЛЕКО", 10, { warehouseId: Number(w.insertId) });
    await expect((await prices()).setMarkdown({ batchId: await batchId("ДАЛЕКО"), price: 50 })).rejects.toMatchObject({ code: "BAD_REQUEST" });

    const other = (await import("../../price-list-router")).priceListRouter.createCaller(ctxFor(current, s.otherTenantId, s.agentId, "ceo"));
    await expect(other.setMarkdown({ batchId: b, price: 50 })).rejects.toMatchObject({ code: "NOT_FOUND" });

    expect(await countOf("audit_log", "action = 'price.markdown_set'")).toBe(2);
  });

  it("6. «Сроки» видят уценку и считают её; снять — цена обычная, запись в журнале", async () => {
    await receive(100, "B", 10, { cost: "50.00" });
    await (await prices()).setMarkdown({ batchId: await batchId("B"), price: 80 });
    await fresh();
    const rows = await (await reports()).expiring({ withinDays: 30 });
    expect(rows[0].markdown).toEqual({ price: 80, endsOn: day(10), batchId: await batchId("B") });
    expect(await (await reports()).expiringSummary({ withinDays: 30 })).toMatchObject({ riskCount: 1, markedDown: 1 });

    expect(await (await prices()).clearMarkdown({ productId: s.productId })).toEqual({ success: true, removed: true });
    expect(await (await prices()).clearMarkdown({ productId: s.productId })).toEqual({ success: true, removed: false });
    expect((await orderLine(s.shopId, "1")).unitPrice).toBe("100.00");
    expect(await countOf("audit_log", "action = 'price.markdown_cleared'")).toBe(1);
  });
});
