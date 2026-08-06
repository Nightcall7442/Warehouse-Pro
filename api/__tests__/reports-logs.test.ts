import { describe, it, expect, vi, beforeEach } from "vitest";

let mockDb: any;
vi.mock("../queries/connection", () => ({ getDb: () => mockDb }));
vi.mock("../lib/rate-limit", () => ({
  checkRateLimit: vi.fn(() => true),
  getClientIp: vi.fn(() => "127.0.0.1"),
}));
vi.mock("drizzle-orm", () => {
  const sqlFn = Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) => ({ __kind: "sql", strings, values }),
    { join: (chunks: unknown[]) => ({ __kind: "sql_join", chunks }), raw: (str: string) => ({ __kind: "raw", str }) },
  );
  return {
    eq: (col: unknown, val: unknown) => ({ __kind: "eq", col, val }),
    and: (...conds: unknown[]) => ({ __kind: "and", conds }),
    desc: (col: unknown) => ({ __kind: "desc", col }),
    gte: (col: unknown, val: unknown) => ({ __kind: "gte", col, val }),
    inArray: (col: unknown, values: unknown[]) => ({ __kind: "inArray", col, values }),
    sql: sqlFn,
  };
});

import { dailyPlans, users, shops, stockMovements, products } from "@db/schema";

/**
 * A small fake db for two plain SELECT … JOIN … WHERE queries.
 *
 * Columns are addressed as table+field rather than by bare name. The analytics
 * harness flattens joined rows into one object, and `shops` and `users` both
 * have `name` — whichever table is spread last wins, so a report that joins
 * both silently prints the agent where the shop belongs. Keeping the table
 * alongside the field removes that whole class of error rather than picking a
 * winner. WHERE also runs after the joins, as SQL does; filtering first means a
 * condition on a joined column meets a row that doesn't carry it and is quietly
 * ignored, and the test then proves nothing.
 */
interface Row { [table: string]: Record<string, unknown> | undefined }

let plansTable: Array<Record<string, unknown>> = [];
let usersTable: Array<Record<string, unknown>> = [];
let shopsTable: Array<Record<string, unknown>> = [];
let movementsTable: Array<Record<string, unknown>> = [];
let productsTable: Array<Record<string, unknown>> = [];

function resetTables() {
  plansTable = [
    { id: 1, tenantId: 1, agentId: 10, shopId: 1, planDate: "2026-03-05", status: "visited", visitedAt: new Date("2026-03-05T09:30:00Z"), photoUrl: "data:image/jpeg;base64,AAA", notes: "всё есть" },
    { id: 2, tenantId: 1, agentId: 10, shopId: 2, planDate: "2026-03-05", status: "planned", visitedAt: null, photoUrl: null, notes: null },
    { id: 3, tenantId: 1, agentId: 11, shopId: 1, planDate: "2026-03-06", status: "skipped", visitedAt: null, photoUrl: "", notes: "закрыто" },
    { id: 4, tenantId: 1, agentId: 10, shopId: 1, planDate: "2026-02-01", status: "visited", visitedAt: new Date("2026-02-01T11:00:00Z"), photoUrl: null, notes: null },
    { id: 5, tenantId: 2, agentId: 99, shopId: 9, planDate: "2026-03-05", status: "visited", visitedAt: new Date("2026-03-05T10:00:00Z"), photoUrl: null, notes: "чужой тенант" },
  ];
  usersTable = [
    { id: 10, tenantId: 1, name: "Агент Один" },
    { id: 11, tenantId: 1, name: "Агент Два" },
    { id: 99, tenantId: 2, name: "Чужой" },
  ];
  shopsTable = [
    { id: 1, tenantId: 1, name: "Альфа", city: "Ташкент", address: "ул. 1" },
    { id: 2, tenantId: 1, name: "Бета", city: "Самарканд", address: "ул. 2" },
    { id: 9, tenantId: 2, name: "Чужой магазин", city: "Бухара", address: "ул. 9" },
  ];
  movementsTable = [
    { id: 1, tenantId: 1, productId: 1, type: "in", quantity: "100.00", referenceType: "arrival", referenceId: 5, notes: null, createdAt: "2026-03-05 10:00:00" },
    { id: 2, tenantId: 1, productId: 1, type: "out", quantity: "20.00", referenceType: "order", referenceId: 7, notes: null, createdAt: "2026-03-06 12:00:00" },
    { id: 3, tenantId: 1, productId: 2, type: "adjustment", quantity: "-3.00", referenceType: null, referenceId: null, notes: "пересчёт", createdAt: "2026-02-01 09:00:00" },
    { id: 4, tenantId: 2, productId: 3, type: "in", quantity: "50.00", referenceType: "arrival", referenceId: 8, notes: null, createdAt: "2026-03-05 11:00:00" },
  ];
  productsTable = [
    { id: 1, tenantId: 1, name: "Товар А", code: "A001" },
    { id: 2, tenantId: 1, name: "Товар Б", code: "B002" },
    { id: 3, tenantId: 2, name: "Чужой товар", code: "C003" },
  ];
}

