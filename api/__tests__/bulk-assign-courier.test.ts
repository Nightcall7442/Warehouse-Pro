/**
 * Массовое назначение курьера не возвращает закрытые заказы в работу.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Одиночное назначение (courier-router.assignCourier) проверяет две вещи:
 * заказ должен быть «новый» или «в обработке», а назначаемый — курьером.
 * Массовое (order-router.bulkAssignCourier) не проверяло НИ ОДНОЙ и писало
 * delivery_status='assigned' по списку номеров как есть.
 *
 * Отсюда две беды сразу.
 *
 * Первая: доставленный, отменённый, возвращённый и даже УДАЛЁННЫЙ заказ
 * всплывал у курьера в списке доставок. Резерв по всем этим заказам снят —
 * товара за ними не числится, — и «Доставлено» по такому заказу уводило
 * reserved в минус, молча аннулируя резерв чужих открытых заказов.
 *
 * Вторая: «курьером» назначался любой сотрудник организации. Роль не
 * проверялась вовсе, так что заказ можно было повесить на агента или на
 * директора — и он пропадал из работы, не появившись ни у одного курьера.
 *
 * ── И отдельно про число в ответе ───────────────────────────────────────────
 *
 * Процедура отвечала `{ updated: input.orderIds.length }` — то есть числом
 * ЗАПРОШЕННЫХ заказов, а не изменённых. «Обновлено 20» приходило даже когда
 * не обновилось ни одного, и оператор уходил уверенным, что развоз назначен.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("drizzle-orm", async () => {
  const { drizzleMock } = await import("./helpers/drizzle-mock");
  return drizzleMock();
});

vi.mock("../lib/rate-limit", async () => (await import("./helpers/rate-limit-mock")).rateLimitMock());

vi.mock("../lib/feature-gating", () => ({
  hasSubscriptionAccess: vi.fn(async () => true),
  checkSubscriptionAccess: vi.fn(async () => true),
  invalidateSubscriptionAccess: vi.fn(),
}));

vi.mock("../lib/sanitize", () => ({
  sanitizeString: (s: string) => s.replace(/<[^>]*>/g, "").trim(),
  sanitizeSearch: (s: string) => s,
  isSafeUrl: () => true,
}));

import { orders, users } from "@db/schema";
import { makeConditionEvaluator } from "./helpers/fake-conditions";
import { asTestContext } from "./helpers/test-context";

interface FakeOrder {
  id: number; tenantId: number; status: string; deletedAt: Date | null;
  courierId: number | null; deliveryStatus: string;
}
interface FakeUser { id: number; tenantId: number; role: string }

let ordersTable: FakeOrder[] = [];
let usersTable: FakeUser[] = [];

function resetTables() {
  ordersTable = [
    { id: 1, tenantId: 1, status: "new",        deletedAt: null,       courierId: null, deliveryStatus: "not_assigned" },
    { id: 2, tenantId: 1, status: "processing", deletedAt: null,       courierId: null, deliveryStatus: "not_assigned" },
    { id: 3, tenantId: 1, status: "delivered",  deletedAt: null,       courierId: null, deliveryStatus: "not_assigned" },
    { id: 4, tenantId: 1, status: "cancelled",  deletedAt: null,       courierId: null, deliveryStatus: "not_assigned" },
    { id: 5, tenantId: 1, status: "returned",   deletedAt: null,       courierId: null, deliveryStatus: "not_assigned" },
    { id: 6, tenantId: 1, status: "new",        deletedAt: new Date(), courierId: null, deliveryStatus: "not_assigned" },
  ];
  usersTable = [
    { id: 100, tenantId: 1, role: "courier" },
    { id: 10,  tenantId: 1, role: "agent" },
  ];
}

const columnToField = new Map<unknown, string>();
for (const [field, col] of Object.entries(orders)) columnToField.set(col, field);
for (const [field, col] of Object.entries(users))  columnToField.set(col, field);

const evalCond = makeConditionEvaluator({
  fieldOf: col => columnToField.get(col) ?? (col as { name?: string } | null)?.name,
  // Строки этого стенда описаны полностью, послабление не нужно: пропущенный
  // столбец здесь означал бы ошибку в самой проверке.
  treatMissingColumnAsMatch: false,
  rawSql: () => true,
});

function rowsFor(ref: unknown): unknown[] {
  if (ref === orders) return ordersTable;
  if (ref === users) return usersTable;
  return [];
}

function makeMockDb() {
  const db = {
    select: () => {
      let ref: unknown = null;
      const api = {
        from(r: unknown) { ref = r; return api; },
        where(cond: unknown) {
          const rows = rowsFor(ref).filter(r => evalCond(r, cond));
          return Object.assign(Promise.resolve(rows), {
            limit: (n: number) => Promise.resolve(rows.slice(0, n)),
          });
        },
      };
      return api;
    },
    update: (ref: unknown) => ({
      set: (patch: Record<string, unknown>) => ({
        where: (cond: unknown) => {
          let affectedRows = 0;
          for (const row of rowsFor(ref)) {
            if (!evalCond(row, cond)) continue;
            affectedRows++;
            Object.assign(row as Record<string, unknown>, patch);
          }
          return Promise.resolve([{ affectedRows }]);
        },
      }),
    }),
  };
  return db;
}

let mockDb: ReturnType<typeof makeMockDb>;
vi.mock("../queries/connection", () => ({ getDb: () => mockDb }));

beforeEach(() => { resetTables(); mockDb = makeMockDb(); });

const ctx = () => asTestContext({
  req: new Request("http://localhost/"),
  resHeaders: new Headers(),
  user: { id: 1, tenantId: 1, role: "operator", status: "active" as const, name: "Оператор", email: "o@t.com", passwordHash: "x", avatar: null, phone: null, createdAt: new Date(), updatedAt: new Date(), lastSignInAt: new Date() },
  tenant: { id: 1, slug: "test", name: "Test Co", plan: "trial" as const, status: "active" as const, createdAt: new Date(), updatedAt: new Date() },
  db: mockDb,
});

const call = async () => {
  const { orderRouter } = await import("../order-router");
  return orderRouter.createCaller(ctx());
};

describe("order.bulkAssignCourier", () => {
  it("назначает только заказы в работе", async () => {
    const caller = await call();
    const r = await caller.bulkAssignCourier({ orderIds: [1, 2, 3, 4, 5, 6], courierId: 100 });

    expect(r.updated).toBe(2);
    expect(ordersTable.filter(o => o.courierId === 100).map(o => o.id)).toEqual([1, 2]);
  });

  it("закрытые и удалённые заказы остаются нетронутыми", async () => {
    const caller = await call();
    await caller.bulkAssignCourier({ orderIds: [3, 4, 5, 6], courierId: 100 });

    for (const id of [3, 4, 5, 6]) {
      const o = ordersTable.find(x => x.id === id)!;
      expect(o.courierId, `заказ ${id} получил курьера`).toBeNull();
      expect(o.deliveryStatus, `заказ ${id} вернулся в развоз`).toBe("not_assigned");
    }
  });

  it("отвечает числом изменённых, а не запрошенных", async () => {
    // «Обновлено 4» на четырёх закрытых заказах — это не отчёт, а обман.
    const caller = await call();
    const r = await caller.bulkAssignCourier({ orderIds: [3, 4, 5, 6], courierId: 100 });

    expect(r.updated).toBe(0);
    expect(r.skipped).toBe(4);
  });

  it("назначить можно только курьера", async () => {
    // Роль не проверялась: заказ вешался на агента и пропадал из работы,
    // не появившись ни у одного курьера.
    const caller = await call();
    await expect(caller.bulkAssignCourier({ orderIds: [1], courierId: 10 }))
      .rejects.toThrow("Курьер не найден");
  });
});
