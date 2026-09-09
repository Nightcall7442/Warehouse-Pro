import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("drizzle-orm", () => ({
  eq:  (col: unknown, val: unknown) => ({ __kind: "eq", col, val }),
  and: (...conds: unknown[]) => ({ __kind: "and", conds }),
  desc: (col: unknown) => ({ __kind: "desc", col }),
  isNull: (col: unknown) => ({ __kind: "isNull", col }),
  inArray: (col: unknown, values: unknown) => ({ __kind: "inArray", col, values }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ __kind: "sql", strings, values }),
}));

vi.mock("../lib/feature-gating", () => ({
  hasSubscriptionAccess: vi.fn(async () => true),
  checkSubscriptionAccess: vi.fn(async () => true),
  invalidateSubscriptionAccess: vi.fn(),
}));

vi.mock("../lib/rate-limit", async () => (await import("./helpers/rate-limit-mock")).rateLimitMock());

vi.mock("../lib/sse", () => ({
  sseBus: { emit: vi.fn() },
}));

import { territories, shops } from "@db/schema";
import { makeConditionEvaluator } from "./helpers/fake-conditions";

// ── Fake tables ──────────────────────────────────────────────────────────────
type FakeTerritory = { id: number; tenantId: number; name: string; color: string | null; };
interface FakeShop { id: number; tenantId: number; name: string; city: string; district?: string; address: string; status: string; territoryId: number | null; }

let territoriesTable: FakeTerritory[] = [];
let shopsTable: FakeShop[] = [];
let nextId = 10;

function resetTables() {
  territoriesTable = [
    { id: 1, tenantId: 1, name: "Central", color: "#FF0000" },
    { id: 2, tenantId: 1, name: "North", color: "#00FF00" },
  ];
  shopsTable = [
    { id: 1, tenantId: 1, name: "Shop A", city: "Tashkent", address: "123 Main", status: "active", territoryId: 1 },
    { id: 2, tenantId: 1, name: "Shop B", city: "Samarkand", address: "456 Side", status: "active", territoryId: 2 },
    { id: 3, tenantId: 1, name: "Shop C", city: "Bukhara", address: "789 Blvd", status: "active", territoryId: null },
  ];
  nextId = 10;
}

function tableOf(ref: unknown): string {
  if (ref === territories) return "territories";
  if (ref === shops) return "shops";
  return "other";
}

function rowsFor(table: string): Record<string, unknown>[] {
  if (table === "territories") return territoriesTable as unknown as Record<string, unknown>[];
  if (table === "shops") return shopsTable as unknown as Record<string, unknown>[];
  return [];
}

const columnToFieldName = new Map<unknown, string>();
for (const [field, col] of Object.entries(territories)) columnToFieldName.set(col, field);
for (const [field, col] of Object.entries(shops)) columnToFieldName.set(col, field);

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
  fieldOf: col => columnToFieldName.get(col) ?? (col as { name?: string } | null)?.name,
  treatMissingColumnAsMatch: true,
  // Сырой sql`` этот стенд не воспроизводит; условие считается выполненным.
  // Решение записано здесь, а не спрятано в умолчании разборщика.
  rawSql: () => true,
});

function chainable(rows: Record<string, unknown>[]) {
  const p = Promise.resolve(rows) as Promise<Record<string, unknown>[]> & {
    limit?: (n: number) => ReturnType<typeof chainable>;
    orderBy?: (..._a: unknown[]) => ReturnType<typeof chainable>;
    groupBy?: (..._a: unknown[]) => ReturnType<typeof chainable>;
  };
  p.limit = (n: number) => chainable(rows.slice(0, n));
  p.orderBy = () => chainable(rows);
  p.groupBy = () => chainable(rows);
  return p;
}