/** Column object → which table it belongs to and what it is called there. */
const columns = new Map<unknown, { table: string; field: string }>();
function reg(ref: object, table: string, ...fields: string[]) {
  for (const f of fields) columns.set((ref as Record<string, unknown>)[f], { table, field: f });
}
reg(dailyPlans, "plans", "id", "tenantId", "agentId", "shopId", "planDate", "status", "visitedAt", "photoUrl", "notes");
reg(users, "users", "id", "tenantId", "name");
reg(shops, "shops", "id", "tenantId", "name", "city", "address");
reg(stockMovements, "movements", "id", "tenantId", "productId", "type", "quantity", "referenceType", "referenceId", "notes", "createdAt");
reg(products, "products", "id", "tenantId", "name", "code");

const at = (row: Row, c: unknown) => {
  const ref = columns.get(c);
  return ref ? row[ref.table]?.[ref.field] : undefined;
};
const has = (row: Row, c: unknown) => {
  const ref = columns.get(c);
  return !!ref && row[ref.table] !== undefined && ref.field in (row[ref.table] as object);
};

const cmp = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v));

function evalCond(row: Row, cond: any): boolean {
  if (!cond || typeof cond !== "object") return true;
  if (cond.__kind === "and") return cond.conds.every((c: any) => evalCond(row, c));
  if (cond.__kind === "eq") {
    if (!has(row, cond.col)) return true;
    // A join condition has a column on both sides; a filter has a value on the
    // right. Treating the former as a literal made every join match nothing.
    const right = columns.has(cond.val) ? at(row, cond.val) : cond.val;
    return String(at(row, cond.col)) === String(right);
  }
  if (cond.__kind === "sql") {
    const col = cond.values?.[0];
    if (!has(row, col)) return true;
    const text = (cond.strings ?? []).join("");
    const bound = cond.values?.[cond.values.length - 1];
    const op = text.includes(">=") ? ">=" : text.includes("<=") ? "<=" : null;
    if (!op || bound === undefined) return true;
    return op === ">=" ? cmp(at(row, col)) >= String(bound) : cmp(at(row, col)) <= String(bound);
  }
  return true;
}

const TABLES = new Map<unknown, [string, () => Array<Record<string, unknown>>]>();
function bindTables() {
  TABLES.set(dailyPlans, ["plans", () => plansTable]);
  TABLES.set(users, ["users", () => usersTable]);
  TABLES.set(shops, ["shops", () => shopsTable]);
  TABLES.set(stockMovements, ["movements", () => movementsTable]);
  TABLES.set(products, ["products", () => productsTable]);
}
bindTables();

function makeMockDb() {
  return {
    select: (fields: Record<string, unknown>) => ({
      from: (ref: unknown) => {
        const [primaryName, primaryRows] = TABLES.get(ref)!;
        const joins: Array<{ name: string; rows: () => Array<Record<string, unknown>>; on: any }> = [];

        const chain: any = {
          leftJoin(joinRef: unknown, cond: any) {
            const [name, rows] = TABLES.get(joinRef)!;
            joins.push({ name, rows, on: cond });
            return chain;
          },
          where(cond: unknown) {
            let rows: Row[] = primaryRows().map(r => ({ [primaryName]: r }));

            for (const j of joins) {
              rows = rows.map(row => {
                const match = j.rows().find(candidate => {
                  const probe: Row = { ...row, [j.name]: candidate };
                  return evalCond(probe, j.on);
                });
                return { ...row, [j.name]: match };
              });
            }

            const kept = rows.filter(r => evalCond(r, cond));

            const project = (list: Row[]) => list.map(row => {
              const out: Record<string, unknown> = {};
              for (const [alias, def] of Object.entries(fields)) {
                if (def && typeof def === "object" && (def as any).__kind === "sql") {
                  // The only raw sql in these projections is the photo flag.
                  const v = at(row, (def as any).values?.[0]);
                  out[alias] = v === null || v === undefined || v === "" ? 0 : 1;
                } else {
                  out[alias] = at(row, def) ?? null;
                }
              }
              return out;
            });

            const result: any = Promise.resolve(project(kept));
            result.orderBy = () => result;
            result.limit = (n: number) => Promise.resolve(project(kept.slice(0, n)));
            return result;
          },
        };
        return chain;
      },
    }),
  };
}

function ctx() {
  return {
    req: new Request("http://localhost/"),
    resHeaders: new Headers(),
    db: mockDb,
    tenant: { id: 1, slug: "t", name: "T", plan: "trial" as const, status: "active" as const, createdAt: new Date(), updatedAt: new Date() },
    user: { id: 1, tenantId: 1, role: "operator", status: "active" as const, name: "T", email: "t@t.com", passwordHash: "x", avatar: null, phone: null, createdAt: new Date(), updatedAt: new Date(), lastSignInAt: new Date() },
  };
}

