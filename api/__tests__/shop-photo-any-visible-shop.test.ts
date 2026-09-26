/**
 * Фото магазина ложится туда, куда агент его снял, — или приходит отказ.
 *
 * Карточку магазина (agent.getShopById) и список (agent.myShops) агент видит
 * по всей организации: закрепление у большинства арендаторов не делали. А
 * agent.uploadMyShopPhoto писал с условием `shops.agentId = вызывающий` и
 * отвечал success, не глядя, изменилась ли строка. Снимок незакреплённого
 * или чужого магазина пропадал, а экран говорил «Фото обновлено».
 *
 * Стенд честный: условие WHERE разбирается строгим разборщиком, а UPDATE
 * отдаёт affectedRows так же, как драйвер ([ResultSetHeader, fields]).
 *
 * Нарочная поломка (каждая роняет свой тест):
 *   · вернуть в условие eq(shops.agentId, ctx.user.id) — «незакреплённый»
 *     и «закреплённый за другим»;
 *   · убрать проверку affectedRows — «чужая организация», «нет такого»;
 *   · убрать eq(shops.tenantId, …) — «чужая организация».
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { TRPCError } from "@trpc/server";

vi.mock("drizzle-orm", async () => {
  const { drizzleMock } = await import("./helpers/drizzle-mock");
  return drizzleMock();
});
vi.mock("../lib/feature-gating", () => ({
  hasSubscriptionAccess: vi.fn(async () => true),
  checkSubscriptionAccess: vi.fn(async () => true),
  invalidateSubscriptionAccess: vi.fn(),
}));
vi.mock("../lib/rate-limit", async () => (await import("./helpers/rate-limit-mock")).rateLimitMock());
vi.mock("../lib/sse", () => ({ sseBus: { emit: vi.fn() } }));

import { shops } from "@db/schema";
import { makeConditionEvaluator } from "./helpers/fake-conditions";

type Shop = { id: number; tenantId: number; agentId: number | null; photoUrl: string | null };
let rows: Shop[] = [];

const fieldOf = new Map<unknown, string>(Object.entries(shops).map(([f, c]) => [c, f]));
const evalCond = makeConditionEvaluator({ fieldOf: c => fieldOf.get(c) });

const db = {
  update: (ref: unknown) => ({
    set: (patch: Partial<Shop>) => ({
      where: async (cond: Record<string, unknown>) => {
        if (ref !== shops) throw new Error("стенд знает только shops");
        const hit = rows.filter(r => evalCond(r as unknown as Record<string, unknown>, cond));
        for (const r of hit) Object.assign(r, patch);
        // Как mysql2: кортеж [ResultSetHeader, fields]; FOUND_ROWS — число совпавших.
        return [{ affectedRows: hit.length }, []];
      },
    }),
  }),
};
vi.mock("../queries/connection", () => ({ getDb: () => db }));

function ctx(role: string, userId: number, tenantId = 1) {
  return {
    req: new Request("http://localhost/"),
    resHeaders: new Headers(),
    user: { id: userId, tenantId, role, status: "active" as const, name: "T", email: "t@t", passwordHash: "x", avatar: null, phone: null, createdAt: new Date(), updatedAt: new Date(), lastSignInAt: new Date() },
    tenant: { id: tenantId, slug: "t", name: "T", plan: "trial" as const, status: "active" as const, createdAt: new Date(), updatedAt: new Date() },
    db,
  } as never;
}

const PHOTO = "data:image/jpeg;base64,/9j/4AAQ";

beforeEach(() => {
  rows = [
    { id: 1, tenantId: 1, agentId: 10, photoUrl: null },   // свой
    { id: 2, tenantId: 1, agentId: null, photoUrl: null }, // не закреплён ни за кем
    { id: 3, tenantId: 1, agentId: 11, photoUrl: null },   // закреплён за другим агентом
    { id: 5, tenantId: 2, agentId: 10, photoUrl: null },   // чужая организация
  ];
});

describe("agent.uploadMyShopPhoto — те же магазины, что агент видит", () => {
  it("незакреплённый магазин своей организации получает снимок", async () => {
    const { agentRouter } = await import("../agent-router");
    await expect(agentRouter.createCaller(ctx("agent", 10)).uploadMyShopPhoto({ shopId: 2, dataUrl: PHOTO }))
      .resolves.toEqual({ success: true });
    expect(rows.find(r => r.id === 2)!.photoUrl, "снимок незакреплённого магазина потерян").toBe(PHOTO);
  });

  it("магазин, закреплённый за другим агентом, — тоже", async () => {
    const { agentRouter } = await import("../agent-router");
    await agentRouter.createCaller(ctx("merchandiser", 10)).uploadMyShopPhoto({ shopId: 3, dataUrl: PHOTO });
    expect(rows.find(r => r.id === 3)!.photoUrl).toBe(PHOTO);
  });

  it("магазин чужой организации — отказ, и снимок не лёг", async () => {
    const { agentRouter } = await import("../agent-router");
    const call = agentRouter.createCaller(ctx("agent", 10)).uploadMyShopPhoto({ shopId: 5, dataUrl: PHOTO });
    await expect(call).rejects.toBeInstanceOf(TRPCError);
    await expect(call).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(rows.find(r => r.id === 5)!.photoUrl, "фото легло в магазин другой организации").toBeNull();
  });

  it("нет такого магазина — отказ, а не «Фото обновлено»", async () => {
    const { agentRouter } = await import("../agent-router");
    await expect(agentRouter.createCaller(ctx("agent", 10)).uploadMyShopPhoto({ shopId: 999, dataUrl: PHOTO }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
