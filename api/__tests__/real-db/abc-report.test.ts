/**
 * ABC-анализ — на настоящей MySQL, через reports.abc.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * ABC не было: какие товары и магазины дают деньги, директор прикидывал по
 * «Топ-10». Товар, который лежит на складе и не продаётся, в «топ» не попадал
 * вовсе — то есть самые замороженные деньги не видел никто.
 *
 * ── Что проверяется ─────────────────────────────────────────────────────────
 *
 * Продажи подобраны ровно на границу 80%:
 *
 *   «Альфа»  50 000 (себест. 49 000 → прибыль  1 000)
 *   «Бета»   30 000 (себест. 10 000 → прибыль 20 000)
 *   «Гамма»  15 000 (себест.  5 000 → прибыль 10 000)
 *   «Дельта»  5 000 (себест.      0 → прибыль  5 000)
 *   «Эпсилон» — без продаж, 10 шт. на основном складе.
 *
 *  1. По выручке: 50 + 30 = ровно 80% → «Бета» ещё A; «Гамма» — B (до неё
 *     80%), «Дельта» — C (до неё 95%), «Эпсилон» — C с нулём.
 *  2. По прибыли классы другие: «Бета» и «Гамма» — A, «Дельта» — B,
 *     «Альфа» (большая выручка, тонкая маржа) — C.
 *  3. C-товары на ОСНОВНОМ складе — с суммой по себестоимости (директору) и
 *     по цене продажи (офису); остаток другого склада не считается.
 *  4. A-магазин без заказа 20 дней — в подсказке со светофором; A-магазин с
 *     заказом сегодня — нет.
 *  5. Права: «по прибыли» офису — отказ; себестоимости в ответе офису нет.
 *  6. Чужая организация не влияет.
 *
 * ── Нарочные поломки ────────────────────────────────────────────────────────
 *
 *  • в abcClassify нестрогая граница (`before * 100 <= …`) — «Гамма» уезжает
 *    в A: падают «по выручке» и «A-магазин без заказа»;
 *  • отбор остатка без isDefault — падает «C-товары на складе»;
 *  • убрать проверку finance у metric=profit — падает «права».
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { sql } from "drizzle-orm";
import * as schema from "@db/schema";
import { ctxFor, hasRealDb, connectRealDb, closeRealDb, truncateAll, seed, type ServiceDb, type Seeded } from "./harness";
import { invalidateReports } from "../../lib/report-cache";

let current: ServiceDb;
vi.mock("../../queries/connection", () => ({ getDb: () => current, getPool: () => null }));

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const FROM = ymd(new Date(Date.now() - 60 * 86_400_000));
const TO = ymd(new Date(Date.now() + 30 * 86_400_000));

describe.skipIf(!hasRealDb)("ABC-анализ товаров и магазинов", () => {
  let db: ServiceDb;
  let s: Seeded;
  const p: Record<string, number> = {};
  const sh: Record<string, number> = {};
  let n = 0;

  beforeAll(async () => { db = await connectRealDb(); current = db; }, 180_000);
  afterAll(async () => { await closeRealDb(); });

  async function product(name: string, cost: string, price = "1000.00", tenantId?: number) {
    const [r] = await db.insert(schema.products).values({ tenantId: tenantId ?? s.tenantId, code: `C-${++n}`, name, unitPrice: price, costPrice: cost });
    return Number(r.insertId);
  }
  async function sale(shopId: number, productId: number, total: number, cost: number, daysAgo = 0, tenantId?: number) {
    const [row] = await db.insert(schema.orders).values({
      tenantId: tenantId ?? s.tenantId, shopId, agentId: s.agentId, orderNumber: `№A-${++n}`, status: "delivered", paymentMethod: "cash",
      subtotal: total.toFixed(2), total: total.toFixed(2), createdAt: sql`DATE_SUB(NOW(), INTERVAL ${daysAgo} DAY)`,
    } as never);
    await db.insert(schema.orderItems).values({
      orderId: Number(row.insertId), productId, quantity: "10.00",
      unitPrice: (total / 10).toFixed(2), costPrice: (cost / 10).toFixed(2), subtotal: total.toFixed(2),
    } as never);
  }

  beforeEach(async () => {
    await truncateAll();
    s = await seed("0.000");
    await invalidateReports(s.tenantId, "test");
    sh.alfa = s.shopId;
    sh.beta = Number((await db.insert(schema.shops).values({ tenantId: s.tenantId, name: "Бета-маркет" }))[0].insertId);
    sh.gamma = Number((await db.insert(schema.shops).values({ tenantId: s.tenantId, name: "Гамма-маркет" }))[0].insertId);
    p.alfa = await product("Альфа", "4900.00");
    p.beta = await product("Бета", "1000.00");
    p.gamma = await product("Гамма", "500.00");
    p.delta = await product("Дельта", "800.00");
    p.eps = await product("Эпсилон", "700.00");

    // «Альфа-магазин» заказал 20 дней назад — и больше не заказывал.
    await sale(sh.alfa, p.alfa, 50_000, 49_000, 20);
    await sale(sh.beta, p.beta, 30_000, 10_000);
    await sale(sh.gamma, p.gamma, 15_000, 5_000);
    await sale(sh.gamma, p.delta, 5_000, 0);

    // Остатки: «Эпсилон» и «Дельта» — на основном; «Бета» — на втором складе.
    const [w2] = await db.insert(schema.warehouses).values({ tenantId: s.tenantId, name: "Второй", isDefault: false });
    await db.insert(schema.warehouseStock).values([
      { tenantId: s.tenantId, productId: p.eps, warehouseId: s.warehouseId, currentStock: "10.00", reserved: "0.00", available: "10.00" },
      { tenantId: s.tenantId, productId: p.delta, warehouseId: s.warehouseId, currentStock: "3.00", reserved: "0.00", available: "3.00" },
      { tenantId: s.tenantId, productId: p.beta, warehouseId: Number(w2.insertId), currentStock: "100.00", reserved: "0.00", available: "100.00" },
    ] as never);

    // Чужая организация: огромная продажа и свой остаток.
    const [os] = await db.insert(schema.shops).values({ tenantId: s.otherTenantId, name: "Чужой" });
    const op = await product("Чужой товар", "1.00", "1000.00", s.otherTenantId);
    await sale(Number(os.insertId), op, 9_000_000, 10, 0, s.otherTenantId);
  });

  const abc = async (role = "ceo") =>
    (await import("../../reports-router")).reportsRouter.createCaller(ctxFor(db, s.tenantId, s.agentId, role));

  it("по выручке: ровно 80% — ещё A, дальше B и C; товар без продаж — C", async () => {
    const r = await (await abc()).abc({ from: FROM, to: TO, of: "product", metric: "revenue" });
    expect(r.rows.map(x => [x.name, x.value, x.abc, x.cumShare])).toEqual([
      ["Альфа", 50_000, "A", 50],
      ["Бета", 30_000, "A", 80],
      ["Гамма", 15_000, "B", 95],
      ["Дельта", 5_000, "C", 100],
      ["Эпсилон", 0, "C", 100],
    ]);
    expect(r.totals).toEqual({
      A: { count: 2, value: 80_000, share: 80 },
      B: { count: 1, value: 15_000, share: 15 },
      C: { count: 2, value: 5_000, share: 5 },
    });
    expect(r.rows.find(x => x.name === "Чужой товар")).toBeUndefined();
  });

  it("по прибыли — другие классы: большая выручка при тонкой марже уходит в C", async () => {
    const r = await (await abc()).abc({ from: FROM, to: TO, of: "product", metric: "profit" });
    expect(r.rows.map(x => [x.name, x.value, x.abc])).toEqual([
      ["Бета", 20_000, "A"],   // 55,6%
      ["Гамма", 10_000, "A"],  // до неё 55,6% → A, накоплено 83,3%
      ["Дельта", 5_000, "B"],  // до неё 83,3%
      ["Альфа", 1_000, "C"],   // до неё 97,2%
      ["Эпсилон", 0, "C"],
    ]);
    expect(r.rows[0]).toMatchObject({ revenue: 30_000, profit: 20_000 });
  });

  it("C-товары на основном складе: директору — по себестоимости, офису — по цене продажи", async () => {
    const ceo = await (await abc()).abc({ from: FROM, to: TO, of: "product", metric: "revenue" });
    expect(ceo.cStock).toEqual({
      count: 2, atCost: 3 * 800 + 10 * 700, atPrice: 13 * 1000,
      top: [
        { key: p.eps, name: "Эпсилон", qty: 10, unit: "pcs", atCost: 7000, atPrice: 10_000 },
        { key: p.delta, name: "Дельта", qty: 3, unit: "pcs", atCost: 2400, atPrice: 3000 },
      ],
    });
    // Остаток «Беты» на втором складе в строку не попал: продаём только с основного.
    expect(ceo.rows.find(x => x.name === "Бета")?.stockQty).toBeUndefined();
    expect(ceo.rows.find(x => x.name === "Эпсилон")?.stockQty).toBe(10);

    const op = await (await abc("operator")).abc({ from: FROM, to: TO, of: "product", metric: "revenue" });
    expect(op.cStock).toMatchObject({ count: 2, atCost: null, atPrice: 13_000 });
    expect(op.cStock!.top.every(x => x.atCost === null)).toBe(true);
    expect(op.rows.every(x => !("profit" in x))).toBe(true);
  });

  it("A-магазин без заказа 20 дней — в подсказке со светофором; заказавший сегодня — нет", async () => {
    const r = await (await abc()).abc({ from: FROM, to: TO, of: "shop", metric: "revenue" });
    expect(r.rows.map(x => [x.key, x.abc])).toEqual([[sh.alfa, "A"], [sh.beta, "A"], [sh.gamma, "B"]]);
    expect(r.cStock).toBeNull();
    expect(r.idleA).toHaveLength(1);
    expect(r.idleA![0]).toMatchObject({ key: sh.alfa, name: "Магазин Альфа", daysSinceOrder: 20, value: 50_000 });
    expect(["red", "yellow", "green"]).toContain(r.idleA![0].color);
  });

  it("права: «по прибыли» — только тому, кому открыт P&L; по выручке — всем отчётным ролям", async () => {
    for (const role of ["operator", "supervisor", "merchandiser"]) {
      await expect((await abc(role)).abc({ from: FROM, to: TO, of: "product", metric: "profit" }), role)
        .rejects.toMatchObject({ code: "FORBIDDEN" });
      const ok = await (await abc(role)).abc({ from: FROM, to: TO, of: "shop", metric: "revenue" });
      expect(ok.rows).toHaveLength(3);
    }
    for (const role of ["agent", "courier"]) {
      await expect((await abc(role)).abc({ from: FROM, to: TO, of: "product", metric: "revenue" }), role)
        .rejects.toMatchObject({ code: "FORBIDDEN" });
    }
  });
});
