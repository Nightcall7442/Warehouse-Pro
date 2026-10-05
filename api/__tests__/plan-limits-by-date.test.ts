import { describe, it, expect, vi, afterEach } from "vitest";

/**
 * Пределы мест и товаров — по тарифу НА СЕГОДНЯ (contracts/pricing.ts).
 *
 * «Стандарт» и пробный упираться не во что: людей и товаров сколько угодно.
 * Прежний Basic держит свои 5 мест (+ надбавка) до 05.10.2027 — до этого дня
 * у него не меняется ничего, — а с него пределы снимаются сами, без правки
 * базы. Проверяется настоящая checkPlanLimits на подставной базе: первая
 * выборка — организация, вторая — счёт.
 */
vi.mock("../queries/connection", () => ({ getDb: () => null }));

function fakeDb(tenant: Record<string, unknown>, count: number) {
  const calls = { counted: 0 };
  let n = 0;
  const db = {
    select: () => ({
      from: () => ({
        where: () => {
          n++;
          if (n === 1) return { limit: async () => [tenant] };
          calls.counted++;
          return Promise.resolve([{ count }]);
        },
      }),
    }),
  };
  return { db: db as never, calls };
}

afterEach(() => { vi.useRealTimers(); });

const at = (iso: string) => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(iso)); };

describe("checkPlanLimits по дате", () => {
  it("«Стандарт» и пробный: предела нет, и база не считает", async () => {
    at("2026-10-05T09:00:00Z");
    const { checkPlanLimits } = await import("../lib/plan-limits");
    for (const plan of ["standard", "trial"]) {
      for (const resource of ["users", "products", "orders"] as const) {
        const { db, calls } = fakeDb({ id: 1, plan, extraUsers: 0, extraProducts: 0 }, 100_000);
        expect(await checkPlanLimits(db, 1, resource), `${plan}/${resource}`).toEqual({ allowed: true, current: 0, limit: null });
        expect(calls.counted, `${plan}/${resource}: считал`).toBe(0);
      }
    }
  });

  it("прежний Basic до 05.10.2027 — 5 мест плюс надбавка, как было", async () => {
    at("2027-10-04T18:59:00Z"); // 04.10.2027 23:59 по Ташкенту
    const { checkPlanLimits } = await import("../lib/plan-limits");
    const full = fakeDb({ id: 1, plan: "basic", extraUsers: 2, extraProducts: 0 }, 7);
    expect(await checkPlanLimits(full.db, 1, "users")).toEqual({ allowed: false, current: 7, limit: 7 });
    const room = fakeDb({ id: 1, plan: "basic", extraUsers: 0, extraProducts: 0 }, 49);
    expect(await checkPlanLimits(room.db, 1, "products")).toEqual({ allowed: true, current: 49, limit: 50 });
  });

  it("с 05.10.2027 у прежнего Basic пределов нет", async () => {
    at("2027-10-04T19:00:00Z"); // 05.10.2027 00:00 по Ташкенту
    const { checkPlanLimits } = await import("../lib/plan-limits");
    const { db, calls } = fakeDb({ id: 1, plan: "basic", extraUsers: 0, extraProducts: 0 }, 500);
    expect(await checkPlanLimits(db, 1, "users")).toEqual({ allowed: true, current: 0, limit: null });
    expect(calls.counted).toBe(0);
  });
});
