/**
 * Документ перемещения («ПМ-12») — на настоящей базе.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Перемещение списывало партии со склада-отправителя по FEFO и выбрасывало,
 * какие именно: на складе-получателе товар ложился без номера, срока и
 * себестоимости. Отчёт «что сгорает», FEFO и запрет продавать просрочку там
 * его не видели. Шаг был один — и только он: товар «в пути» не жил нигде.
 *
 * ── Что проверяется ─────────────────────────────────────────────────────────
 *
 *   · в один шаг: каждая партия ложится на получатель той же партией (номер,
 *     срок, цена); номер документа «ПМ-N» растёт; движения называют документ;
 *     нехватка одной позиции отказывает всему документу;
 *   · в два шага (настройка организации): товар ушёл и «в пути» — его видно
 *     в остатках получателя, в оценке склада и в средней себестоимости
 *     прихода; приёмка по строкам не больше отправленного, недоехавшее —
 *     недостачей на документе, в журнале, у директора и в оценке; отмена
 *     возвращает те же партии; оператор без права проводить правку
 *     (warehouse.apply) принимает только всё — недостачу проводит директор;
 *   · чужая организация: документ «не найден», чужая партия не выбирается;
 *   · гонки: два документа на одну партию, встречные A→B и B→A, две приёмки
 *     одного документа.
 *
 * Главный инвариант после каждого шага: SUM(партий) <= current_stock на
 * обоих складах.
 *
 * Нарочная поломка: в transferStock убери batch у receiveStock — падает «в
 * один шаг»; в receiveTransfer убери проверку «не больше отправленного» —
 * падает «больше отправленного»; убери замок документа (lockDoc … for update)
 * — падает «две приёмки»; в arrival.ts убери «в пути» из среднего — падает
 * «средняя себестоимость»; в receiveTransfer убери отказ `if (!mayWriteOff` —
 * падает «оператор без права».
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { sql, eq } from "drizzle-orm";
import * as schema from "@db/schema";
import { receiveStock } from "../../services/stock-ledger";
import { forgetCapabilities } from "../../lib/role-permissions";
import { ctxFor, hasRealDb, connectRealDb, closeRealDb, truncateAll, seed, type ServiceDb, type Seeded } from "./harness";

let current: ServiceDb;
vi.mock("../../queries/connection", () => ({ getDb: () => current, getPool: () => null }));

const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const LATER = inDays(400);
const SOON = inDays(60);
const GONE = inDays(-3);
const today = () => new Date().toISOString().slice(0, 10);

describe.skipIf(!hasRealDb)("документ перемещения на настоящей базе", () => {
  let db: ServiceDb;
  let s: Seeded;
  let second: number;
  let ceoId: number;

  beforeAll(async () => { db = await connectRealDb(); current = db; }, 180_000);
  afterAll(async () => { await closeRealDb(); });
  beforeEach(async () => {
    await truncateAll();
    s = await seed("0.000");
    const [w] = await (db as any).insert(schema.warehouses).values({ tenantId: s.tenantId, name: "Второй склад" });
    second = Number(w.insertId);
    const [u] = await (db as any).insert(schema.users).values({ tenantId: s.tenantId, name: "Директор", email: "ceo@test.local", passwordHash: "x", role: "ceo" });
    ceoId = Number(u.insertId);
    await (db as any).insert(schema.settings).values({ tenantId: s.tenantId, companyName: "Тест" });
  });

  const twoStep = () => (db as any).update(schema.settings).set({ transferTwoStep: true }).where(eq(schema.settings.tenantId, s.tenantId));

  const router = async (tenantId = s.tenantId, userId = ceoId) =>
    (await import("../../warehouse-multi-router")).warehouseMultiRouter.createCaller(ctxFor(db, tenantId, userId, "ceo"));

  const receive = (quantity: number, batch?: { batchNumber?: string | null; expiresAt?: string | null; costPrice?: string | null }, warehouseId = s.warehouseId, productId = s.productId) =>
    receiveStock(db as never, { tenantId: s.tenantId, warehouseId, productId, quantity, reason: "arrival", batch: batch ?? null });

  async function stockAt(warehouseId: number, productId = s.productId) {
    const [rows] = await db.execute(sql`
      SELECT current_stock AS c, reserved AS r, available AS a FROM warehouse_stock
      WHERE tenant_id = ${s.tenantId} AND warehouse_id = ${warehouseId} AND product_id = ${productId}
    `) as unknown as [Array<{ c: string; r: string; a: string }>];
    const r = rows[0];
    return { current: Number(r?.c ?? 0), reserved: Number(r?.r ?? 0), available: Number(r?.a ?? 0) };
  }

  async function batchesAt(warehouseId: number, productId = s.productId) {
    const [rows] = await db.execute(sql`
      SELECT id, batch_number AS b, DATE_FORMAT(expires_at, '%Y-%m-%d') AS e, quantity AS q, cost_price AS cost
      FROM stock_batches WHERE tenant_id = ${s.tenantId} AND warehouse_id = ${warehouseId} AND product_id = ${productId}
      ORDER BY expires_at IS NULL, expires_at, received_at, id
    `) as unknown as [Array<{ id: number; b: string | null; e: string | null; q: string; cost: string | null }>];
    return rows.map(r => ({ id: Number(r.id), batch: r.b, expires: r.e, qty: Number(r.q), cost: r.cost }));
  }
  const shape = async (warehouseId: number, productId = s.productId) =>
    (await batchesAt(warehouseId, productId)).map(b => [b.batch, b.expires, b.qty, b.cost]);

  /** Партий не больше, чем лежит на полке — на обоих складах, по обоим товарам. */
  async function expectInvariant() {
    for (const productId of [s.productId, s.secondProductId]) {
      for (const wh of [s.warehouseId, second]) {
        const st = await stockAt(wh, productId);
        const inBatches = (await batchesAt(wh, productId)).reduce((sum, b) => sum + b.qty, 0);
        expect(inBatches, `склад ${wh}, товар ${productId}: партий (${inBatches}) больше, чем остатка (${st.current})`).toBeLessThanOrEqual(st.current + 1e-9);
      }
    }
  }

  const send = async (items: Array<{ productId: number; quantity: number; picks?: Array<{ batchId: number | null; quantity: number }> }>, extra: { from?: number; to?: number; mode?: "instant" | "transit"; notes?: string } = {}) =>
    (await router()).createTransfer({ fromWarehouseId: extra.from ?? s.warehouseId, toWarehouseId: extra.to ?? second, items, mode: extra.mode, notes: extra.notes });

  const rowsOf = async <T,>(q: ReturnType<typeof sql>) => ((await db.execute(q)) as unknown as [T[]])[0];

  it("в один шаг: партии едут с номером, сроком и ценой; номер ПМ-1, ПМ-2; движения называют документ", async () => {
    await receive(3, { batchNumber: "A", expiresAt: LATER, costPrice: "9500.00" });
    await receive(4, { batchNumber: "B", expiresAt: SOON, costPrice: "8000.00" });
    await receive(2);
    await receive(5, { batchNumber: "C", expiresAt: LATER, costPrice: "100.00" }, s.warehouseId, s.secondProductId);

    const r = await send([{ productId: s.productId, quantity: 8 }, { productId: s.secondProductId, quantity: 2 }], { notes: "на второй" });
    expect(r).toMatchObject({ number: "ПМ-1", mode: "instant", status: "received", count: 2 });

    expect(await shape(second), "на получателе партии потерялись").toEqual([["B", SOON, 4, "8000.00"], ["A", LATER, 3, "9500.00"]]);
    expect((await stockAt(second)).current).toBe(8);
    expect(await shape(s.warehouseId)).toEqual([]);
    expect((await stockAt(s.warehouseId)).current).toBe(1);
    expect(await shape(second, s.secondProductId)).toEqual([["C", LATER, 2, "100.00"]]);
    expect(await shape(s.warehouseId, s.secondProductId)).toEqual([["C", LATER, 3, "100.00"]]);

    const lines = await rowsOf<{ b: string | null; q: string; rq: string; st: string; doc: number }>(sql`
      SELECT batch_number AS b, quantity AS q, received_quantity AS rq, status AS st, doc_id AS doc FROM stock_transfers WHERE tenant_id = ${s.tenantId} ORDER BY id`);
    expect(lines.map(l => [l.b, Number(l.q), Number(l.rq), l.st])).toEqual([
      ["B", 4, 4, "completed"], ["A", 3, 3, "completed"], [null, 1, 1, "completed"], ["C", 2, 2, "completed"],
    ]);
    expect(new Set(lines.map(l => Number(l.doc)))).toEqual(new Set([r.id]));

    // Движения ссылаются на документ — и называются его номером.
    const { movementReferenceNumber } = await import("../../lib/movement-reference");
    const moves = await (db as any).select({ type: schema.stockMovements.referenceType, n: movementReferenceNumber })
      .from(schema.stockMovements).where(sql`${schema.stockMovements.referenceType} IN ('transfer_doc_out', 'transfer_doc_in')`);
    // Расход — одной записью на позицию, приход — записью на каждую партию: 2 + (3 + 1).
    expect(moves.length).toBe(6);
    expect(new Set(moves.map((m: { n: string }) => m.n))).toEqual(new Set(["ПМ-1"]));

    const audit = await rowsOf<{ a: string; t: string }>(sql`SELECT action AS a, target_type AS t FROM audit_log WHERE tenant_id = ${s.tenantId}`);
    expect(audit).toEqual([{ a: "stock.transfer_completed", t: "stock_transfer_doc" }]);
    await expectInvariant();

    expect((await send([{ productId: s.productId, quantity: 1 }])).number).toBe("ПМ-2");
  });

  it("одной позиции не хватает — отказ всему документу: ни документа, ни строк, ни движений", async () => {
    await receive(5, { batchNumber: "A", expiresAt: LATER });
    await receive(1, undefined, s.warehouseId, s.secondProductId);
    await expect(send([{ productId: s.productId, quantity: 2 }, { productId: s.secondProductId, quantity: 3 }])).rejects.toThrow(/недостаточно.*Второй товар/i);
    for (const t of ["stock_transfer_docs", "stock_transfers"]) {
      expect(Number((await rowsOf<{ n: number }>(sql`SELECT COUNT(*) AS n FROM ${sql.raw(t)}`))[0].n), t).toBe(0);
    }
    expect(Number((await rowsOf<{ n: number }>(sql`SELECT COUNT(*) AS n FROM stock_movements WHERE reference_type LIKE 'transfer%'`))[0].n)).toBe(0);
    expect(await shape(s.warehouseId)).toEqual([["A", LATER, 5, null]]);
    await expectInvariant();
    // Получателю — ни одной пустой строки остатка: товар, которого там не было,
    // не появляется нулём, и тревога «заканчивается» по нему не зовёт.
    const rowsAtSecond = async () => Number((await rowsOf<{ n: number }>(sql`SELECT COUNT(*) AS n FROM warehouse_stock WHERE warehouse_id = ${second}`))[0].n);
    expect(await rowsAtSecond()).toBe(0);
    // Годного не хватает из-за просрочки — тот же отказ словами и тоже без строк.
    await receive(2, { batchNumber: "OLD", expiresAt: GONE }, s.warehouseId, s.secondProductId);
    await expect(send([{ productId: s.secondProductId, quantity: 2 }])).rejects.toThrow(/из них 2 просрочено — переместить можно 1, а в документе 2/);
    expect(await rowsAtSecond()).toBe(0);
  });

  it("склад чужой организации — «не найден»; отключённый — отказ словами", async () => {
    await receive(5);
    const [w] = await (db as any).insert(schema.warehouses).values({ tenantId: s.otherTenantId, name: "Чужой" });
    await expect(send([{ productId: s.productId, quantity: 1 }], { to: Number(w.insertId) })).rejects.toThrow(/Склад не найден/);
    await (db as any).update(schema.warehouses).set({ status: "inactive" }).where(eq(schema.warehouses.id, second));
    await expect(send([{ productId: s.productId, quantity: 1 }])).rejects.toThrow(/«Второй склад» отключён/);
    expect((await stockAt(s.warehouseId)).current).toBe(5);
  });

  it("в два шага по настройке: ушло со склада, «в пути» видно в остатках получателя и в оценке", async () => {
    await twoStep();
    await (db as any).update(schema.products).set({ costPrice: "7000.00" }).where(eq(schema.products.id, s.productId));
    await receive(6, { batchNumber: "A", expiresAt: LATER, costPrice: "9000.00" });
    await receive(2);

    const r = await send([{ productId: s.productId, quantity: 7 }]);
    expect(r).toMatchObject({ number: "ПМ-1", mode: "transit", status: "in_transit" });
    expect(await stockAt(s.warehouseId)).toEqual({ current: 1, reserved: 0, available: 1 });
    expect(await stockAt(second), "получатель получил до приёмки").toEqual({ current: 0, reserved: 0, available: 0 });
    expect(await shape(second)).toEqual([]);

    const c = await router();
    const destRows = (await c.getStock({ warehouseId: second, pageSize: 100 })).data as Array<{ productId: number; inTransitIn: unknown }>;
    expect(Number(destRows.find(x => Number(x.productId) === s.productId)?.inTransitIn)).toBe(7);
    const srcRows = (await c.getStock({ warehouseId: s.warehouseId, pageSize: 100 })).data as Array<{ productId: number; inTransitIn: unknown }>;
    expect(Number(srcRows.find(x => Number(x.productId) === s.productId)?.inTransitIn)).toBe(0);

    const { warehouseRouter } = await import("../../warehouse-router");
    const wr = warehouseRouter.createCaller(ctxFor(db, s.tenantId, ceoId, "ceo"));
    // 6 по цене партии 9000 + 1 без партии по цене карточки 7000.
    expect(await wr.valuation({ warehouseId: second })).toMatchObject({ inTransitUnits: 7, inTransitCost: 61000 });
    expect(await wr.valuation({ warehouseId: s.warehouseId })).toMatchObject({ inTransitUnits: 0, inTransitCost: 0 });
    expect(await wr.valuation()).toMatchObject({ inTransitUnits: 7, inTransitCost: 61000 });

    const { inTransitByProduct } = await import("../../services/stock-transfer");
    expect((await inTransitByProduct(db as never, s.tenantId, [s.productId])).get(s.productId)).toBe(7);
    expect((await inTransitByProduct(db as never, s.otherTenantId, [s.productId])).get(s.productId)).toBeUndefined();

    const docs = await c.transferDocs({ status: "in_transit" });
    expect(docs.map(d => [d.number, d.quantity, d.lines.length])).toEqual([["ПМ-1", 7, 2]]);
    const audit = await rowsOf<{ a: string }>(sql`SELECT action AS a FROM audit_log WHERE tenant_id = ${s.tenantId}`);
    expect(audit.map(a => a.a)).toEqual(["stock.transfer_shipped"]);
    await expectInvariant();

    // Явный режим документа сильнее настройки.
    expect((await send([{ productId: s.productId, quantity: 1 }], { mode: "instant" })).status).toBe("received");
  });

  it("приёмка по строкам: недостача — на документе, в журнале, у директора и в оценке; второй раз не принять", async () => {
    await twoStep();
    await receive(5, { batchNumber: "A", expiresAt: LATER, costPrice: "9000.00" });
    await receive(3, { batchNumber: "B", expiresAt: SOON, costPrice: "8000.00" });
    const r = await send([{ productId: s.productId, quantity: 8 }]);
    const c = await router();
    const [doc] = await c.transferDocs({ status: "in_transit" });
    const lineA = doc.lines.find(l => l.batchNumber === "A")!;

    const got = await c.receiveTransfer({ docId: r.id, lines: [{ lineId: lineA.id, receivedQuantity: 4 }] });
    expect(got).toEqual({ number: "ПМ-1", status: "received_short", shortageQty: 1, shortageCost: 9000 });
    expect(await shape(second)).toEqual([["B", SOON, 3, "8000.00"], ["A", LATER, 4, "9000.00"]]);
    expect((await stockAt(second)).current).toBe(7);

    const [row] = await rowsOf<{ st: string; sc: string; rb: number }>(sql`SELECT status AS st, shortage_cost AS sc, received_by AS rb FROM stock_transfer_docs WHERE id = ${r.id}`);
    expect([row.st, Number(row.sc), Number(row.rb)]).toEqual(["received_short", 9000, ceoId]);

    const [audit] = await rowsOf<{ meta: string | Record<string, unknown> }>(sql`SELECT meta FROM audit_log WHERE action = 'stock.transfer_received'`);
    const meta = typeof audit.meta === "string" ? JSON.parse(audit.meta) : audit.meta;
    expect(meta).toMatchObject({ number: "ПМ-1", shortageQty: 1, shortageCost: 9000, quantity: 7 });

    const notes = await rowsOf<{ u: number; t: string; tu: string | null; m: string }>(sql`SELECT user_id AS u, title AS t, title_uz AS tu, message AS m FROM notifications WHERE tenant_id = ${s.tenantId}`);
    expect(notes.map(n => Number(n.u))).toEqual([ceoId]);
    expect(notes[0].t).toBe("Недостача при перемещении ПМ-1");
    expect(notes[0].tu).toContain("kamomad");
    expect(notes[0].m).toContain("Товар: 1");

    const { warehouseRouter } = await import("../../warehouse-router");
    const wr = warehouseRouter.createCaller(ctxFor(db, s.tenantId, ceoId, "ceo"));
    expect(await wr.valuation({ warehouseId: second })).toMatchObject({ inTransitUnits: 0, transitShortageUnits: 1, transitShortageCost: 9000 });
    expect(await wr.valuation({ warehouseId: s.warehouseId })).toMatchObject({ transitShortageUnits: 0, transitShortageCost: 0 });

    await expect(c.receiveTransfer({ docId: r.id })).rejects.toThrow(/ПМ-1 уже принято или отменено/);
    await expect(c.cancelTransfer({ docId: r.id })).rejects.toThrow(/уже принято или отменено/);
    expect((await stockAt(second)).current).toBe(7);
    await expectInvariant();
  });

  it("больше отправленного не принять; строка другого документа — отказ; документ остаётся в пути", async () => {
    await twoStep();
    await receive(4, { batchNumber: "A", expiresAt: LATER });
    const one = await send([{ productId: s.productId, quantity: 2 }]);
    const two = await send([{ productId: s.productId, quantity: 2 }]);
    const c = await router();
    const docs = await c.transferDocs({ status: "in_transit" });
    const lineOf = (id: number) => docs.find(d => d.id === id)!.lines[0].id;

    await expect(c.receiveTransfer({ docId: one.id, lines: [{ lineId: lineOf(one.id), receivedQuantity: 3 }] }))
      .rejects.toThrow(/принято 3, а отправлено 2\. Больше отправленного принять нельзя/);
    await expect(c.receiveTransfer({ docId: one.id, lines: [{ lineId: lineOf(two.id), receivedQuantity: 1 }] }))
      .rejects.toThrow(/В документе нет такой строки/);
    expect((await stockAt(second)).current).toBe(0);
    expect((await c.transferDocs({ status: "in_transit" })).length).toBe(2);

    // Всё по отправленному — без недостачи, и уведомления нет.
    expect((await c.receiveTransfer({ docId: one.id })).status).toBe("received");
    expect(Number((await rowsOf<{ n: number }>(sql`SELECT COUNT(*) AS n FROM notifications`))[0].n)).toBe(0);
    await expectInvariant();
  });

  it("оператор без права проводить правку: с недостачей не принять — даже «в пути», выбранном в документе; директор принимает по факту", async () => {
    // Настройка организации выключена: «в пути» выбрано в самом документе.
    // Без отказа «отправил 10 — принял 0» списало бы 10 мимо утверждения.
    const [u] = await (db as any).insert(schema.users).values({ tenantId: s.tenantId, name: "Оператор", email: "op@test.local", passwordHash: "x", role: "operator" });
    const opId = Number(u.insertId);
    forgetCapabilities(s.tenantId, "operator");
    const access = (await import("../../access-router")).accessRouter.createCaller(ctxFor(db, s.tenantId, ceoId, "ceo"));
    await access.setOperatorAccess({ capabilities: { "warehouse.apply": false } });
    const op = (await import("../../warehouse-multi-router")).warehouseMultiRouter.createCaller(ctxFor(db, s.tenantId, opId, "operator"));

    await receive(12, { batchNumber: "A", expiresAt: LATER });
    const r = await op.createTransfer({ fromWarehouseId: s.warehouseId, toWarehouseId: second, items: [{ productId: s.productId, quantity: 10 }], mode: "transit" });
    const [doc] = await op.transferDocs({ status: "in_transit" });
    const lineId = doc.lines[0].id;

    await expect(op.receiveTransfer({ docId: r.id, lines: [{ lineId, receivedQuantity: 0 }] }))
      .rejects.toMatchObject({ code: "FORBIDDEN", message: expect.stringMatching(/Недостачу при приёмке проводит руководитель: ПМ-1/) });
    expect((await stockAt(second)).current).toBe(0);
    expect((await op.transferDocs({ status: "in_transit" })).map(d => d.number), "документ ждёт руководителя в пути").toEqual(["ПМ-1"]);
    expect(Number((await rowsOf<{ n: number }>(sql`SELECT COUNT(*) AS n FROM notifications`))[0].n)).toBe(0);

    // Директор принимает по факту — недостача записывается, как раньше.
    const got = await (await router()).receiveTransfer({ docId: r.id, lines: [{ lineId, receivedQuantity: 7 }] });
    expect(got).toMatchObject({ status: "received_short", shortageQty: 3 });
    expect((await stockAt(second)).current).toBe(7);

    // Всё приехало — оператор принимает сам и без права.
    const full = await op.createTransfer({ fromWarehouseId: s.warehouseId, toWarehouseId: second, items: [{ productId: s.productId, quantity: 2 }], mode: "transit" });
    expect((await op.receiveTransfer({ docId: full.id })).status).toBe("received");
    expect((await stockAt(second)).current).toBe(9);
    await expectInvariant();
    forgetCapabilities(s.tenantId, "operator");
  });

  it("отмена «в пути» возвращает товар теми же партиями и той же ценой", async () => {
    await twoStep();
    await receive(3, { batchNumber: "A", expiresAt: LATER, costPrice: "9500.00" });
    await receive(2, { batchNumber: "B", expiresAt: SOON, costPrice: "8000.00" });
    const r = await send([{ productId: s.productId, quantity: 4 }]);
    expect(await shape(s.warehouseId)).toEqual([["A", LATER, 1, "9500.00"]]);

    const c = await router();
    expect(await c.cancelTransfer({ docId: r.id })).toEqual({ number: "ПМ-1" });
    expect(await shape(s.warehouseId)).toEqual([["B", SOON, 2, "8000.00"], ["A", LATER, 3, "9500.00"]]);
    expect(await stockAt(s.warehouseId)).toEqual({ current: 5, reserved: 0, available: 5 });
    expect((await stockAt(second)).current).toBe(0);
    const [d] = await c.transferDocs({ status: "cancelled" });
    expect(d.lines.length).toBe(2);
    const st = await rowsOf<{ st: string }>(sql`SELECT DISTINCT status AS st FROM stock_transfers WHERE doc_id = ${r.id}`);
    expect(st).toEqual([{ st: "cancelled" }]);
    await expect(c.receiveTransfer({ docId: r.id })).rejects.toThrow(/уже принято или отменено/);
    await expectInvariant();
  });

  it("склад с перемещением «в пути» не отключить, пока его не примут или не отменят", async () => {
    await twoStep();
    await receive(3, { batchNumber: "A", expiresAt: LATER });
    const r = await send([{ productId: s.productId, quantity: 2 }]);
    const c = await router();
    await expect(c.update({ id: second, status: "inactive" })).rejects.toThrow(/перемещений в пути 1 — примите или отмените их/);
    // Основной склад не отключают вовсе (ADR 0012) — и говорят это сразу, а
    // не после того, как директор доведёт перемещения.
    await expect(c.update({ id: s.warehouseId, status: "inactive" })).rejects.toThrow(/Основной склад не отключают/);
    const [w] = await rowsOf<{ st: string }>(sql`SELECT status AS st FROM warehouses WHERE id = ${second}`);
    expect(w.st).toBe("active");
    await c.receiveTransfer({ docId: r.id });
    await c.update({ id: second, status: "inactive" });
    const [after] = await rowsOf<{ st: string }>(sql`SELECT status AS st FROM warehouses WHERE id = ${second}`);
    expect(after.st).toBe("inactive");
  });

  it("чужая организация: документ «не найден», в списке пусто, чужую партию не выбрать", async () => {
    await twoStep();
    await receive(3, { batchNumber: "A", expiresAt: LATER });
    const r = await send([{ productId: s.productId, quantity: 2 }]);
    const [u] = await (db as any).insert(schema.users).values({ tenantId: s.otherTenantId, name: "Чужой директор", email: "x@other.local", passwordHash: "x", role: "ceo" });
    const stranger = await router(s.otherTenantId, Number(u.insertId));
    await expect(stranger.receiveTransfer({ docId: r.id })).rejects.toThrow(/Перемещение не найдено/);
    await expect(stranger.cancelTransfer({ docId: r.id })).rejects.toThrow(/Перемещение не найдено/);
    expect(await stranger.transferDocs()).toEqual([]);

    // Партия другой организации: номер строки есть, но не у нас.
    const [w] = await (db as any).insert(schema.warehouses).values({ tenantId: s.otherTenantId, name: "Чужой" });
    const [p] = await (db as any).insert(schema.products).values({ tenantId: s.otherTenantId, code: "X", name: "Чужой товар", unitPrice: "1.00" });
    await receiveStock(db as never, { tenantId: s.otherTenantId, warehouseId: Number(w.insertId), productId: Number(p.insertId), quantity: 5, reason: "arrival", batch: { batchNumber: "Z", expiresAt: LATER } });
    const [[foreign]] = await db.execute(sql`SELECT id FROM stock_batches WHERE batch_number = 'Z'`) as unknown as [Array<{ id: number }>];
    await expect(send([{ productId: s.productId, quantity: 1, picks: [{ batchId: Number(foreign.id), quantity: 1 }] }], { mode: "instant" }))
      .rejects.toThrow(/в выбранной партии 0, а выбрано 1/);
    expect(await shape(s.warehouseId)).toEqual([["A", LATER, 1, null]]);
    await expectInvariant();
  });

  it("выбор партий вручную: уезжает выбранная, а не ранняя; сумма выбора — это количество строки", async () => {
    await receive(4, { batchNumber: "B", expiresAt: SOON });
    await receive(6, { batchNumber: "A", expiresAt: LATER, costPrice: "9500.00" });
    const a = (await batchesAt(s.warehouseId)).find(b => b.batch === "A")!.id;
    await expect(send([{ productId: s.productId, quantity: 3, picks: [{ batchId: a, quantity: 2 }] }]))
      .rejects.toThrow(/выбранные партии в сумме 2, а в строке 3/);
    await send([{ productId: s.productId, quantity: 3, picks: [{ batchId: a, quantity: 3 }] }]);
    expect(await shape(second)).toEqual([["A", LATER, 3, "9500.00"]]);
    expect((await batchesAt(s.warehouseId)).map(b => [b.batch, b.qty])).toEqual([["B", 4], ["A", 3]]);
    await expectInvariant();
  });

  it("гонка: два документа на одну партию — проходит один, второму отказ; партий не больше остатка", async () => {
    await receive(5, { batchNumber: "A", expiresAt: LATER });
    const results = await Promise.allSettled([send([{ productId: s.productId, quantity: 4 }]), send([{ productId: s.productId, quantity: 4 }])]);
    expect(results.filter(x => x.status === "fulfilled").length).toBe(1);
    expect(String((results.find(x => x.status === "rejected") as PromiseRejectedResult).reason)).toMatch(/недостаточно/i);
    expect((await stockAt(s.warehouseId)).current).toBe(1);
    expect((await stockAt(second)).current).toBe(4);
    await expectInvariant();
  });

  it("встречные документы A→B и B→A одного товара не ждут друг друга вечно", async () => {
    await receive(5, { batchNumber: "M", expiresAt: LATER });
    await receive(5, { batchNumber: "S", expiresAt: LATER }, second);
    const results = await Promise.allSettled([
      send([{ productId: s.productId, quantity: 3 }]),
      send([{ productId: s.productId, quantity: 3 }], { from: second, to: s.warehouseId }),
    ]);
    expect(results.map(x => x.status)).toEqual(["fulfilled", "fulfilled"]);
    expect((await stockAt(s.warehouseId)).current).toBe(5);
    expect((await stockAt(second)).current).toBe(5);
    expect((await batchesAt(s.warehouseId)).map(b => [b.batch, b.qty])).toEqual([["M", 2], ["S", 3]]);
    await expectInvariant();
  });

  it("две приёмки одного документа одновременно — товар приходит один раз", async () => {
    await twoStep();
    await receive(4, { batchNumber: "A", expiresAt: LATER });
    const r = await send([{ productId: s.productId, quantity: 4 }]);
    const c = await router();
    const results = await Promise.allSettled([c.receiveTransfer({ docId: r.id }), c.receiveTransfer({ docId: r.id })]);
    expect(results.filter(x => x.status === "fulfilled").length).toBe(1);
    expect((await stockAt(second)).current).toBe(4);
    expect(await shape(second)).toEqual([["A", LATER, 4, null]]);
    await expectInvariant();
  });

  it("прежняя строка «в пути» (completeTransfer) тоже едет своими партиями", async () => {
    await receive(4, { batchNumber: "A", expiresAt: LATER, costPrice: "9500.00" });
    const [row] = await (db as any).insert(schema.stockTransfers).values({
      tenantId: s.tenantId, fromWarehouseId: s.warehouseId, toWarehouseId: second,
      productId: s.productId, quantity: "3.00", status: "pending", createdBy: ceoId,
    });
    const c = await router();
    expect((await c.listTransfers({ status: "pending", legacy: true })).map(t => t.id)).toEqual([Number(row.insertId)]);
    await c.completeTransfer({ transferId: Number(row.insertId) });
    expect(await shape(second)).toEqual([["A", LATER, 3, "9500.00"]]);
    expect(await shape(s.warehouseId)).toEqual([["A", LATER, 1, "9500.00"]]);
    expect(await c.listTransfers({ status: "pending", legacy: true })).toEqual([]);
    await expectInvariant();
  });

  it("предпросмотр: что уйдёт по FEFO, сколько годного, какая партия уйдёт целиком и чья уценка с ней пропадёт", async () => {
    await receive(2, { batchNumber: "GONE", expiresAt: GONE });
    await receive(3, { batchNumber: "B", expiresAt: SOON });
    await receive(4, { batchNumber: "A", expiresAt: LATER });
    const b = (await batchesAt(s.warehouseId)).find(x => x.batch === "B")!.id;
    await (db as any).insert(schema.markdowns).values({ tenantId: s.tenantId, productId: s.productId, batchId: b, price: "50.00", endsOn: SOON });

    const p = await (await router()).previewTransfer({ fromWarehouseId: s.warehouseId, items: [{ productId: s.productId, quantity: 5 }] });
    expect(p.items).toEqual([{
      productId: s.productId, available: 9, expired: 2, movable: 7, untracked: 0,
      planned: [
        { batchId: b, batchNumber: "B", expiresAt: SOON, quantity: 3, batchQuantity: 3, usesUp: true },
        { batchId: expect.any(Number), batchNumber: "A", expiresAt: LATER, quantity: 2, batchQuantity: 4, usesUp: false },
      ],
    }]);
    expect(p.markdowns).toEqual([{ batchId: b, productId: s.productId, price: 50, endsOn: SOON, batchQuantity: 3 }]);
  });

  it("средняя себестоимость прихода считает и товар «в пути»", async () => {
    await twoStep();
    await (db as any).update(schema.settings).set({ costMethod: "average" }).where(eq(schema.settings.tenantId, s.tenantId));
    await (db as any).update(schema.products).set({ costPrice: "9000.00" }).where(eq(schema.products.id, s.productId));
    await receive(10);
    await send([{ productId: s.productId, quantity: 10 }]);

    const ar = (await import("../../arrival-router")).arrivalRouter.createCaller(ctxFor(db, s.tenantId, ceoId, "ceo"));
    const { id } = await ar.create({ arrivalDate: today(), fuelCost: "0.00", tollCost: "0.00", otherCost: "0.00", items: [{ productId: s.productId, quantity: "10", costPrice: "12000.00" }] });
    await ar.update({ id, status: "completed" });
    const [[prod]] = await db.execute(sql`SELECT cost_price AS c FROM products WHERE id = ${s.productId}`) as unknown as [Array<{ c: string }>];
    // (10 в пути × 9 000 + 10 × 12 000) / 20 — а не 12 000, как если бы едущих не было.
    expect(Number(prod.c)).toBe(10500);
  });
});
