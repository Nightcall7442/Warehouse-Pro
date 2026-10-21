/**
 * Инвентаризация и правка остатка — с утверждением директора.
 *
 * ── Что проверяется и почему на настоящей базе ──────────────────────────────
 *
 * Утверждение проводит РАЗНИЦУ «посчитано − учёт при отправке» поверх
 * текущего остатка, под замком строки. Подделка базы не исполняет ни
 * FOR UPDATE, ни поднятия уникальных индексов, ни арифметики остатка в SQL —
 * проверять это ею значило бы проверять подделку.
 *
 *   • продажа между отправкой и утверждением остаётся в остатке;
 *   • оператор не утверждает — ни свой документ, ни чужой;
 *   • отказ возвращает черновик со словами директора, остаток цел;
 *   • счёт по категории берёт только эту категорию, по выбранным — ровно их;
 *   • у оператора без права warehouse.apply ручная правка становится заявкой,
 *     списание после утверждения забирает просроченную партию первой;
 *   • директор и оператор с правом (умолчание) работают как раньше.
 *
 * Нарочная поломка: в applyCountLines поставить `target = counted` вместо
 * `current + (counted − book)` — первый тест увидит 7 вместо 4.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import * as schema from "@db/schema";
import { applyStockEffect, receiveStock } from "../../services/stock-ledger";
import { forgetCapabilities } from "../../lib/role-permissions";
import { ctxFor, hasRealDb, connectRealDb, closeRealDb, truncateAll, seed, stockOf, countOf, type ServiceDb, type Seeded } from "./harness";

let current: ServiceDb;
vi.mock("../../queries/connection", () => ({ getDb: () => current, getPool: () => null }));

const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

describe.skipIf(!hasRealDb)("инвентаризация на утверждении директора", () => {
  let db: ServiceDb;
  let s: Seeded;
  let ceoId: number;
  let operatorId: number;

  beforeAll(async () => { db = await connectRealDb(); current = db; }, 180_000);
  afterAll(async () => { await closeRealDb(); });
  beforeEach(async () => {
    await truncateAll();
    s = await seed("10.000");
    const [ceo] = await db.insert(schema.users).values({ tenantId: s.tenantId, name: "Директор", email: "ceo@test.local", passwordHash: "x", role: "ceo" });
    ceoId = Number(ceo.insertId);
    const [op] = await db.insert(schema.users).values({ tenantId: s.tenantId, name: "Оператор", email: "op@test.local", passwordHash: "x", role: "operator" });
    operatorId = Number(op.insertId);
    // Номера организаций после очистки идут заново — запрет прошлого теста
    // в памяти процесса достался бы этой организации.
    forgetCapabilities(s.tenantId, "operator");
  });

  const counts = async (userId: number, role: string) => (await import("../../stock-count-router")).stockCountRouter.createCaller(ctxFor(db, s.tenantId, userId, role));
  const asOperator = () => counts(operatorId, "operator");
  const asCeo = () => counts(ceoId, "ceo");
  const warehouse = async (userId: number, role: string) => (await import("../../warehouse-router")).warehouseRouter.createCaller(ctxFor(db, s.tenantId, userId, role));

  /** Директор выключил оператору «проводить без утверждения». */
  const denyApply = async () => {
    const access = (await import("../../access-router")).accessRouter.createCaller(ctxFor(db, s.tenantId, ceoId, "ceo"));
    await access.setOperatorAccess({ capabilities: { "warehouse.apply": false } });
  };

  /** Продажа: товар ушёл со склада по заказу — через дверь, как у доставки. */
  const sell = (productId: number, quantity: number) => db.transaction(tx => applyStockEffect(tx, {
    tenantId: s.tenantId, warehouseId: s.warehouseId, items: [{ productId, quantity }],
    shift: { onHand: -1, held: 0 }, reason: "order_delivery",
  }));

  const notesOf = async (userId: number) => (await db.select({ title: schema.notifications.title, titleUz: schema.notifications.titleUz })
    .from(schema.notifications).where(and(eq(schema.notifications.tenantId, s.tenantId), eq(schema.notifications.userId, userId))));

  it("продажа между отправкой и утверждением остаётся в остатке: проводится разница, а не число", async () => {
    const op = await asOperator();
    const { id, number } = await op.create({ warehouseId: s.warehouseId });
    await op.setCounted({ id, productId: s.productId, counted: 7 });      // на полке 7 из 10
    await op.submitCount({ id });

    // Документ закрыт для правки, остаток не тронут, директору — уведомление на двух языках.
    await expect(op.setCounted({ id, productId: s.productId, counted: 6 })).rejects.toThrow(/на утверждении/);
    expect((await stockOf(s.productId)).current).toBe(10);
    const toCeo = await notesOf(ceoId);
    expect(toCeo).toHaveLength(1);
    expect(toCeo[0]).toMatchObject({ title: `На утверждение: ${number}`, titleUz: `Tasdiqlash uchun: ${number}` });

    await sell(s.productId, 3);                                            // день спустя продали 3
    expect((await stockOf(s.productId)).current).toBe(7);

    const ceo = await asCeo();
    const r = await ceo.approveCount({ id });
    expect(r).toMatchObject({ number, changed: 1, shortage: 3, surplus: 0 });
    // 10 − 3 продано − 3 недостача. Поставь «посчитанное» числом — было бы 7,
    // и три проданные единицы вернулись бы на склад.
    expect((await stockOf(s.productId)).current).toBe(4);
    expect((await stockOf(s.secondProductId)).current, "непосчитанная строка не трогается").toBe(10);

    const [mv] = await db.execute(sql`SELECT type, quantity, notes FROM stock_movements WHERE reference_type = 'inventory' AND reference_id = ${id}`) as unknown as [Array<{ type: string; quantity: string; notes: string }>];
    expect(mv).toHaveLength(1);
    expect(mv[0]).toMatchObject({ type: "out", quantity: "3.00" });
    expect(mv[0].notes).toContain("при отправке по учёту 10.00, на полке 7.00");

    const doc = await ceo.get({ id });
    expect(doc).toMatchObject({ status: "applied", appliedBy: ceoId, submittedBy: operatorId });
    expect(await countOf("audit_log", `action = 'stock_count.approve' AND target_id = ${id}`)).toBe(1);
    expect((await notesOf(operatorId)).map(n => n.title)).toContain(`Утверждено: ${number}`);
    await expect(ceo.approveCount({ id }), "утверждено дважды").rejects.toThrow(/только документ, отправленный/);
  });

  it("два «Утвердить» одновременно: проводится один раз", async () => {
    // Директор нажал дважды, или два директора открыли один документ: замок
    // документа пропускает первого, второй видит «уже применён».
    const op = await asOperator();
    const { id } = await op.create({ warehouseId: s.warehouseId });
    await op.setCounted({ id, productId: s.productId, counted: 6 });
    await op.submitCount({ id });
    const [a, b] = [await asCeo(), await asCeo()];
    const results = await Promise.allSettled([a.approveCount({ id }), b.approveCount({ id })]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect((await stockOf(s.productId)).current).toBe(6);
    expect(await countOf("stock_movements", `reference_type = 'inventory' AND reference_id = ${id}`)).toBe(1);
  });

  it("продали больше, чем снимает документ, — утверждение отказывает с именем товара, остаток цел", async () => {
    const op = await asOperator();
    const { id } = await op.create({ warehouseId: s.warehouseId });
    await op.setCounted({ id, productId: s.productId, counted: 2 });      // недостача 8
    await op.submitCount({ id });
    await sell(s.productId, 5);                                            // осталось 5, а снять надо 8
    await expect((await asCeo()).approveCount({ id })).rejects.toThrow(/«Товар»: после отправки остаток стал 5\.00, а по документу нужно снять 8\.00/);
    expect((await stockOf(s.productId)).current).toBe(5);
    expect((await (await asCeo()).get({ id })).status).toBe("submitted");
  });

  it("оператор не утверждает и не возвращает — ни свой документ, ни после того, как ему всё разрешено", async () => {
    const op = await asOperator();
    const { id } = await op.create({ warehouseId: s.warehouseId });
    await op.setCounted({ id, productId: s.productId, counted: 1 });
    await op.submitCount({ id });
    await expect(op.approveCount({ id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(op.rejectCount({ id, note: "сам себе" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await stockOf(s.productId)).current).toBe(10);
    // Чужая организация документа не находит даже директором.
    const foreign = (await import("../../stock-count-router")).stockCountRouter.createCaller(ctxFor(db, s.otherTenantId, ceoId, "ceo"));
    await expect(foreign.approveCount({ id })).rejects.toThrow(/не найдена/);
    expect((await (await asCeo()).get({ id })).status).toBe("submitted");
  });

  it("отказ: черновик со словами директора, остаток цел; исправленный уходит заново и учёт снимается заново", async () => {
    const op = await asOperator();
    const { id, number } = await op.create({ warehouseId: s.warehouseId });
    await op.setCounted({ id, productId: s.productId, counted: 4 });
    await op.submitCount({ id });
    const ceo = await asCeo();
    await expect(ceo.rejectCount({ id, note: "  " })).rejects.toThrow();
    await ceo.rejectCount({ id, note: "Пересчитайте вторую полку" });

    expect((await stockOf(s.productId)).current).toBe(10);
    const back = await op.get({ id });
    expect(back).toMatchObject({ status: "draft", reviewNote: "Пересчитайте вторую полку", reviewedBy: ceoId });
    expect(back.items.find(i => i.productId === s.productId)?.bookAtSubmit).toBeNull();
    expect(await countOf("stock_movements", `reference_id = ${id}`)).toBe(0);
    expect((await notesOf(operatorId)).map(n => n.title)).toContain(`Возвращено: ${number}`);

    // Исправил, продали 2, отправил снова: учёт при отправке — уже 8.
    await op.setCounted({ id, productId: s.productId, counted: 6 });
    await sell(s.productId, 2);
    await op.submitCount({ id });
    const again = await op.get({ id });
    expect(again.reviewNote).toBeNull();
    expect(Number(again.items.find(i => i.productId === s.productId)?.bookAtSubmit)).toBe(8);
    await ceo.approveCount({ id });
    expect((await stockOf(s.productId)).current).toBe(6);
  });

  it("счёт по категории берёт только эту категорию; по выбранным — ровно выбранные, чужой товар — отказ", async () => {
    await db.update(schema.products).set({ category: "Напитки" }).where(eq(schema.products.id, s.productId));
    await db.update(schema.products).set({ category: "Сладости" }).where(eq(schema.products.id, s.secondProductId));
    const [third] = await db.insert(schema.products).values({ tenantId: s.tenantId, code: "P-3", name: "Третий", unitPrice: "50.00", category: "Напитки" });
    const thirdId = Number(third.insertId);
    await db.insert(schema.warehouseStock).values({ tenantId: s.tenantId, productId: thirdId, warehouseId: s.warehouseId, currentStock: "4.00", reserved: "0.00", available: "4.00" });

    const op = await asOperator();
    const byCat = await op.create({ warehouseId: s.warehouseId, category: "Напитки" });
    const doc = await op.get({ id: byCat.id });
    expect(doc).toMatchObject({ scope: "category", scopeCategory: "Напитки" });
    expect(doc.items.map(i => i.productId).sort((a, b) => a - b)).toEqual([s.productId, thirdId].sort((a, b) => a - b));
    await expect(op.create({ warehouseId: s.warehouseId, category: "Нет такой" })).rejects.toThrow(/В категории «Нет такой» на этом складе нет товаров/);

    // Товар за рамкой документа, добавленный сканером, ожидается по учёту, а не нулём.
    await op.setCounted({ id: byCat.id, productId: s.secondProductId, delta: 1 });
    const widened = await op.get({ id: byCat.id });
    expect(Number(widened.items.find(i => i.productId === s.secondProductId)?.expected)).toBe(10);

    // Выбранные товары: второй (со строкой остатка) и новый без неё — ожидалось ноль.
    const [fresh] = await db.insert(schema.products).values({ tenantId: s.tenantId, code: "P-4", name: "Новинка", unitPrice: "10.00" });
    const freshId = Number(fresh.insertId);
    const picked = await op.create({ warehouseId: s.warehouseId, productIds: [s.secondProductId, freshId, freshId] });
    const pdoc = await op.get({ id: picked.id });
    expect(pdoc.scope).toBe("items");
    expect(pdoc.items.map(i => [i.productId, Number(i.expected)]).sort((a, b) => a[0] - b[0])).toEqual([[s.secondProductId, 10], [freshId, 0]]);

    const [alien] = await db.insert(schema.products).values({ tenantId: s.otherTenantId, code: "X-1", name: "Чужой", unitPrice: "1.00" });
    await expect(op.create({ warehouseId: s.warehouseId, productIds: [Number(alien.insertId)] })).rejects.toThrow(/не найден в вашей организации/);
    await expect(op.create({ warehouseId: s.warehouseId, category: "Напитки", productIds: [s.productId] })).rejects.toThrow(/категорию или товары/);
  });

  it("право выключено: применить нельзя, отправить можно; директор применяет сам, как раньше", async () => {
    await denyApply();
    const op = await asOperator();
    const { id } = await op.create({ warehouseId: s.warehouseId });
    await op.setCounted({ id, productId: s.productId, counted: 9 });
    await expect(op.applyCount({ id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await stockOf(s.productId)).current).toBe(10);
    await op.submitCount({ id });
    expect((await op.get({ id })).status).toBe("submitted");

    const ceo = await asCeo();
    const own = await ceo.create({ warehouseId: s.warehouseId });
    await ceo.setCounted({ id: own.id, productId: s.secondProductId, counted: 12 });
    await ceo.applyCount({ id: own.id });
    expect((await stockOf(s.secondProductId)).current).toBe(12);
  });

  it("право выключено: ручная правка становится заявкой; утверждённое списание забирает просрочку первой", async () => {
    // На складе 10 без партии, и сверху приходит партия 5 со сроком вчера.
    await receiveStock(db as never, {
      tenantId: s.tenantId, warehouseId: s.warehouseId, productId: s.productId, quantity: 5,
      reason: "arrival", batch: { batchNumber: "OLD", expiresAt: inDays(-1) },
    });
    await denyApply();
    const wh = await warehouse(operatorId, "operator");
    const r = await wh.adjustStock({ productId: s.productId, warehouseId: s.warehouseId, quantity: "5", type: "out", notes: "Просрочка OLD" });
    expect(r).toMatchObject({ success: true, pendingApproval: true });
    expect(r.number).toMatch(/^ИНВ-\d+$/);
    expect((await stockOf(s.productId)).current, "заявка остаток не трогает").toBe(15);
    expect(await countOf("stock_movements", "reference_type = 'manual_adjustment'")).toBe(0);

    const ceo = await asCeo();
    const doc = await ceo.get({ id: r.countId! });
    expect(doc).toMatchObject({ status: "submitted", origin: "adjust", adjustType: "out", scope: "items", submittedBy: operatorId });
    expect(doc.items).toHaveLength(1);
    expect(doc.items[0]).toMatchObject({ productId: s.productId, note: "Просрочка OLD" });
    expect(Number(doc.items[0].bookAtSubmit)).toBe(15);
    expect(Number(doc.items[0].counted)).toBe(10);

    // Заявка проверяется сразу, а не у директора: списать больше свободного нельзя.
    await expect(wh.adjustStock({ productId: s.productId, warehouseId: s.warehouseId, quantity: "50", type: "out" })).rejects.toThrow(/Недостаточно свободного товара/);

    await sell(s.productId, 1);                         // продали одну без партии
    await ceo.approveCount({ id: r.countId! });
    expect((await stockOf(s.productId)).current).toBe(9);
    // Списание по заявке — как прямое: просроченная партия ушла первой, а не остаток без партии.
    const [[b]] = await db.execute(sql`SELECT COALESCE(SUM(quantity), 0) AS q FROM stock_batches WHERE product_id = ${s.productId} AND batch_number = 'OLD'`) as unknown as [Array<{ q: string }>];
    expect(Number(b.q)).toBe(0);
    const [mv] = await db.execute(sql`SELECT type, quantity, reference_id AS ref, notes FROM stock_movements WHERE reference_type = 'manual_adjustment'`) as unknown as [Array<{ type: string; quantity: string; ref: number; notes: string }>];
    expect(mv).toEqual([expect.objectContaining({ type: "out", quantity: "5.00", ref: r.countId })]);
    expect(mv[0].notes).toContain("Просрочка OLD");

    // Приход и «установить число» — тоже заявки, проводятся разницей.
    const plus = await wh.adjustStock({ productId: s.secondProductId, warehouseId: s.warehouseId, quantity: "4", type: "in" });
    const exact = await wh.adjustStock({ productId: s.productId, warehouseId: s.warehouseId, quantity: "12", type: "adjustment" });
    expect([plus.pendingApproval, exact.pendingApproval]).toEqual([true, true]);
    await expect(wh.adjustStock({ productId: s.productId, warehouseId: s.warehouseId, quantity: "9", type: "adjustment" })).rejects.toThrow(/Остаток уже 9\.00 — менять нечего/);
    await ceo.approveCount({ id: plus.countId! });
    await ceo.approveCount({ id: exact.countId! });
    expect((await stockOf(s.secondProductId)).current).toBe(14);
    expect((await stockOf(s.productId)).current).toBe(12);
  });

  it("право по умолчанию: правка оператора проводится сразу, как до утверждения", async () => {
    const wh = await warehouse(operatorId, "operator");
    const r = await wh.adjustStock({ productId: s.productId, warehouseId: s.warehouseId, quantity: "3", type: "in" });
    expect(r).toMatchObject({ success: true, pendingApproval: false });
    expect((await stockOf(s.productId)).current).toBe(13);
    expect(await countOf("stock_counts")).toBe(0);
  });
});
