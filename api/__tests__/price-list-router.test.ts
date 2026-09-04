import { describe, it, expect, beforeEach, vi } from "vitest";
import type { TrpcContext } from "../context";
import { asTestContext } from "./helpers/test-context";

vi.mock("drizzle-orm", () => {
  const sqlFn = (strings: TemplateStringsArray, ...values: unknown[]) => ({ __kind: "sql", strings, values });
  const joinFn = (parts: unknown[], sep: unknown) => ({ __kind: "sql.join", parts, sep });
  return {
    eq: (col: unknown, val: unknown) => ({ __kind: "eq", col, val }),
    and: (...conds: unknown[]) => ({ __kind: "and", conds }),
  inArray: (col: unknown, values: unknown[]) => ({ __kind: "inArray", col, values }),
    desc: (col: unknown) => ({ __kind: "desc", col }),
    sql: Object.assign(sqlFn, { join: joinFn }),
    relations: () => ({}),
  };
});

vi.mock("../lib/cache", () => ({
  withCache: async (_k: string, _t: number, produce: () => unknown) => produce(),
  cache: { get: () => undefined, set: () => {}, invalidate: () => {}, invalidatePrefix: () => {} },
  CacheKeys: { dashboardKpis: () => "", commissions: () => "" },
  CacheTTL: { commissions: 60, kpis: 60 },
}));

let mockDb: any;
vi.mock("../queries/connection", () => ({ getDb: () => mockDb }));

import { priceLists, priceListItems, priceListAssignments, products, shops } from "@db/schema";
import { makeConditionEvaluator } from "./helpers/fake-conditions";

let priceListsTable: any[] = [];
let priceListItemsTable: any[] = [];
let priceListAssignmentsTable: any[] = [];
let productsTable: any[] = [];
let shopsTable: any[] = [];
let nextId = 300;

function resetTables() {
  priceListsTable = [
    { id: 1, tenantId: 1, name: "Default", type: "shop", priority: 0, isActive: true, description: null, createdAt: new Date() },
    { id: 2, tenantId: 1, name: "Wholesale", type: "volume", priority: 10, isActive: true, description: "Bulk pricing", createdAt: new Date() },
  ];
  priceListItemsTable = [
    { id: 10, priceListId: 1, productId: 1, price: "12000.00", minQuantity: "1.00" },
    { id: 11, priceListId: 1, productId: 2, price: "8500.00", minQuantity: "1.00" },
    { id: 12, priceListId: 2, productId: 1, price: "10000.00", minQuantity: "10.00" },
  ];
  priceListAssignmentsTable = [
    { id: 20, priceListId: 1, shopId: 1 },
    { id: 21, priceListId: 2, shopId: 1 },
  ];
  productsTable = [
    { id: 1, name: "Tomato", code: "T001", unitPrice: "12000.00", tenantId: 1 },
    { id: 2, name: "Cucumber", code: "C001", unitPrice: "8500.00", tenantId: 1 },
  ];
  shopsTable = [
    { id: 1, name: "Shop A", tenantId: 1 },
    { id: 2, name: "Shop B", tenantId: 1 },
  ];
  nextId = 300;
}

const colToField = new Map<unknown, string>();
// Takes a drizzle table, whose type is nothing like Record<string, unknown> —
// the narrower signature made every call site an error without catching
// anything, since the body only ever reads one property by name.
function reg(table: object, name: string) { colToField.set((table as Record<string, unknown>)[name], name); }
reg(priceLists, "id"); reg(priceLists, "tenantId"); reg(priceLists, "name"); reg(priceLists, "type");
reg(priceLists, "priority"); reg(priceLists, "isActive"); reg(priceLists, "description"); reg(priceLists, "createdAt");
reg(priceListItems, "id"); reg(priceListItems, "priceListId"); reg(priceListItems, "productId");
reg(priceListItems, "price"); reg(priceListItems, "minQuantity");
reg(priceListAssignments, "id"); reg(priceListAssignments, "priceListId"); reg(priceListAssignments, "shopId");
reg(products, "id"); reg(products, "name"); reg(products, "code"); reg(products, "unitPrice"); reg(products, "tenantId");
reg(shops, "id"); reg(shops, "name"); reg(shops, "tenantId");

function mapCol(col: unknown): string { return colToField.get(col) ?? (col as any)?.name ?? String(col); }

