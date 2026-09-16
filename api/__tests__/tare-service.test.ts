/**
 * Служба тары без базы: та же логика, что в real-db/tare-flow, но на
 * памяти — чтобы правила жили и в обычном прогоне, где настоящей базы нет.
 *
 * База-подделка понимает eq/and/inArray/orderBy/groupBy/limit/leftJoin по
 * настоящим колонкам схемы и суммирует sql-маркер (coalesce(sum(delta))) при
 * группировке — ровно то, что зовёт служба. Всё остальное — честные строки.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { tareTypes, tareMovements, products, shops, warehouses, orders, returns, payments, settings, users } from "@db/schema";

vi.mock("drizzle-orm", async () => { const { drizzleMock } = await import("./helpers/drizzle-mock"); return drizzleMock(); });
vi.mock("../services/shop-debt", () => ({ recalcShopDebt: vi.fn(async () => undefined) }));
vi.mock("../services/audit-log", () => ({ recordAudit: vi.fn(async () => undefined) }));

type Row = Record<string, unknown>;
type Marker = { __kind: string; col?: unknown; val?: unknown; conds?: Marker[]; values?: unknown[]; strings?: string[] };
const TABLES = [tareTypes, tareMovements, products, shops, warehouses, orders, returns, payments, settings, users] as const;
const colKey = new Map<object, string>();
const tableOf = new Map<object, object>();
for (const t of TABLES) for (const [k, v] of Object.entries(t)) if (v && typeof v === "object" && "columnType" in v) { colKey.set(v, k); tableOf.set(v, t); }

function fakeDb() {
  const store = new Map<object, Row[]>(TABLES.map(t => [t, []]));
  let nextId = 1;
  type Ctx = Map<object, Row | undefined>;
  const val = (ctx: Ctx, c: unknown) => (typeof c === "object" && c && colKey.has(c) ? ctx.get(tableOf.get(c)!)?.[colKey.get(c)!] : c);
  const test = (ctx: Ctx, m: Marker | undefined): boolean => {
    if (!m || typeof m !== "object") return true;
    switch (m.__kind) {
      case "eq": return String(val(ctx, m.col)) === String(val(ctx, m.val));
      case "ne": return String(val(ctx, m.col)) !== String(val(ctx, m.val));
      case "and": return (m.conds ?? []).every(c => test(ctx, c));
      case "or": return (m.conds ?? []).some(c => test(ctx, c));
      case "inArray": return (m.values as unknown[]).map(String).includes(String(val(ctx, m.col)));
      default: return true;
    }
  };
  const select = (cols?: Record<string, unknown>) => {
    const st = { from: null as object | null, joins: [] as Array<{ t: object; on: Marker }>, where: undefined as Marker | undefined, order: [] as unknown[], group: false, limit: Infinity };
    const run = () => {
      let ctxs: Ctx[] = store.get(st.from!)!.map(r => new Map<object, Row | undefined>([[st.from!, r]]));
      for (const j of st.joins) ctxs = ctxs.map(ctx => { const hit = store.get(j.t)!.find(r => test(new Map([...ctx, [j.t, r]]), j.on)); return new Map([...ctx, [j.t, hit]]); });
      ctxs = ctxs.filter(ctx => test(ctx, st.where));
      const project = (ctx: Ctx): Row => cols ? Object.fromEntries(Object.entries(cols).map(([k, c]) => [k, val(ctx, c)])) : { ...(ctx.get(st.from!) as Row) };
      let rows: Row[];
      if (st.group && cols) {
        const sums = Object.entries(cols).filter(([, c]) => (c as Marker)?.__kind === "sql") as Array<[string, Marker]>;
        const plain = Object.keys(cols).filter(k => !sums.some(([s]) => s === k));
        const groups = new Map<string, { row: Row; ctxs: Ctx[] }>();
        for (const ctx of ctxs) { const p = project(ctx); const key = plain.map(k => String(p[k])).join("|"); const g = groups.get(key) ?? { row: Object.fromEntries(plain.map(k => [k, p[k]])), ctxs: [] }; g.ctxs.push(ctx); groups.set(key, g); }
        rows = [...groups.values()].map(g => ({ ...g.row, ...Object.fromEntries(sums.map(([k, m]) => [k, String(g.ctxs.reduce((s, ctx) => s + Number(val(ctx, m.values![0])), 0))])) }));
      } else rows = ctxs.map(project);
      for (const o of st.order) {
        const desc = (o as Marker)?.__kind === "desc"; const c = desc ? (o as Marker).col : o; const k = colKey.get(c as object)!;
        if (k) rows.sort((a, b) => (String(a[k] ?? "") < String(b[k] ?? "") ? -1 : 1) * (desc ? -1 : 1));
      }
      return rows.slice(0, st.limit);
    };
    const chain = {
      from(t: object) { st.from = t; return chain; },
      leftJoin(t: object, on: Marker) { st.joins.push({ t, on }); return chain; },
      innerJoin(t: object, on: Marker) { st.joins.push({ t, on }); return chain; },
      where(m: Marker) { st.where = m; return chain; },
      orderBy(...o: unknown[]) { st.order = o; return chain; },
      groupBy() { st.group = true; return chain; },
      limit(n: number) { st.limit = n; return chain; },
      for() { return chain; },
      then(res: (r: Row[]) => void, rej: (e: unknown) => void) { try { res(run()); } catch (e) { rej(e); } },
    };
    return chain;
  };
  const db: Record<string, unknown> = {
    select,
    insert: (t: object) => ({ values: async (v: Row | Row[]) => { const rows = Array.isArray(v) ? v : [v]; const first = nextId; for (const r of rows) store.get(t)!.push({ id: nextId++, ...r }); return [{ insertId: first }]; } }),
    update: (t: object) => ({ set: (s: Row) => ({ where: async (m: Marker) => { for (const r of store.get(t)!) if (test(new Map([[t, r]]), m)) Object.assign(r, s); } }) }),
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),
    rows: (t: object) => store.get(t)!,
    seed: (t: object, r: Row) => { const row = { id: nextId++, ...r }; store.get(t)!.push(row); return row.id as number; },
  };
  return db as typeof db & { rows: (t: object) => Row[]; seed: (t: object, r: Row) => number };
}

const T = 1;
const ceo = { id: 9, name: "Директор", role: "ceo" };
let db: ReturnType<typeof fakeDb>;
let keg = 0, box = 0, wh = 0, van = 0, shop = 0, prod = 0, plain = 0;
beforeEach(() => {
  db = fakeDb();
  keg = db.seed(tareTypes, { tenantId: T, name: "Кега 50 л", depositPrice: "50000.00", isActive: true });
  box = db.seed(tareTypes, { tenantId: T, name: "Ящик", depositPrice: "0.00", isActive: true });
  wh = db.seed(warehouses, { tenantId: T, name: "Основной", kind: "warehouse", driverId: null });
  van = db.seed(warehouses, { tenantId: T, name: "Газель", kind: "van", driverId: 4 });
  shop = db.seed(shops, { tenantId: T, name: "Магазин Альфа" });
  prod = db.seed(products, { tenantId: T, name: "Пиво", tareTypeId: keg, tarePerUnit: "2.000" });
  plain = db.seed(products, { tenantId: T, name: "Чипсы", tareTypeId: null, tarePerUnit: "1.000" });
  db.seed(users, { tenantId: T, name: "Курьер" });
  db.seed(settings, { tenantId: T, tareEnabled: true });
});
const svc = async () => (await import("../services/tare"));
const anyDb = () => db as never;

describe("виды и тара товара", () => {
  it("вид: пустое имя, отрицательный залог, чужой id — отказ; создание и правка пишут залог строкой", async () => {
    const { TareService } = await svc();
    await expect(TareService.saveType(anyDb(), T, ceo, { name: " ", depositPrice: 0 })).rejects.toThrow(/название/);
    await expect(TareService.saveType(anyDb(), T, ceo, { name: "Бутылка", depositPrice: -5 })).rejects.toThrow(/отрицательным/);
    await expect(TareService.saveType(anyDb(), T, ceo, { id: 777, name: "Бутылка", depositPrice: 1 })).rejects.toThrow(/не найден/);
    const { id } = await TareService.saveType(anyDb(), T, ceo, { name: "Бутылка 0,5", depositPrice: 1500 });
    expect(db.rows(tareTypes).find(r => r.id === id)).toMatchObject({ depositPrice: "1500.00", isActive: true });
    await TareService.saveType(anyDb(), T, ceo, { id, name: "Бутылка 0,33", depositPrice: 1200, isActive: false });
    expect(db.rows(tareTypes).find(r => r.id === id)).toMatchObject({ name: "Бутылка 0,33", depositPrice: "1200.00", isActive: false });
    expect((await TareService.types(anyDb(), T)).map(t => t.depositPrice)).toEqual([1200, 50000, 0]);
  });
  it("тара товара: чужой вид и ноль на единицу — отказ; снятие тары возвращает единицу", async () => {
    const { TareService } = await svc();
    await expect(TareService.setProductTare(anyDb(), T, ceo, { productId: prod, tareTypeId: 777, perUnit: 1 })).rejects.toThrow(/Вид тары не найден/);
    await expect(TareService.setProductTare(anyDb(), T, ceo, { productId: prod, tareTypeId: keg, perUnit: 0 })).rejects.toThrow(/больше нуля/);
    await expect(TareService.setProductTare(anyDb(), T, ceo, { productId: 777, tareTypeId: null, perUnit: 1 })).rejects.toThrow(/Товар не найден/);
    await TareService.setProductTare(anyDb(), T, ceo, { productId: plain, tareTypeId: box, perUnit: 3 });
    expect(db.rows(products).find(r => r.id === plain)).toMatchObject({ tareTypeId: box, tarePerUnit: "3.000" });
    await TareService.setProductTare(anyDb(), T, ceo, { productId: plain, tareTypeId: null, perUnit: 3 });
    expect(db.rows(products).find(r => r.id === plain)).toMatchObject({ tareTypeId: null, tarePerUnit: "1.000" });
  });
});

describe("тара следует за товаром", () => {
  it("товар без тары — тишина; доставка — магазин заказа; возврат — магазин возврата; приход — только склад", async () => {
    const { followStock } = await svc();
    const order = db.seed(orders, { tenantId: T, shopId: shop });
    const ret = db.seed(returns, { tenantId: T, shopId: shop });
    await followStock(anyDb(), { tenantId: T, warehouseId: wh, productId: plain, type: "in", quantity: 5, reason: "arrival", referenceId: null });
    expect(db.rows(tareMovements)).toHaveLength(0);
    await followStock(anyDb(), { tenantId: T, warehouseId: wh, productId: prod, type: "in", quantity: 5, reason: "arrival", referenceId: null });
    await followStock(anyDb(), { tenantId: T, warehouseId: van, productId: prod, type: "out", quantity: 2, reason: "order_delivery", referenceId: order });
    await followStock(anyDb(), { tenantId: T, warehouseId: wh, productId: prod, type: "in", quantity: 1, reason: "return_completed", referenceId: ret });
    const mv = db.rows(tareMovements).map(r => [r.holderKind, r.holderId, r.delta, r.note]);
    expect(mv).toEqual([
      ["warehouse", wh, "10.000", "arrival"],
      ["warehouse", van, "-4.000", "order_delivery"], ["shop", shop, "4.000", "order_delivery"],
      ["warehouse", wh, "2.000", "return_completed"], ["shop", shop, "-2.000", "return_completed"],
    ]);
    expect(db.rows(tareMovements).every(r => r.reason === "follow" && r.tareTypeId === keg)).toBe(true);
  });
});

describe("обзор, приём, списание, пересчёт", () => {
  const seedHeld = () => {
    db.seed(tareMovements, { tenantId: T, tareTypeId: keg, holderKind: "warehouse", holderId: wh, delta: "5.000", reason: "follow" });
    db.seed(tareMovements, { tenantId: T, tareTypeId: keg, holderKind: "warehouse", holderId: van, delta: "2.000", reason: "follow" });
    db.seed(tareMovements, { tenantId: T, tareTypeId: keg, holderKind: "shop", holderId: shop, delta: "4.000", reason: "follow" });
    db.seed(tareMovements, { tenantId: T, tareTypeId: box, holderKind: "shop", holderId: shop, delta: "1.000", reason: "follow" });
    db.seed(tareMovements, { tenantId: T, tareTypeId: box, holderKind: "shop", holderId: shop, delta: "-1.000", reason: "return" });
  };
  it("обзор: машины помечены, нули не показываются, залог считается по виду", async () => {
    seedHeld();
    const { TareService } = await svc();
    const o = await TareService.overview(anyDb(), T);
    expect(o.warehouses.map(w => [w.name, w.van, w.units])).toEqual([["Основной", false, 5], ["Газель", true, 2]]);
    expect(o.shops).toEqual([{ id: shop, name: "Магазин Альфа", van: false, lines: [{ tareTypeId: keg, name: "Кега 50 л", qty: 4, deposit: 200000 }], units: 4, deposit: 200000 }]);
    expect(o.totals).toEqual({ atShops: 4, depositAtShops: 200000 });
    expect(await TareService.shop(anyDb(), T, shop)).toEqual([{ tareTypeId: keg, name: "Кега 50 л", qty: 4, depositPrice: 50000, deposit: 200000 }]);
  });
  it("приём: склад и магазин должны быть; больше, чем числится — отказ по имени; нули не считаются; пара строк на позицию", async () => {
    seedHeld();
    const { TareService } = await svc();
    await expect(TareService.returnFromShop(anyDb(), T, ceo, { shopId: shop, warehouseId: 777, items: [] })).rejects.toThrow(/Склад не найден/);
    await expect(TareService.returnFromShop(anyDb(), T, ceo, { shopId: 777, warehouseId: wh, items: [] })).rejects.toThrow(/Магазин не найден/);
    await expect(TareService.returnFromShop(anyDb(), T, ceo, { shopId: shop, warehouseId: wh, items: [{ tareTypeId: keg, quantity: 5 }] })).rejects.toThrow(/«Магазин Альфа» числится 4 Кега 50 л — принять 5 нельзя/);
    await expect(TareService.returnFromShop(anyDb(), T, ceo, { shopId: shop, warehouseId: wh, items: [{ tareTypeId: box, quantity: 1 }] })).rejects.toThrow(/числится 0 тары — принять 1 нельзя/);
    await expect(TareService.returnFromShop(anyDb(), T, ceo, { shopId: shop, warehouseId: wh, items: [{ tareTypeId: keg, quantity: 0 }] })).rejects.toThrow(/сколько тары вернулось/);
    const before = db.rows(tareMovements).length;
    expect(await TareService.returnFromShop(anyDb(), T, ceo, { shopId: shop, warehouseId: van, items: [{ tareTypeId: keg, quantity: 3 }], note: "привёз" })).toEqual({ units: 3 });
    const added = db.rows(tareMovements).slice(before);
    expect(added.map(r => [r.holderKind, r.holderId, r.delta, r.reason])).toEqual([["shop", shop, "-3.000", "return"], ["warehouse", van, "3.000", "return"]]);
    expect(added[0].note).toBe("Возврат тары от «Магазин Альфа» · привёз");
    expect((await TareService.shop(anyDb(), T, shop))[0].qty).toBe(1);
  });
  it("списание: без причины и сверх остатка — отказ; с залогом — строка долга и пересчёт; без залога — только штуки", async () => {
    seedHeld();
    db.seed(tareMovements, { tenantId: T, tareTypeId: box, holderKind: "shop", holderId: shop, delta: "2.000", reason: "follow" });
    const { TareService } = await svc();
    const { recalcShopDebt } = await import("../services/shop-debt");
    await expect(TareService.charge(anyDb(), T, ceo, { shopId: shop, tareTypeId: keg, quantity: 0, reason: "бой" })).rejects.toThrow(/больше нуля/);
    await expect(TareService.charge(anyDb(), T, ceo, { shopId: shop, tareTypeId: keg, quantity: 1, reason: "  " })).rejects.toThrow(/без причины/);
    await expect(TareService.charge(anyDb(), T, ceo, { shopId: shop, tareTypeId: keg, quantity: 5, reason: "бой" })).rejects.toThrow(/числится 4 Кега 50 л — списать 5 нельзя/);
    expect(await TareService.charge(anyDb(), T, ceo, { shopId: shop, tareTypeId: keg, quantity: 2, reason: "бой" })).toEqual({ amount: 100000 });
    expect(db.rows(payments)).toHaveLength(1);
    expect(db.rows(payments)[0]).toMatchObject({ shopId: shop, amount: "100000.00", type: "debt", createdBy: ceo.id });
    expect(String(db.rows(payments)[0].notes)).toContain("2 × Кега 50 л по залогу · бой");
    expect(recalcShopDebt).toHaveBeenCalledTimes(1);
    expect(await TareService.charge(anyDb(), T, ceo, { shopId: shop, tareTypeId: box, quantity: 2, reason: "потеряли" })).toEqual({ amount: 0 });
    expect(db.rows(payments)).toHaveLength(1);
    expect(recalcShopDebt).toHaveBeenCalledTimes(1);
    expect((await TareService.shop(anyDb(), T, shop)).map(x => [x.tareTypeId, x.qty])).toEqual([[keg, 2]]);
  });
  it("пересчёт: чужой вид и минус — отказ; недостача снимается и стоит по залогу; излишек — плюс без денег; сошлось — тишина", async () => {
    seedHeld();
    const { TareService } = await svc();
    await expect(TareService.count(anyDb(), T, ceo, { warehouseId: van, counted: [{ tareTypeId: 777, quantity: 1 }] })).rejects.toThrow(/Вид тары не найден/);
    await expect(TareService.count(anyDb(), T, ceo, { warehouseId: van, counted: [{ tareTypeId: keg, quantity: -1 }] })).rejects.toThrow(/отрицательным/);
    const before = db.rows(tareMovements).length;
    const r = await TareService.count(anyDb(), T, ceo, { warehouseId: van, counted: [{ tareTypeId: keg, quantity: 1 }, { tareTypeId: box, quantity: 3 }] });
    expect(r.shortage).toBe(50000);
    expect(r.lines).toEqual([
      { tareTypeId: keg, name: "Кега 50 л", system: 2, counted: 1, diff: -1, deposit: 50000 },
      { tareTypeId: box, name: "Ящик", system: 0, counted: 3, diff: 3, deposit: 0 },
    ]);
    expect(db.rows(tareMovements).slice(before).map(x => [x.tareTypeId, x.delta, x.reason])).toEqual([[keg, "-1.000", "count"], [box, "3.000", "count"]]);
    const same = await TareService.count(anyDb(), T, ceo, { warehouseId: van, counted: [{ tareTypeId: keg, quantity: 1 }] });
    expect(same).toEqual({ lines: [{ tareTypeId: keg, name: "Кега 50 л", system: 1, counted: 1, diff: 0, deposit: 0 }], shortage: 0 });
    expect(db.rows(tareMovements)).toHaveLength(before + 2);
  });
  it("журнал: имя тары и кто провёл — из соседних таблиц; по держателю — только его строки", async () => {
    seedHeld();
    db.seed(tareMovements, { tenantId: T, tareTypeId: keg, holderKind: "warehouse", holderId: van, delta: "-1.000", reason: "count", createdBy: db.rows(users)[0].id, createdAt: new Date() });
    const { TareService } = await svc();
    const range = { from: new Date(0), to: new Date(8.64e15) };
    const all = await TareService.movements(anyDb(), T, range);
    expect(all).toHaveLength(6);
    expect(all[0]).toMatchObject({ reason: "count", delta: -1, tareName: "Кега 50 л", by: "Курьер" });
    expect(all.at(-1)).toMatchObject({ tareName: "Кега 50 л", by: undefined });
    expect((await TareService.movements(anyDb(), T, { ...range, holder: { kind: "shop", id: shop } })).map(m => m.delta)).toEqual([-1, 1, 4]);
  });
});

describe("тариф и тумблер", () => {
  it("basic — отказ тарифом; выключено — отказ тумблером; включено — тишина", async () => {
    const { assertTare } = await svc();
    await expect(assertTare(anyDb(), T, "basic")).rejects.toThrow(/Pro и Exclusive/);
    await expect(assertTare(anyDb(), T, "pro")).resolves.toBeUndefined();
    db.rows(settings)[0].tareEnabled = false;
    await expect(assertTare(anyDb(), T, "trial")).rejects.toThrow(/выключен/);
  });
});