function makeMockDb() {
  const db: any = {
    select: (proj?: unknown) => {
      const isCountQuery = proj && typeof proj === "object" && "count" in (proj as Record<string, unknown>);
      let currentTable = "other";
      const api: Record<string, any> = {
        from(ref: unknown) { currentTable = tableOf(ref); return api; },
        leftJoin() {
          // Simple join simulation: attach shop count
          return {
            where(cond: unknown) {
              const filtered = rowsFor(currentTable).filter((r) => evalCond(r, cond as Record<string, unknown>));
              // For territories.list, compute shopCount
              if (currentTable === "territories") {
                const enriched = filtered.map((row) => {
                  const count = shopsTable.filter((s) => s.tenantId === row.tenantId && s.territoryId === row.id).length;
                  return { ...row, count };
                });
                if (isCountQuery) return chainable([{ count: enriched.length }]);
                return chainable(enriched);
              }
              return chainable(filtered);
            },
            orderBy() { return chainable([]); },
            groupBy() { return chainable([]); },
          };
        },
        where(cond: unknown) {
          const filtered = rowsFor(currentTable).filter((r) => evalCond(r, cond as Record<string, unknown>));
          if (isCountQuery) return chainable([{ count: filtered.length }]);
          return chainable(filtered);
        },
        limit(n: number) { return chainable(rowsFor(currentTable).slice(0, n)); },
        orderBy() { return chainable(rowsFor(currentTable)); },
        groupBy() { return chainable(rowsFor(currentTable)); },
      };
      return api;
    },
    insert: (ref: unknown) => ({
      values: (vals: Record<string, unknown>) => {
        const table = tableOf(ref);
        if (table === "territories") {
          const id = nextId++;
          territoriesTable.push({
            id, tenantId: vals.tenantId as number, name: vals.name as string,
            color: (vals.color as string) ?? null,
          });
          return Promise.resolve([{ insertId: id }]);
        }
        return Promise.resolve([{ insertId: 1 }]);
      },
    }),
    update: (ref: unknown) => ({
      set(patch: Record<string, unknown>) {
        return {
          where(cond: unknown) {
            for (const row of rowsFor(tableOf(ref))) {
              if (!evalCond(row as Record<string, unknown>, cond as Record<string, unknown>)) continue;
              for (const [key, val] of Object.entries(patch)) {
                if (val !== undefined) row[key] = val;
              }
            }
            return Promise.resolve();
          },
        };
      },
    }),
    delete: (ref: unknown) => ({
      where: (cond: Record<string, unknown>) => {
        const table = tableOf(ref);
        if (table === "territories") {
          territoriesTable = territoriesTable.filter((r) => !evalCond(r, cond));
        }
        return Promise.resolve();
      },
    }),
    transaction: async (fn: (tx: Record<string, unknown>) => Promise<unknown>) => fn(db),
  };
  return db;
}

let mockDb: ReturnType<typeof makeMockDb>;
vi.mock("../queries/connection", () => ({ getDb: () => mockDb }));

function makeCtx(tenantId: number, userId: number, role = "operator"): any {
  return {
    req: new Request("http://localhost/"),
    resHeaders: new Headers(),
    user: { id: userId, tenantId, role, status: "active" as const, name: "Test", email: "t@t.com", passwordHash: "x", avatar: null, phone: null, createdAt: new Date(), updatedAt: new Date(), lastSignInAt: new Date() },
    tenant: { id: tenantId, slug: "test", name: "Test Co", plan: "trial" as const, status: "active" as const, createdAt: new Date(), updatedAt: new Date() },
    db: mockDb,
  };
}