/**
 * Разбор условий отдан общему строгому разборщику.
 *
 * Местная копия считала выполненным всё, чего не понимала: из операторов она
 * знала не более двух-трёх, а остальные — включая `isNull` и `inArray` —
 * молча проходили. Убери кто-нибудь такой фильтр из продакшена, тест остался
 * бы зелёным.
 *
 * treatMissingColumnAsMatch оставлен намеренно: строки этого стенда описаны
 * частично, и без послабления упали бы проверки, к самому продукту отношения
 * не имеющие. Флаг виден здесь при чтении и снимается отдельно, вместе с
 * доописыванием строк.
 */
const evalCond = makeConditionEvaluator({
  fieldOf: mapCol,
  treatMissingColumnAsMatch: true,
  // Сырой sql`` этот стенд не воспроизводит; условие считается выполненным.
  // Решение записано здесь, а не спрятано в умолчании разборщика.
  rawSql: () => true,
});

function buildChain(rows: Record<string, unknown>[]) {
  const chain: any = Promise.resolve(rows);
  chain.limit = (n: number) => buildChain(rows.slice(0, n));
  chain.orderBy = () => chain;
  chain.where = (cond: unknown) => buildChain(rows.filter(r => evalCond(r, cond)));
  chain.leftJoin = () => chain;
  chain.innerJoin = () => chain;
  chain.groupBy = () => chain;
  chain.for = () => chain;
  return chain;
}

function useTable(col: unknown): Record<string, unknown>[] {
  if (col === priceLists) return priceListsTable;
  if (col === priceListItems) return priceListItemsTable;
  if (col === priceListAssignments) return priceListAssignmentsTable;
  if (col === products) return productsTable;
  if (col === shops) return shopsTable;
  return [];
}

function makeMockDb() {
  const db: any = {};
  db.select = (fields?: any) => {
    const sel: any = {};
    sel.from = (table: any) => {
      const primaryRows = useTable(table);
      const joins: any[] = [];
      const from: any = {};
      from.leftJoin = (joinTable: any, joinCond: any) => {
        if (joinCond?.__kind === "eq") joins.push({ table: useTable(joinTable), primaryCol: mapCol(joinCond.col), joinCol: mapCol(joinCond.val) });
        return from;
      };
      from.innerJoin = from.leftJoin;
      from.where = (cond: unknown) => {
        let filtered = primaryRows.filter((r: any) => evalCond(r, cond));
        for (const join of joins) {
          const expanded: Record<string, unknown>[] = [];
          for (const row of filtered) {
            const matches = join.table.filter((jr: any) => String(jr[join.joinCol]) === String(row[join.primaryCol]));
            if (matches.length === 0) expanded.push({ ...row });
            else for (const m of matches) expanded.push({ ...row, ...m });
          }
          filtered = expanded;
        }
        return buildChain(filtered);
      };
      from.then = (resolve: any, reject: any) => {
        let rows = [...primaryRows];
        for (const join of joins) {
          const expanded: Record<string, unknown>[] = [];
          for (const row of rows) {
            const matches = join.table.filter((jr: any) => String(jr[join.joinCol]) === String(row[join.primaryCol]));
            if (matches.length === 0) expanded.push({ ...row });
            else for (const m of matches) expanded.push({ ...row, ...m });
          }
          rows = expanded;
        }
        if (fields && typeof fields === "object" && !Array.isArray(fields)) {
          return Promise.resolve(rows.map(row => {
            const out: Record<string, unknown> = {};
            for (const [alias, def] of Object.entries(fields)) {
              if (typeof def === "object" && def !== null && (def as any).__kind === "count") out[alias] = rows.length;
              else out[alias] = row[mapCol(def)] ?? null;
            }
            return out;
          })).then(resolve, reject);
        }
        return Promise.resolve(rows).then(resolve, reject);
      };
      from.limit = (n: number) => buildChain(primaryRows.slice(0, n));
      from.orderBy = () => from;
      from.groupBy = () => from;
      return from;
    };
    return sel;
  };
  db.insert = (table: any) => ({
    values: vi.fn((vals: any) => {
      const id = nextId++;
      if (table === priceLists) priceListsTable.push({ id, ...vals, createdAt: new Date() });
      else if (table === priceListItems) priceListItemsTable.push({ id, ...vals });
      else if (table === priceListAssignments) priceListAssignmentsTable.push({ id, ...vals });
      return [{ insertId: id }];
    }),
  });
  db.update = (table: any) => ({
    set: (patch: Record<string, unknown>) => ({
      where: (cond: unknown) => {
        const tbl = table === priceLists ? priceListsTable : table === priceListItems ? priceListItemsTable : [];
        for (const row of tbl) {
          if (!evalCond(row, cond)) continue;
          Object.assign(row, patch);
        }
        return Promise.resolve();
      },
    }),
  });
  db.delete = (table: any) => ({
    where: (cond: unknown) => {
      const tbl = table === priceLists ? priceListsTable : table === priceListItems ? priceListItemsTable : table === priceListAssignments ? priceListAssignmentsTable : [];
      for (let i = tbl.length - 1; i >= 0; i--) {
        if (evalCond(tbl[i], cond)) tbl.splice(i, 1);
      }
      return Promise.resolve();
    },
  });
  return db;
}

