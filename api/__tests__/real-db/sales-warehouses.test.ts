/**
 * Продажи с нескольких складов (ADR 0012) — на настоящей базе.
 *
 * Организация: основной склад W1 (10 шт.), точка продаж W2 «Филиал» (5 шт.)
 * и склад хранения W3 (7 шт.). Агент филиала закреплён за W2, обычный агент
 * — ни за чем (значит, основной).
 *
 * Проверяется то, на чём держатся деньги и остаток:
 *   1. заказ агента филиала резервирует, правится, доставляется и отменяется
 *      на W2, основной не трогается;
 *   2. долг магазина (recalcShopDebt) тот же, с какого бы склада ни продали;
 *   3. полевой выбрать склад не может, офис — только склад продаж своей
 *      организации;
 *   4. склад перестал продавать — новый заказ с основного; старый заказ без
 *      склада снимает резерв с основного, а не со склада агента;
 *   5. каталог показывает остаток склада продажи, и кэш не путает склады;
 *   6. уценка партии W1 не дешевит товар W2, и наоборот;
 *   7. погрузочный лист не смешивает склады;
 *   8. возврат по заказу филиала ложится на полку филиала;
 *   9. сотруднику назначают только склад продаж своей организации;
 *  10. склад, с которого продают, не отключают молча;
 *  11. публичный API фильтрует и отдаёт склад заказа;
 *  12. тревога «заканчивается» — по складам продаж, склад хранения молчит.
 *
 * Нарочные поломки:
 *   · в order-create передай resolveOrderWarehouse без agentId — падает 1;
 *   · в resolvePrices убери warehouseId из activeMarkdowns — падает 6;
 *   · в orderWarehouseId верни resolveOrderWarehouse(tx, tenantId, { agentId })
 *     (склад агента для старых заказов) — падает 4;
 *   · убери `:wh${warehouseId ?? 0}` из ключа listAll — падает 5;
 *   · в loading-list убери проверку byWarehouse.size — падает 7;
 *   · в returns-router верни основной склад — падает 8;
 *   · в runLowStockAlerts верни соединение только с основным — падает 12.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { createHash } from "node:crypto";
import { and, eq, isNotNull } from "drizzle-orm";
import * as schema from "@db/schema";
import { ctxFor, hasRealDb, connectRealDb, closeRealDb, truncateAll, seed, countOf, type ServiceDb, type Seeded } from "./harness";
import { OrderService } from "../../services/order";
import { LoadingListService } from "../../services/loading-list";
import { recalcShopDebt } from "../../services/shop-debt";
import { receiveStock } from "../../services/stock-ledger";
import { invalidateReports } from "../../lib/report-cache";
import { dayKey } from "../../lib/period";

let current: ServiceDb;
vi.mock("../../queries/connection", () => ({ getDb: () => current, getPool: () => null }));

const day = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return dayKey(d); };
const RAW_KEY = "wp_live_" + "w".repeat(48);

describe.skipIf(!hasRealDb)("продажи с нескольких складов", () => {
  let db: ServiceDb;
  let s: Seeded;
  let w2 = 0;
  let w3 = 0;
  let branchAgent = 0;
  let operatorId = 0;
  let ceoId = 0;
  let shopB = 0;
  let k = 0;

  beforeAll(async () => { db = await connectRealDb(); current = db; }, 180_000);
  afterAll(async () => { await closeRealDb(); });
  beforeEach(async () => {
    await truncateAll();
    s = await seed("10.000");
    await invalidateReports(s.tenantId, "test");
    const [b] = await db.insert(schema.warehouses).values({ tenantId: s.tenantId, name: "Филиал", isDefault: false, isSalesPoint: true } as never);
    w2 = Number(b.insertId);
    const [st] = await db.insert(schema.warehouses).values({ tenantId: s.tenantId, name: "Хранение", isDefault: false } as never);
    w3 = Number(st.insertId);
    await db.insert(schema.warehouseStock).values([
      { tenantId: s.tenantId, productId: s.productId, warehouseId: w2, currentStock: "5.000", reserved: "0.000", available: "5.000" },
      { tenantId: s.tenantId, productId: s.secondProductId, warehouseId: w2, currentStock: "5.000", reserved: "0.000", available: "5.000" },
      { tenantId: s.tenantId, productId: s.productId, warehouseId: w3, currentStock: "7.000", reserved: "0.000", available: "7.000" },
    ] as never);
    const [a] = await db.insert(schema.users).values({ tenantId: s.tenantId, name: "Агент филиала", email: "branch@test.local", passwordHash: "x", role: "agent", warehouseId: w2 } as never);
    branchAgent = Number(a.insertId);
    const [op] = await db.insert(schema.users).values({ tenantId: s.tenantId, name: "Оператор", email: "op@test.local", passwordHash: "x", role: "operator" } as never);
    operatorId = Number(op.insertId);
    const [ceo] = await db.insert(schema.users).values({ tenantId: s.tenantId, name: "Директор", email: "ceo@test.local", passwordHash: "x", role: "ceo" } as never);
    ceoId = Number(ceo.insertId);
    const [shop] = await db.insert(schema.shops).values({ tenantId: s.tenantId, name: "Магазин Бета" } as never);
    shopB = Number(shop.insertId);
  });

  const stockAt = async (warehouseId: number, productId = s.productId) => {
    const [r] = await db.select({ c: schema.warehouseStock.currentStock, r: schema.warehouseStock.reserved, a: schema.warehouseStock.available })
      .from(schema.warehouseStock).where(and(eq(schema.warehouseStock.productId, productId), eq(schema.warehouseStock.warehouseId, warehouseId)));
    return { current: Number(r!.c), reserved: Number(r!.r), available: Number(r!.a) };
  };
  const orderWarehouse = async (id: number) =>
    Number((await db.select({ w: schema.orders.warehouseId }).from(schema.orders).where(eq(schema.orders.id, id)))[0]!.w);
  const create = (agentId: number, quantity = "3", shopId = s.shopId, extra: Record<string, unknown> = {}) =>
    OrderService.create(db, s.tenantId, agentId, { shopId, items: [{ productId: s.productId, quantity }], idempotencyKey: `sw-${++k}`, ...extra });
  const orders = async (role: string, userId: number) => (await import("../../order-router")).orderRouter.createCaller(ctxFor(db, s.tenantId, userId, role));
  const catalog = async (role: string, userId: number, tenantId = s.tenantId) => (await import("../../product-router")).productRouter.createCaller(ctxFor(db, tenantId, userId, role));
  const people = async () => (await import("../../user-router")).userRouter.createCaller(ctxFor(db, s.tenantId, ceoId, "ceo"));
  const stores = async () => (await import("../../warehouse-multi-router")).warehouseMultiRouter.createCaller(ctxFor(db, s.tenantId, ceoId, "ceo"));
  const linePrice = async (orderId: number) =>
    (await db.select({ p: schema.orderItems.unitPrice }).from(schema.orderItems).where(eq(schema.orderItems.orderId, orderId)))[0]!.p;

  it("1. агент филиала резервирует, правит, отгружает и отменяет на своём складе; основной не тронут", async () => {
    const { id } = await create(branchAgent, "3");
    expect(await orderWarehouse(id)).toBe(w2);
    expect(await stockAt(w2)).toEqual({ current: 5, reserved: 3, available: 2 });
    // Карточка заказа называет склад — кладовщику видно, откуда везти.
    expect(await (await orders("operator", operatorId)).getById({ id })).toMatchObject({ warehouseId: w2, warehouseName: "Филиал" });
    expect(await stockAt(s.warehouseId)).toEqual({ current: 10, reserved: 0, available: 10 });

    // Правка состава — резерв растёт там же.
    const [line] = await db.select({ id: schema.orderItems.id }).from(schema.orderItems).where(eq(schema.orderItems.orderId, id));
    await OrderService.updateItems(db, s.tenantId, id, { items: [{ itemId: line!.id, quantity: 4 }] });
    expect(await stockAt(w2)).toEqual({ current: 5, reserved: 4, available: 1 });

    // Доставка — списание с филиала.
    await OrderService.updateStatus(db, s.tenantId, id, "delivered", { id: ceoId, role: "ceo" });
    expect(await stockAt(w2)).toEqual({ current: 1, reserved: 0, available: 1 });

    // Отмена второго заказа — резерв снят с филиала.
    const { id: second } = await create(branchAgent, "1");
    expect(await stockAt(w2)).toEqual({ current: 1, reserved: 1, available: 0 });
    await OrderService.cancel(db, s.tenantId, second, { userId: ceoId, userRole: "ceo" });
    expect(await stockAt(w2)).toEqual({ current: 1, reserved: 0, available: 1 });

    expect(await stockAt(s.warehouseId)).toEqual({ current: 10, reserved: 0, available: 10 });
    expect(await stockAt(w3)).toEqual({ current: 7, reserved: 0, available: 7 });
  });

  it("2. долг магазина один и тот же, с какого бы склада ни продали", async () => {
    const debtOf = async (shopId: number) => {
      await db.transaction(tx => recalcShopDebt(tx, s.tenantId, shopId));
      return (await db.select({ d: schema.shops.debt }).from(schema.shops).where(eq(schema.shops.id, shopId)))[0]!.d;
    };
    const fromDefault = await create(s.agentId, "3", s.shopId, { paymentMethod: "debt" });
    const fromBranch = await create(branchAgent, "3", shopB, { paymentMethod: "debt" });
    expect(await orderWarehouse(fromDefault.id)).toBe(s.warehouseId);
    expect(await orderWarehouse(fromBranch.id)).toBe(w2);
    for (const id of [fromDefault.id, fromBranch.id]) {
      await OrderService.recordDeliveryAndPayment(db, s.tenantId, { id: ceoId, role: "ceo" }, {
        orderId: id,
        deliveredItems: [{ itemId: (await db.select({ id: schema.orderItems.id }).from(schema.orderItems).where(eq(schema.orderItems.orderId, id)))[0]!.id, deliveredQuantity: 2, returnReason: "не взяли" }],
        payment: { paidAmount: "50", method: "cash" },
      });
    }
    // 2 × 100 − 50 = 150 у обоих.
    expect(await debtOf(s.shopId)).toBe("150.00");
    expect(await debtOf(shopB)).toBe(await debtOf(s.shopId));
    // И недоставленная единица вернулась на склад своего заказа.
    expect(await stockAt(w2)).toEqual({ current: 3, reserved: 0, available: 3 });
    expect(await stockAt(s.warehouseId)).toEqual({ current: 8, reserved: 0, available: 8 });
  });

  it("3. полевому склад не выбрать; офису — только склад продаж своей организации", async () => {
    const agent = await orders("agent", s.agentId);
    await expect(agent.create({ shopId: s.shopId, warehouseId: s.warehouseId, items: [{ productId: s.productId, quantity: 1 }] }))
      .rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("Склад заказа выбирает офис") });
    expect(await countOf("orders")).toBe(0);

    const op = await orders("operator", operatorId);
    const chosen = await op.create({ shopId: s.shopId, warehouseId: w2, items: [{ productId: s.productId, quantity: 2 }] });
    expect(await orderWarehouse(chosen.id)).toBe(w2);
    expect(await stockAt(w2)).toMatchObject({ reserved: 2 });

    await expect(op.create({ shopId: s.shopId, warehouseId: w3, items: [{ productId: s.productId, quantity: 1 }] }))
      .rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("С этого склада не продают") });
    const [alien] = await db.insert(schema.warehouses).values({ tenantId: s.otherTenantId, name: "Чужой", isDefault: true } as never);
    await expect(op.create({ shopId: s.shopId, warehouseId: Number(alien.insertId), items: [{ productId: s.productId, quantity: 1 }] }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await countOf("orders")).toBe(1);
  });

  it("4. склад перестал продавать — новый заказ с основного; старый заказ без склада — с основного, не со склада агента", async () => {
    await db.update(schema.warehouses).set({ isSalesPoint: false } as never).where(eq(schema.warehouses.id, w2));
    const { id } = await create(branchAgent, "2");
    expect(await orderWarehouse(id)).toBe(s.warehouseId);
    await db.update(schema.warehouses).set({ isSalesPoint: true } as never).where(eq(schema.warehouses.id, w2));

    // Заказ до колонки склада: резерв лёг на основной. Агент заказа теперь
    // закреплён за филиалом — отмена всё равно снимает с основного.
    const { id: legacy } = await create(s.agentId, "3");
    await db.update(schema.orders).set({ warehouseId: null, agentId: branchAgent } as never).where(eq(schema.orders.id, legacy));
    expect(await stockAt(s.warehouseId)).toEqual({ current: 10, reserved: 5, available: 5 });
    await OrderService.cancel(db, s.tenantId, legacy, { userId: ceoId, userRole: "ceo" });
    expect(await stockAt(s.warehouseId)).toEqual({ current: 10, reserved: 2, available: 8 });
    expect(await stockAt(w2)).toEqual({ current: 5, reserved: 0, available: 5 });
  });

  it("5. каталог — остаток склада продажи; кэш склады не путает; офис выбирает, полевой — нет", async () => {
    const availableIn = (rows: Array<{ id: number; available: string | null }>) => Number(rows.find(r => Number(r.id) === s.productId)!.available);
    expect(availableIn(await (await catalog("agent", s.agentId)).listAll())).toBe(10);
    expect(availableIn(await (await catalog("agent", branchAgent)).listAll())).toBe(5);
    expect(availableIn(await (await catalog("agent", s.agentId)).listAll())).toBe(10);
    expect(availableIn((await (await catalog("agent", branchAgent)).list({ pageSize: 50 })).data)).toBe(5);
    expect(availableIn((await (await catalog("agent", s.agentId)).list({ pageSize: 50 })).data)).toBe(10);
    expect(Number((await (await catalog("agent", branchAgent)).getById({ id: s.productId }))!.stock!.available)).toBe(5);

    const office = await catalog("operator", operatorId);
    expect(availableIn(await office.listAll({ warehouseId: w2 }))).toBe(5);
    expect(availableIn(await office.listAll())).toBe(10);
    // Склад того, на кого оформляют заказ (supervisor/office) — его склад продаж.
    expect(availableIn(await (await catalog("supervisor", operatorId)).listAll({ agentId: branchAgent }))).toBe(5);
    // Агент не может подсмотреть чужой склад через agentId — берётся его собственный.
    expect(availableIn(await (await catalog("agent", s.agentId)).listAll({ agentId: branchAgent }))).toBe(10);
    await expect(office.listAll({ warehouseId: w3 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect((await catalog("agent", s.agentId)).listAll({ warehouseId: w2 })).rejects.toMatchObject({ code: "BAD_REQUEST" });

    // Правка заказа: остаток склада заказа, у кого бы ни открыли.
    const { id } = await create(branchAgent, "1");
    expect(availableIn(await office.listAll({ orderId: id }))).toBe(4);
    expect(availableIn((await office.list({ orderId: id, pageSize: 50 })).data)).toBe(4);
    // Чужой заказ агенту не открывают и через каталог.
    await expect((await catalog("agent", s.agentId)).listAll({ orderId: id })).rejects.toMatchObject({ code: "FORBIDDEN" });

    // Черновик повтора — остаток склада повторяющего.
    const draft = await (await orders("agent", branchAgent)).repeatDraft({ orderId: id });
    expect(Number(draft.lines[0]!.available)).toBe(4);
  });

  it("6. уценка партии основного склада не меняет цену филиала, и наоборот", async () => {
    const prices = (await import("../../price-list-router")).priceListRouter.createCaller(ctxFor(db, s.tenantId, ceoId, "ceo"));
    const batchOf = async (n: string) => Number((await db.select({ id: schema.stockBatches.id }).from(schema.stockBatches)
      .where(and(eq(schema.stockBatches.tenantId, s.tenantId), eq(schema.stockBatches.batchNumber, n))))[0]!.id);
    await receiveStock(db as never, { tenantId: s.tenantId, warehouseId: s.warehouseId, productId: s.productId, quantity: 4, reason: "arrival", batch: { batchNumber: "W1", expiresAt: day(10), costPrice: null } });
    await receiveStock(db as never, { tenantId: s.tenantId, warehouseId: w2, productId: s.productId, quantity: 4, reason: "arrival", batch: { batchNumber: "W2", expiresAt: day(12), costPrice: null } });
    await receiveStock(db as never, { tenantId: s.tenantId, warehouseId: w3, productId: s.productId, quantity: 4, reason: "arrival", batch: { batchNumber: "W3", expiresAt: day(12), costPrice: null } });

    await prices.setMarkdown({ batchId: await batchOf("W1"), price: 70 });
    expect(await linePrice((await create(s.agentId, "1")).id)).toBe("70.00");
    expect(await linePrice((await create(branchAgent, "1")).id)).toBe("100.00");
    const price = (rows: Array<{ id: number; unitPrice: string; markdown: unknown }>) => rows.find(r => Number(r.id) === s.productId)!;
    expect(price(await (await catalog("agent", s.agentId)).listAll({ shopId: s.shopId }))).toMatchObject({ unitPrice: "70.00" });
    expect(price(await (await catalog("agent", branchAgent)).listAll({ shopId: s.shopId }))).toMatchObject({ unitPrice: "100.00", markdown: null });
    expect(price(await (await catalog("agent", branchAgent)).listAll())).toMatchObject({ unitPrice: "100.00", markdown: null });

    // Уценка партии филиала — только заказам филиала (уценка одна на товар).
    await prices.setMarkdown({ batchId: await batchOf("W2"), price: 65 });
    expect(await linePrice((await create(branchAgent, "1")).id)).toBe("65.00");
    expect(await linePrice((await create(s.agentId, "1")).id)).toBe("100.00");

    // Склад хранения уценку не принимает: с него не продают.
    await expect(prices.setMarkdown({ batchId: await batchOf("W3"), price: 60 })).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("С этого склада не продают") });
  });

  it("7. погрузочный лист: заказы разных складов — отказ со складами; один склад — лист этого склада", async () => {
    const a = await create(s.agentId, "1");
    const b = await create(branchAgent, "1");
    const c = await create(branchAgent, "1", shopB);
    await expect(LoadingListService.createLoadingList(db, s.tenantId, operatorId, { orderIds: [a.id, b.id], format: "aggregated" }))
      .rejects.toThrow(/Заказы с разных складов .*«Основной».*«Филиал»|Заказы с разных складов .*«Филиал».*«Основной»/);
    expect(await countOf("loading_lists")).toBe(0);
    await expect(LoadingListService.createLoadingList(db, s.tenantId, operatorId, { orderIds: [b.id, c.id], format: "aggregated", warehouseId: s.warehouseId }))
      .rejects.toThrow("Заказы зарезервированы на другом складе");
    const list = await LoadingListService.createLoadingList(db, s.tenantId, operatorId, { orderIds: [b.id, c.id], format: "aggregated" });
    const [row] = await db.select({ w: schema.loadingLists.warehouseId }).from(schema.loadingLists).where(eq(schema.loadingLists.id, list.listId));
    expect(Number(row!.w)).toBe(w2);
  });

  it("8. возврат по заказу филиала ложится на склад филиала", async () => {
    const { id } = await create(branchAgent, "3");
    await OrderService.updateStatus(db, s.tenantId, id, "delivered", { id: ceoId, role: "ceo" });
    expect(await stockAt(w2)).toEqual({ current: 2, reserved: 0, available: 2 });
    const returns = (await import("../../returns-router")).returnsRouter.createCaller(ctxFor(db, s.tenantId, operatorId, "operator"));
    const r = await returns.create({ orderId: id, shopId: s.shopId, reason: "wrong_item", items: [{ productId: s.productId, quantity: 2, unitPrice: 100 }] });
    await returns.updateStatus({ id: r.id, status: "approved" });
    await returns.updateStatus({ id: r.id, status: "completed", disposition: "restock" });
    expect(await stockAt(w2)).toEqual({ current: 4, reserved: 0, available: 4 });
    expect(await stockAt(s.warehouseId)).toEqual({ current: 10, reserved: 0, available: 10 });
  });

  it("9. сотруднику — только склад продаж своей организации; смена в журнале", async () => {
    const u = await people();
    await expect(u.update({ id: s.agentId, warehouseId: w3 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const [alien] = await db.insert(schema.warehouses).values({ tenantId: s.otherTenantId, name: "Чужой", isDefault: true } as never);
    await expect(u.update({ id: s.agentId, warehouseId: Number(alien.insertId) })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const stored = async () => (await db.select({ w: schema.users.warehouseId }).from(schema.users).where(eq(schema.users.id, s.agentId)))[0]!.w;
    expect(await stored()).toBeNull();

    await u.update({ id: s.agentId, warehouseId: w2 });
    expect(Number(await stored())).toBe(w2);
    expect(await orderWarehouse((await create(s.agentId, "1")).id)).toBe(w2);
    const [audit] = await db.select({ meta: schema.auditLog.meta }).from(schema.auditLog)
      .where(and(eq(schema.auditLog.tenantId, s.tenantId), eq(schema.auditLog.action, "user.updated")));
    expect(audit!.meta).toMatchObject({ before: { warehouse: null }, after: { warehouse: "Филиал" } });
    // Не прислали — не трогаем; null — снять.
    await u.update({ id: s.agentId, name: "Агент" });
    expect(Number(await stored())).toBe(w2);
    await u.update({ id: s.agentId, warehouseId: null });
    expect(await stored()).toBeNull();
    // Список сотрудников показывает склад.
    const listed = await u.list({ pageSize: 50 });
    expect(listed.data.find(x => Number(x.id) === branchAgent)).toMatchObject({ warehouseId: w2 });
  });

  it("10. склад, с которого продают, не отключают молча", async () => {
    const w = await stores();
    await expect(w.update({ id: w2, status: "inactive" })).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("продают 1 сотр.") });
    await expect(w.update({ id: w2, isSalesPoint: false })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(w.update({ id: s.warehouseId, status: "inactive" })).rejects.toMatchObject({ message: expect.stringContaining("Основной склад не отключают") });

    await (await people()).update({ id: branchAgent, warehouseId: null });
    const { id } = await (await orders("operator", operatorId)).create({ shopId: s.shopId, warehouseId: w2, items: [{ productId: s.productId, quantity: 1 }] });
    await expect(w.update({ id: w2, status: "inactive" })).rejects.toMatchObject({ message: expect.stringContaining("под резервом открытых заказов 1") });
    await OrderService.cancel(db, s.tenantId, id, { userId: ceoId, userRole: "ceo" });

    await w.update({ id: w2, isSalesPoint: false });
    await w.update({ id: w2, status: "inactive" });
    expect(await countOf("audit_log", "action = 'warehouse.updated'")).toBe(2);
    // Отключённый склад больше не назначить.
    await expect((await people()).update({ id: branchAgent, warehouseId: w2 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("11. публичный API: фильтр по складу заказа, склад в строке; старый заказ — основного склада", async () => {
    await db.update(schema.tenants).set({ plan: "exclusive" } as never).where(eq(schema.tenants.id, s.tenantId));
    await db.insert(schema.subscriptions).values({
      id: `sub_${s.tenantId}`, tenantId: s.tenantId, plan: "exclusive", status: "active",
      currentPeriodEnds: new Date(Date.now() + 30 * 86_400_000),
    } as never);
    await db.insert(schema.apiKeys).values({
      tenantId: s.tenantId, name: "integrator", keyHash: createHash("sha256").update(RAW_KEY).digest("hex"),
      keyPrefix: RAW_KEY.slice(0, 12), scopes: "orders", rateLimit: 600,
    } as never);
    const main = await create(s.agentId, "1");
    const branch = await create(branchAgent, "1");
    const legacy = await create(s.agentId, "1");
    await db.update(schema.orders).set({ warehouseId: null } as never).where(eq(schema.orders.id, legacy.id));

    const app = (await import("../../public-api")).default;
    const get = async (q: string) => {
      const r = await app.request(`/orders${q}`, { headers: { authorization: `Bearer ${RAW_KEY}` } });
      expect(r.status, await r.clone().text()).toBe(200);
      return (await r.json()) as { data: Array<{ order_id: number; warehouse_id: number | null }>; total_count?: number };
    };
    const pairs = (b: { data: Array<{ order_id: number; warehouse_id: number | null }> }) => b.data.map(o => [o.order_id, o.warehouse_id]);
    expect(pairs(await get(""))).toEqual([[main.id, s.warehouseId], [branch.id, w2], [legacy.id, s.warehouseId]]);
    expect(pairs(await get(`?warehouse_id=${w2}`))).toEqual([[branch.id, w2]]);
    expect(pairs(await get(`?warehouse_id=${s.warehouseId}`))).toEqual([[main.id, s.warehouseId], [legacy.id, s.warehouseId]]);
    expect(pairs(await get(`?warehouse_id=${w3}`))).toEqual([]);
  });

  it("12. тревога «заканчивается» — по складам продаж, со складом в имени; склад хранения молчит", async () => {
    // Порог 8: основной (10) выше, филиал (5) и хранение (7) — ниже.
    await db.update(schema.products).set({ reorderPoint: "8.00" } as never).where(eq(schema.products.id, s.productId));
    const { runLowStockAlerts } = await import("../../services/reorder");
    expect(await runLowStockAlerts(db as never)).toMatchObject({ alerted: 1, tenants: 1 });
    const alerted = await db.select({ w: schema.warehouseStock.warehouseId }).from(schema.warehouseStock)
      .where(and(eq(schema.warehouseStock.tenantId, s.tenantId), isNotNull(schema.warehouseStock.lowStockAlertedAt)));
    expect(alerted.map(r => Number(r.w))).toEqual([w2]);
    const [note] = await db.select({ title: schema.notifications.title }).from(schema.notifications)
      .where(and(eq(schema.notifications.tenantId, s.tenantId), eq(schema.notifications.type, "stock")));
    expect(note!.title).toBe("Заканчивается: Товар («Филиал»)");
    // Повторный проход молчит: пересечение уже отмечено.
    expect(await runLowStockAlerts(db as never)).toMatchObject({ alerted: 0 });
  });
});