beforeEach(() => {
  resetTables();
  mockDb = makeMockDb();
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe("territory.list", () => {
  it("returns territories with shop counts", async () => {
    const { territoryRouter } = await import("../territory-router");
    const caller = territoryRouter.createCaller(makeCtx(1, 10));
    const result = await caller.list() as any;
    expect(result.length).toBeGreaterThanOrEqual(2);
    expect(result[0].name).toBeDefined();
    expect(result[0].id).toBeDefined();
  });

  it("only returns territories for current tenant", async () => {
    territoriesTable.push({ id: 99, tenantId: 999, name: "Other", color: null });
    const { territoryRouter } = await import("../territory-router");
    const caller = territoryRouter.createCaller(makeCtx(1, 10));
    const result = await caller.list() as any;
    expect(result.every((t: any) => t.tenantId !== 999)).toBe(true);
  });
});

describe("territory.create", () => {
  it("creates territory with name and color", async () => {
    const { territoryRouter } = await import("../territory-router");
    const caller = territoryRouter.createCaller(makeCtx(1, 1, "supervisor"));
    const result = await caller.create({ name: "South", color: "#0000FF" });
    expect(result.id).toBe(10);
    const created = territoriesTable.find((t) => t.id === result.id)!;
    expect(created.name).toBe("South");
    expect(created.color).toBe("#0000FF");
  });

  it("creates territory without color", async () => {
    const { territoryRouter } = await import("../territory-router");
    const caller = territoryRouter.createCaller(makeCtx(1, 1, "supervisor"));
    const result = await caller.create({ name: "West" });
    expect(result.id).toBe(10);
    const created = territoriesTable.find((t) => t.id === result.id)!;
    expect(created.name).toBe("West");
    expect(created.color).toBeNull();
  });
});

describe("territory.update", () => {
  it("updates territory name", async () => {
    const { territoryRouter } = await import("../territory-router");
    const caller = territoryRouter.createCaller(makeCtx(1, 1, "supervisor"));
    const result = await caller.update({ id: 1, name: "Central Updated" });
    expect(result.success).toBe(true);
    expect(territoriesTable.find((t) => t.id === 1)!.name).toBe("Central Updated");
  });

  it("updates territory color", async () => {
    const { territoryRouter } = await import("../territory-router");
    const caller = territoryRouter.createCaller(makeCtx(1, 1, "supervisor"));
    await caller.update({ id: 1, color: "#AABBCC" });
    expect(territoriesTable.find((t) => t.id === 1)!.color).toBe("#AABBCC");
  });

  it("only updates territories in same tenant", async () => {
    territoriesTable.push({ id: 99, tenantId: 999, name: "Other", color: null });
    const { territoryRouter } = await import("../territory-router");
    const caller = territoryRouter.createCaller(makeCtx(1, 1, "supervisor"));
    await caller.update({ id: 99, name: "Hacked" });
    expect(territoriesTable.find((t) => t.id === 99)!.name).toBe("Other");
  });
});

describe("territory.delete", () => {
  it("deletes territory and unlinks shops", async () => {
    const { territoryRouter } = await import("../territory-router");
    const caller = territoryRouter.createCaller(makeCtx(1, 1, "supervisor"));
    const result = await caller.delete({ id: 1 });
    expect(result.success).toBe(true);
    expect(territoriesTable.find((t) => t.id === 1)).toBeUndefined();
    // Shop that had territoryId=1 should now have null
    const shop1 = shopsTable.find((s) => s.id === 1)!;
    expect(shop1.territoryId).toBeNull();
  });

  it("only deletes territories in same tenant", async () => {
    territoriesTable.push({ id: 99, tenantId: 999, name: "Other", color: null });
    const { territoryRouter } = await import("../territory-router");
    const caller = territoryRouter.createCaller(makeCtx(1, 1, "supervisor"));
    await caller.delete({ id: 99 });
    expect(territoriesTable.find((t) => t.id === 99)).toBeDefined();
  });
});

describe("territory.getShops", () => {
  it("returns shops in a territory", async () => {
    const { territoryRouter } = await import("../territory-router");
    const caller = territoryRouter.createCaller(makeCtx(1, 10));
    const result = await caller.getShops({ territoryId: 1 }) as any;
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result.some((s: any) => s.name === "Shop A")).toBe(true);
  });

  it("returns empty for territory with no shops", async () => {
    territoriesTable.push({ id: 50, tenantId: 1, name: "Empty", color: null });
    const { territoryRouter } = await import("../territory-router");
    const caller = territoryRouter.createCaller(makeCtx(1, 10));
    const result = await caller.getShops({ territoryId: 50 }) as any;
    expect(result).toHaveLength(0);
  });

  it("only returns active shops", async () => {
    shopsTable.push({ id: 50, tenantId: 1, name: "Inactive", city: "X", address: "Y", status: "inactive", territoryId: 1 });
    const { territoryRouter } = await import("../territory-router");
    const caller = territoryRouter.createCaller(makeCtx(1, 10));
    const result = await caller.getShops({ territoryId: 1 }) as any;
    expect(result.every((s: any) => s.name !== "Inactive")).toBe(true);
  });
});

describe("territory.delete — cascading", () => {
  it("nullifies territoryId on all shops referencing deleted territory", async () => {
    const { territoryRouter } = await import("../territory-router");
    const caller = territoryRouter.createCaller(makeCtx(1, 1, "supervisor"));

    const shopBefore = shopsTable.find(s => s.id === 1)!;
    expect(shopBefore.territoryId).toBe(1);

    await caller.delete({ id: 1 });

    const shopAfter = shopsTable.find(s => s.id === 1)!;
    expect(shopAfter.territoryId).toBeNull();
  });

  it("does not affect shops in other territories", async () => {
    const { territoryRouter } = await import("../territory-router");
    const caller = territoryRouter.createCaller(makeCtx(1, 1, "supervisor"));

    await caller.delete({ id: 1 });

    const shop2 = shopsTable.find(s => s.id === 2)!;
    expect(shop2.territoryId).toBe(2);
  });

  it("does not affect shops with null territoryId", async () => {
    const { territoryRouter } = await import("../territory-router");
    const caller = territoryRouter.createCaller(makeCtx(1, 1, "supervisor"));

    const shop3 = shopsTable.find(s => s.id === 3)!;
    expect(shop3.territoryId).toBeNull();

    await caller.delete({ id: 1 });

    const shop3After = shopsTable.find(s => s.id === 3)!;
    expect(shop3After.territoryId).toBeNull();
  });
});

describe("territory.getShops — filtering", () => {
  it("only returns shops belonging to current tenant", async () => {
    shopsTable.push({ id: 99, tenantId: 999, name: "Other Tenant Shop", city: "X", address: "Y", status: "active", territoryId: 1 });
    const { territoryRouter } = await import("../territory-router");
    const caller = territoryRouter.createCaller(makeCtx(1, 10));
    const result = await caller.getShops({ territoryId: 1 }) as any;
    expect(result.every((s: any) => s.tenantId !== 999)).toBe(true);
  });
});

/**
 * Территории из магазинов.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Территорию заводили только руками: имя, цвет, координаты центра, радиус. У
 * арендатора с двумя сотнями точек, где город и район уже записаны в карточке
 * каждого магазина, это работа на вечер — и ровно та, где машина вернее
 * человека, потому что данные для неё уже лежат в базе.
 *
 * ── Чего здесь боятся ───────────────────────────────────────────────────────
 *
 * Кнопка, создающая десяток справочных записей, опасна двумя способами:
 * повторным нажатием (справочник удваивается) и переигрыванием ручной работы
 * (магазин, отнесённый к соседнему району осознанно, уезжает обратно). Оба
 * случая проверяются ниже.
 */
describe("territory.createFromShops", () => {
  const supervisor = async () => {
    const { territoryRouter } = await import("../territory-router");
    return territoryRouter.createCaller(makeCtx(1, 1, "supervisor"));
  };

  beforeEach(() => {
    territoriesTable = [];
    shopsTable = [
      { id: 1, tenantId: 1, name: "A", city: "Ташкент",  address: "", status: "active", territoryId: null },
      { id: 2, tenantId: 1, name: "B", city: "ташкент ", address: "", status: "active", territoryId: null },
      { id: 3, tenantId: 1, name: "C", city: "Самарканд", address: "", status: "active", territoryId: null },
      // Уже отнесён руками — трогать нельзя.
      { id: 4, tenantId: 1, name: "D", city: "Самарканд", address: "", status: "active", territoryId: 99 },
      // Архивный: территории не требует.
      { id: 5, tenantId: 1, name: "E", city: "Бухара",   address: "", status: "inactive", territoryId: null },
      // Город не заполнен — группировать не по чему.
      { id: 6, tenantId: 1, name: "F", city: "   ",      address: "", status: "active", territoryId: null },
      // Чужая организация.
      { id: 7, tenantId: 2, name: "G", city: "Ташкент",  address: "", status: "active", territoryId: null },
    ];
    nextId = 10;
  });

  it("на каждый город — одна территория", async () => {
    const r = await (await supervisor()).createFromShops({ by: "city" });
    expect(r.created).toBe(2); // Ташкент и Самарканд
    expect(territoriesTable.map(t => t.name).sort()).toEqual(["Самарканд", "Ташкент"]);
  });

  it("разное написание — один город", async () => {
    // «Ташкент» и «ташкент » — одно место, и три территории вместо одной
    // здесь не нужны никому.
    await (await supervisor()).createFromShops({ by: "city" });
    expect(territoriesTable.filter(t => t.name.toLowerCase() === "ташкент")).toHaveLength(1);
  });

  it("магазины привязываются к своей территории", async () => {
    await (await supervisor()).createFromShops({ by: "city" });
    const tashkent = territoriesTable.find(t => t.name === "Ташкент")!;
    expect(shopsTable.find(s => s.id === 1)!.territoryId).toBe(tashkent.id);
    expect(shopsTable.find(s => s.id === 2)!.territoryId).toBe(tashkent.id);
  });

  it("уже отнесённый магазин не переигрывают", async () => {
    /*
      Его отнесли осознанно: точка на границе районов могла быть сознательно
      отдана соседу. Кнопка заполняет пустое, а не переписывает заполненное.
    */
    await (await supervisor()).createFromShops({ by: "city" });
    expect(shopsTable.find(s => s.id === 4)!.territoryId, "чужое решение переписано").toBe(99);
  });

  it("архивный магазин территории не требует", async () => {
    await (await supervisor()).createFromShops({ by: "city" });
    expect(territoriesTable.some(t => t.name === "Бухара"), "архивный попал в счёт").toBe(false);
  });

  it("пустой город не заводит безымянную территорию", async () => {
    await (await supervisor()).createFromShops({ by: "city" });
    expect(territoriesTable.some(t => t.name.trim() === ""), "завелась территория без имени").toBe(false);
  });

  it("второе нажатие не удваивает справочник", async () => {
    // Нажимают дважды почти всегда: первый раз чтобы посмотреть, второй —
    // «кажется, не сработало».
    await (await supervisor()).createFromShops({ by: "city" });
    const after = territoriesTable.length;
    const again = await (await supervisor()).createFromShops({ by: "city" });
    expect(again.created).toBe(0);
    expect(territoriesTable).toHaveLength(after);
  });

  it("территорию с таким именем не создаёт заново", async () => {
    territoriesTable = [{ id: 5, tenantId: 1, name: "  ТАШКЕНТ ", color: "#5b6d8a" }];
    const r = await (await supervisor()).createFromShops({ by: "city" });
    expect(r.created).toBe(1); // только Самарканд
    expect(shopsTable.find(s => s.id === 1)!.territoryId).toBe(5);
  });

  it("группировать не по чему — говорит словами", async () => {
    shopsTable = shopsTable.map(s => ({ ...s, city: "" }));
    await expect((await supervisor()).createFromShops({ by: "city" }))
      .rejects.toThrow(/город/i);
  });

  it("агенту не открыто", async () => {
    const { territoryRouter } = await import("../territory-router");
    const agent = territoryRouter.createCaller(makeCtx(1, 7, "agent"));
    await expect(agent.createFromShops({ by: "city" })).rejects.toThrow();
  });
});

describe("territory.previewFromShops", () => {
  beforeEach(() => {
    territoriesTable = [{ id: 5, tenantId: 1, name: "Ташкент", color: "#5b6d8a" }];
    shopsTable = [
      { id: 1, tenantId: 1, name: "A", city: "Ташкент", address: "", status: "active", territoryId: null },
      { id: 2, tenantId: 1, name: "B", city: "Самарканд", address: "", status: "active", territoryId: null },
    ];
  });

  it("считает и ничего не меняет", async () => {
    /*
      Создание десятка сущностей вслепую — не то действие, которое делают одним
      нажатием. Предпросмотр показывает, что именно получится.
    */
    const { territoryRouter } = await import("../territory-router");
    const caller = territoryRouter.createCaller(makeCtx(1, 1, "supervisor"));
    const r = await caller.previewFromShops({ by: "city" });

    expect(r.toCreate, "существующий город снова пошёл бы в создание").toBe(1);
    expect(r.toAssign).toBe(2);
    expect(territoriesTable).toHaveLength(1);
  });

  it("отмечает города, у которых территория уже есть", async () => {
    const { territoryRouter } = await import("../territory-router");
    const caller = territoryRouter.createCaller(makeCtx(1, 1, "supervisor"));
    const r = await caller.previewFromShops({ by: "city" });
    expect(r.items.find(i => i.name === "Ташкент")!.exists).toBe(true);
    expect(r.items.find(i => i.name === "Самарканд")!.exists).toBe(false);
  });
});

/**
 * Почему получился ноль.
 *
 * «Создать 0» — верный ответ и бесполезный. Причин у нуля три, и человек не
 * может отличить их друг от друга: поле не заполнено ни у кого; территории на
 * все города уже заведены; магазины и так разложены. В каждом случае делать
 * надо разное, а экран молчал — владелец открыл его у Serena Trade, увидел
 * ноль и спросил, как вообще создать территорию.
 *
 * Поэтому предпросмотр отдаёт не только итог, но и слагаемые.
 */
describe("предпросмотр объясняет свой ответ", () => {
  const caller = async () => {
    const { territoryRouter } = await import("../territory-router");
    return territoryRouter.createCaller(makeCtx(1, 1, "supervisor"));
  };

  it("считает магазины без города отдельно", async () => {
    /*
      Их видно всегда, а не только при нуле: иначе человек создаст территории,
      недосчитается половины точек и не поймёт, куда они делись.
    */
    territoriesTable = [];
    shopsTable = [
      { id: 1, tenantId: 1, name: "A", city: "Ташкент", address: "", status: "active", territoryId: null },
      { id: 2, tenantId: 1, name: "B", city: "",        address: "", status: "active", territoryId: null },
      { id: 3, tenantId: 1, name: "C", city: "   ",     address: "", status: "active", territoryId: null },
    ];

    const r = await (await caller()).previewFromShops({ by: "city" });

    expect(r.totalShops).toBe(3);
    expect(r.withoutPlace, "магазины без города не посчитаны").toBe(2);
    expect(r.toCreate).toBe(1);
  });

  it("отличает «уже разложено» от «нечего группировать»", async () => {
    // Ноль при заведённых территориях и ноль при пустом поле — разные беды.
    territoriesTable = [{ id: 5, tenantId: 1, name: "Ташкент", color: "#5b6d8a" }];
    shopsTable = [
      { id: 1, tenantId: 1, name: "A", city: "Ташкент", address: "", status: "active", territoryId: 5 },
    ];

    const r = await (await caller()).previewFromShops({ by: "city" });

    expect(r.toCreate).toBe(0);
    expect(r.toAssign).toBe(0);
    expect(r.withoutPlace, "поле заполнено — значит беда не в нём").toBe(0);
    expect(r.existingTerritories).toBe(1);
    expect(r.alreadyAssigned).toBe(1);
  });

  it("архивные магазины в счёт не идут", async () => {
    // Территория архивному не нужна, а в «у скольких не заполнено» он завысил
    // бы число и отправил человека заполнять карточки, которые не в работе.
    territoriesTable = [];
    shopsTable = [
      { id: 1, tenantId: 1, name: "A", city: "Ташкент", address: "", status: "active", territoryId: null },
      { id: 2, tenantId: 1, name: "B", city: "",        address: "", status: "inactive", territoryId: null },
    ];

    const r = await (await caller()).previewFromShops({ by: "city" });

    expect(r.totalShops).toBe(1);
    expect(r.withoutPlace).toBe(0);
  });

  it("экран называет кнопку тем, что она сделает", () => {
    /*
      «Создать 0» при непривязанных магазинах говорило «делать нечего», хотя
      привязать ещё требовалось.
    */
    const { readFileSync } = require("node:fs") as typeof import("node:fs");
    const { join } = require("node:path") as typeof import("node:path");
    const view = readFileSync(join(process.cwd(), "src", "components", "shops", "TerritoryManager.tsx"), "utf8");

    expect(view).toContain("Привязать ${p.toAssign} магазинов");
    expect(view).toContain("Создать ${p.toCreate} и привязать ${p.toAssign}");
    expect(view, "причина нуля не названа").toContain("withoutPlace === p.totalShops");
  });
});
