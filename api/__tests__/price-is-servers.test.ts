/**
 * Цену назначает сервер, а не поле.
 *
 * Аудит 20.09.2026 (критично): order.updateItems под fieldSalesQuery
 * принимал unitPrice с клиента и записывал как есть — агент правил свой
 * заказ 1 000 000 → 10, минуя порог скидки (hold) и кредитный лимит.
 *
 * Теперь полевые роли (агент, супервайзер, мерчендайзер) меняют только
 * количество: сервер отбрасывает unitPrice из их запроса ещё в роутере —
 * существующая строка держит свою цену, новая берёт цену магазина. Офис
 * (руководитель, оператор) цену задаёт.
 *
 * Нарочная поломка: в order-router верни `{ items: input.items }` без
 * отсечения — упадёт «агент»; сделай `office` всегда true — упадёт там же.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../lib/rate-limit", async () => (await import("./helpers/rate-limit-mock")).rateLimitMock());
vi.mock("../lib/feature-gating", () => ({
  hasSubscriptionAccess: vi.fn(async () => true),
  checkSubscriptionAccess: vi.fn(async () => true),
  invalidateSubscriptionAccess: vi.fn(),
}));

const received: Array<{ role: string; items: unknown }> = [];
let currentRole = "agent";
vi.mock("../services/order", () => ({
  OrderService: {
    updateItems: vi.fn(async (_db: unknown, _t: number, _id: number, data: { items: unknown }) => { received.push({ role: currentRole, items: data.items }); return { success: true }; }),
  },
  assertOrderVisible: vi.fn(async () => undefined),
  assertItemsEditableBy: vi.fn(async () => undefined),
}));
vi.mock("../queries/connection", () => ({ getDb: () => ({}) }));

import { asTestContext } from "./helpers/test-context";

const ctx = (role: string) => asTestContext({
  req: new Request("http://localhost/"),
  resHeaders: new Headers(),
  user: { id: 7, tenantId: 1, role, status: "active" as const, name: "Кто-то", email: "x@t.com", passwordHash: "x", avatar: null, phone: null, createdAt: new Date(), updatedAt: new Date() },
  tenant: { id: 1, slug: "test", name: "Test Co", plan: "pro" as const, status: "active" as const, createdAt: new Date(), updatedAt: new Date() },
  db: {},
});

async function updateItemsAs(role: string) {
  currentRole = role;
  const { orderRouter } = await import("../order-router");
  const caller = orderRouter.createCaller(ctx(role));
  await caller.updateItems({ id: 5, items: [{ itemId: 1, quantity: 10, unitPrice: "1" }, { productId: 2, quantity: 1, unitPrice: 0.5 }] });
  return received.find(r => r.role === role)!.items as Array<Record<string, unknown>>;
}

describe("цена строки заказа", () => {
  beforeEach(() => { received.length = 0; });

  it("агент: unitPrice с клиента отбрасывается — и у существующей строки, и у новой", async () => {
    const items = await updateItemsAs("agent");
    expect(items).toEqual([{ itemId: 1, quantity: 10 }, { productId: 2, quantity: 1 }]);
  });

  it("супервайзер и мерчендайзер — так же", async () => {
    for (const role of ["supervisor", "merchandiser"]) {
      const items = await updateItemsAs(role);
      expect(items.every(i => !("unitPrice" in i)), role).toBe(true);
    }
  });

  it("оператор и руководитель задают цену", async () => {
    for (const role of ["operator", "ceo"]) {
      const items = await updateItemsAs(role);
      expect(items[0], role).toMatchObject({ itemId: 1, unitPrice: "1" });
      expect(items[1], role).toMatchObject({ productId: 2, unitPrice: "0.5" });
    }
  });
});