function buildCtx(overrides: Record<string, unknown> = {}): TrpcContext {
  return asTestContext({
    req: new Request("http://localhost/"),
    resHeaders: new Headers(),
    db: mockDb,
    tenant: { id: 1, slug: "test", name: "Test Org", plan: "trial" as const, status: "active" as const, createdAt: new Date(), updatedAt: new Date() },
    user: { id: 10, tenantId: 1, role: "ceo" as const, status: "active" as const, name: "CEO", email: "ceo@test.com", passwordHash: "x", avatar: null, phone: null, createdAt: new Date(), updatedAt: new Date(), lastSignInAt: new Date() },
    ...overrides,
  });
}

beforeEach(() => {
  resetTables();
  mockDb = makeMockDb();
});

describe("priceList.list", () => {
  it("returns price lists for tenant", async () => {
    const { priceListRouter } = await import("../price-list-router");
    const caller = priceListRouter.createCaller(buildCtx());
    const result = await caller.list();
    expect(result.length).toBe(2);
    expect(result.every((p: any) => p.tenantId === 1)).toBe(true);
  });

  it("includes name and type", async () => {
    const { priceListRouter } = await import("../price-list-router");
    const caller = priceListRouter.createCaller(buildCtx());
    const result = await caller.list();
    expect(result[0].name).toBe("Default");
    expect(result[0].type).toBe("shop");
  });
});

describe("priceList.getById", () => {
  it("returns list with items and assignments", async () => {
    const { priceListRouter } = await import("../price-list-router");
    const caller = priceListRouter.createCaller(buildCtx());
    const result = await caller.getById({ id: 1 });
    expect(result).not.toBeNull();
    expect(result!.id).toBe(1);
  });

  it("returns null for nonexistent list", async () => {
    const { priceListRouter } = await import("../price-list-router");
    const caller = priceListRouter.createCaller(buildCtx());
    const result = await caller.getById({ id: 999 });
    expect(result).toBeNull();
  });
});

describe("priceList.create", () => {
  it("creates a new price list", async () => {
    const { priceListRouter } = await import("../price-list-router");
    const caller = priceListRouter.createCaller(buildCtx());
    const result = await caller.create({ name: "VIP Pricing", type: "tier", priority: 5 });
    expect(result.id).toBeDefined();
    expect(priceListsTable.some(p => p.name === "VIP Pricing" && p.tenantId === 1)).toBe(true);
  });

  it("sets default priority", async () => {
    const { priceListRouter } = await import("../price-list-router");
    const caller = priceListRouter.createCaller(buildCtx());
    await caller.create({ name: "Basic", type: "shop" });
    const created = priceListsTable.find(p => p.name === "Basic");
    expect(created?.priority).toBe(0);
  });
});

describe("priceList.update", () => {
  it("updates name and priority", async () => {
    const { priceListRouter } = await import("../price-list-router");
    const caller = priceListRouter.createCaller(buildCtx());
    const result = await caller.update({ id: 1, name: "Updated Default", priority: 99 });
    expect(result.success).toBe(true);
    expect(priceListsTable.find(p => p.id === 1)?.name).toBe("Updated Default");
    expect(priceListsTable.find(p => p.id === 1)?.priority).toBe(99);
  });

  it("toggles isActive", async () => {
    const { priceListRouter } = await import("../price-list-router");
    const caller = priceListRouter.createCaller(buildCtx());
    await caller.update({ id: 1, isActive: false });
    expect(priceListsTable.find(p => p.id === 1)?.isActive).toBe(false);
  });
});