async function caller() {
  const { reportsRouter } = await import("../reports-router");
  return reportsRouter.createCaller(ctx() as Parameters<typeof reportsRouter.createCaller>[0]);
}

beforeEach(() => {
  resetTables();
  mockDb = makeMockDb();
});

const MARCH = { dateFrom: "2026-03-01", dateTo: "2026-03-31" };

describe("reports.getVisitsLog", () => {
  it("returns one row per planned visit in the period", async () => {
    const rows = await (await caller()).getVisitsLog(MARCH);

    // Plan 4 is February, plan 5 belongs to another tenant.
    expect(rows).toHaveLength(3);
  });

  it("never reaches another tenant's visits", async () => {
    const rows = await (await caller()).getVisitsLog(MARCH);

    expect(rows.map(r => r.shopName)).not.toContain("Чужой магазин");
    expect(rows.map(r => r.agentName)).not.toContain("Чужой");
  });

  // Both shops and users carry a `name`. Getting this wrong swaps the agent and
  // the shop in every row of the report.
  it("keeps the shop name and the agent name apart", async () => {
    const rows = await (await caller()).getVisitsLog(MARCH);
    const visited = rows.find(r => r.status === "visited")!;

    expect(visited.shopName).toBe("Альфа");
    expect(visited.agentName).toBe("Агент Один");
  });

  it("reports the visit time, and leaves it empty where none was recorded", async () => {
    const rows = await (await caller()).getVisitsLog(MARCH);

    expect(rows.find(r => r.status === "visited")?.visitedAt).toBeInstanceOf(Date);
    // A plan still merely planned has no visit time, and must not borrow one.
    expect(rows.find(r => r.status === "planned")?.visitedAt).toBeNull();
  });

  // photo_url holds a data URL of several megabytes. The report answers whether
  // proof exists, and must not drag the blob into a spreadsheet to do it.
  it("reports whether a photo exists without carrying it", async () => {
    const rows = await (await caller()).getVisitsLog(MARCH);

    expect(rows.find(r => r.status === "visited")?.hasPhoto).toBe(1);
    expect(rows.find(r => r.status === "planned")?.hasPhoto).toBe(0);
    // An empty string is not a photo either.
    expect(rows.find(r => r.status === "skipped")?.hasPhoto).toBe(0);
    expect(JSON.stringify(rows)).not.toContain("base64");
  });

  it("narrows to one agent", async () => {
    const rows = await (await caller()).getVisitsLog({ ...MARCH, agentId: 11 });

    expect(rows).toHaveLength(1);
    expect(rows[0].agentName).toBe("Агент Два");
  });

  it("narrows to one shop", async () => {
    const rows = await (await caller()).getVisitsLog({ ...MARCH, shopId: 2 });

    expect(rows.map(r => r.shopName)).toEqual(["Бета"]);
  });
});

describe("reports.getStockMovements", () => {
  it("returns the movements of the period across every product", async () => {
    const rows = await (await caller()).getStockMovements(MARCH);

    // The February adjustment and the other tenant's arrival are both out.
    expect(rows).toHaveLength(2);
    expect(rows.map(r => r.productName)).toEqual(["Товар А", "Товар А"]);
  });

  it("never reaches another tenant's movements", async () => {
    const rows = await (await caller()).getStockMovements(MARCH);

    expect(rows.map(r => r.productCode)).not.toContain("C003");
  });

  it("narrows to one movement type", async () => {
    const rows = await (await caller()).getStockMovements({ ...MARCH, type: "out" });

    expect(rows).toHaveLength(1);
    expect(rows[0].quantity).toBe("20.00");
  });

  it("includes the whole final day", async () => {
    // A bare date bound would cut off everything after midnight on the last day,
    // losing a whole day of movements from any report that ends "today".
    const rows = await (await caller()).getStockMovements({ dateFrom: "2026-03-06", dateTo: "2026-03-06" });

    expect(rows).toHaveLength(1);
    expect(rows[0].referenceId).toBe(7);
  });
});

/**
 * The column only means anything if something writes it.
 *
 * Asserted against the source: updatePlanStatus runs through a mutation with
 * its own permission logic, and what needs guarding here is the rule, not the
 * query — a plan moved back out of "visited" must not keep a timestamp saying
 * it was, or the log shows a visit that did not happen.
 */
describe("visitedAt is written when a plan is marked visited", () => {
  it("stamps on the way in and clears on the way out", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const src = readFileSync(resolve(__dirname, "../agent-router.ts"), "utf8");
    const start = src.indexOf("  updatePlanStatus:");
    const body = src.slice(start, src.indexOf("return { success: true }", start));

    expect(body).toContain("visitedAt:");
    expect(body).toMatch(/input\.status === "visited" \? new Date\(\) : null/);
  });
});