describe("priceList.delete", () => {
  it("removes a price list", async () => {
    const { priceListRouter } = await import("../price-list-router");
    const caller = priceListRouter.createCaller(buildCtx());
    const result = await caller.delete({ id: 1 });
    expect(result.success).toBe(true);
    expect(priceListsTable.some(p => p.id === 1)).toBe(false);
  });
});

describe("priceList.upsertItem", () => {
  it("adds a new item to price list", async () => {
    const { priceListRouter } = await import("../price-list-router");
    const caller = priceListRouter.createCaller(buildCtx());
    const result = await caller.upsertItem({ priceListId: 1, productId: 2, price: 9999, minQuantity: 5 });
    expect(result.success).toBe(true);
    expect(priceListItemsTable.some(i => i.productId === 2 && i.priceListId === 1)).toBe(true);
  });

  it("updates existing item price", async () => {
    const { priceListRouter } = await import("../price-list-router");
    const caller = priceListRouter.createCaller(buildCtx());
    await caller.upsertItem({ priceListId: 1, productId: 1, price: 15000, minQuantity: 1 });
    const item = priceListItemsTable.find(i => i.productId === 1 && i.priceListId === 1);
    expect(item?.price).toBe("15000.00");
  });

  it("rejects nonexistent price list", async () => {
    const { priceListRouter } = await import("../price-list-router");
    const caller = priceListRouter.createCaller(buildCtx());
    await expect(caller.upsertItem({ priceListId: 999, productId: 1, price: 100 }))
      .rejects.toThrow(/не найден/i);
  });
});

describe("priceList.removeItem", () => {
  it("removes an item", async () => {
    const { priceListRouter } = await import("../price-list-router");
    const caller = priceListRouter.createCaller(buildCtx());
    const result = await caller.removeItem({ id: 10 });
    expect(result.success).toBe(true);
    expect(priceListItemsTable.some(i => i.id === 10)).toBe(false);
  });
});

describe("priceList.assignShop", () => {
  it("assigns a price list to a shop", async () => {
    const { priceListRouter } = await import("../price-list-router");
    const caller = priceListRouter.createCaller(buildCtx());
    const result = await caller.assignShop({ priceListId: 2, shopId: 2 });
    expect(result.success).toBe(true);
    expect(priceListAssignmentsTable.some(a => a.priceListId === 2 && a.shopId === 2)).toBe(true);
  });

  it("rejects nonexistent price list", async () => {
    const { priceListRouter } = await import("../price-list-router");
    const caller = priceListRouter.createCaller(buildCtx());
    await expect(caller.assignShop({ priceListId: 999, shopId: 1 }))
      .rejects.toThrow(/не найден/i);
  });

  it("rejects nonexistent shop", async () => {
    const { priceListRouter } = await import("../price-list-router");
    const caller = priceListRouter.createCaller(buildCtx());
    await expect(caller.assignShop({ priceListId: 1, shopId: 999 }))
      .rejects.toThrow(/не найден/i);
  });
});

describe("priceList.unassignShop", () => {
  it("removes assignment", async () => {
    const { priceListRouter } = await import("../price-list-router");
    const caller = priceListRouter.createCaller(buildCtx());
    const result = await caller.unassignShop({ priceListId: 1, shopId: 1 });
    expect(result.success).toBe(true);
    expect(priceListAssignmentsTable.some(a => a.priceListId === 1 && a.shopId === 1)).toBe(false);
  });
});

describe("priceList.getPrice", () => {
  it("returns default price when no price list assigned", async () => {
    priceListAssignmentsTable = [];
    const { priceListRouter } = await import("../price-list-router");
    const caller = priceListRouter.createCaller(buildCtx());
    const result = await caller.getPrice({ productId: 1, shopId: 2 });
    expect(result.price).toBe("12000.00");
    expect(result.source).toBe("default");
  });

  it("returns price from assigned price list", async () => {
    const { priceListRouter } = await import("../price-list-router");
    const caller = priceListRouter.createCaller(buildCtx());
    const result = await caller.getPrice({ productId: 1, shopId: 1, quantity: 15 });
    expect(result.price).toBeDefined();
    expect(result.source).toContain("price_list");
  });

  it("rejects nonexistent shop", async () => {
    const { priceListRouter } = await import("../price-list-router");
    const caller = priceListRouter.createCaller(buildCtx());
    await expect(caller.getPrice({ productId: 1, shopId: 999 }))
      .rejects.toThrow(/не найден/i);
  });
});
