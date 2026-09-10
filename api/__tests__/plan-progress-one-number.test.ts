/**
 * Выполнение плана — одно число на всех.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Прогресс считался в двух местах и по-разному.
 *
 * Агент открывает свой план (`myQuota`) — там он считался ВЖИВУЮ, запросом по
 * заказам за период. Начальник открывает тот же план у себя (`list`,
 * `summary`) — там читались колонки actual_amount, actual_order_count,
 * actual_visit_pct. Заполняет их только `recalculateActuals`, а зовёт её ровно
 * никто: ручка есть, кнопки нет ни в вебе, ни в мобильном.
 *
 * То есть у колонок стояли умолчания — нули. Агент видел «выполнено на 80 %»,
 * начальник в тот же час видел ноль, и ни один экран не сообщал, что числа
 * разной свежести.
 *
 * ── Что проверяется здесь ───────────────────────────────────────────────────
 *
 * Что счёт остался один. Раньше расчётов было два (а с recalculateActuals —
 * три), и каждый со своими границами периода и своим разбором визитов. Пока
 * их больше одного, любое расхождение можно объяснить чем угодно.
 *
 * Сам запрос — сырой SQL, и заглушка его не исполняет; поэтому здесь
 * проверяется не арифметика MySQL, а то, что все три ручки спрашивают ОДНУ
 * функцию и раскладывают её ответ по прежним именам полей. Арифметику ловит
 * набор real-db.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// vi.mock поднимается наверх файла, поэтому подстановка объявляется через
// vi.hoisted — обычная переменная к моменту подмены ещё не существует.
const { actualsForTargets } = vi.hoisted(() => ({ actualsForTargets: vi.fn() }));
vi.mock("../services/sales-target-actuals", () => ({ actualsForTargets }));
vi.mock("../lib/cache", () => ({
  cache: { invalidate: vi.fn(), get: vi.fn(), set: vi.fn() },
  CacheKeys: { salesTargets: (id: number) => `st:${id}` },
}));
vi.mock("../services/quota-suggest", () => ({ suggestQuotas: vi.fn() }));

/** Один план: месячный, на агента 10, без привязки к магазину. */
const TARGET = {
  id: 42, userId: 10, userName: "Азиз", shopId: null, territoryId: null,
  periodType: "monthly" as const,
  periodStart: new Date("2026-09-01"), periodEnd: new Date("2026-09-30"),
  targetAmount: "1000000.00", orderCountTarget: 20, visitTarget: "80.00",
  notes: null,
};

/** Что посчитала общая функция: 80 % плана по деньгам. */
const ACTUALS = { revenue: 800000, orderCount: 16, visitPct: 75 };

let updated: Record<string, unknown>[] = [];

vi.mock("../queries/connection", () => ({
  getDb: () => ({
    select: () => {
      const api = {
        from: () => api,
        leftJoin: () => api,
        where: () => Object.assign(Promise.resolve([TARGET]), {
          orderBy: () => Promise.resolve([TARGET]),
          limit: () => Promise.resolve([TARGET]),
        }),
      };
      return api;
    },
    update: () => ({
      set: (patch: Record<string, unknown>) => {
        updated.push(patch);
        return { where: () => Promise.resolve([{ affectedRows: 1 }]) };
      },
    }),
  }),
}));

import { salesTargetRouter } from "../sales-target-router";
import { asTestContext } from "./helpers/test-context";
import type { TrpcContext } from "../context";

function ctx(role: string, userId = 10): TrpcContext {
  return asTestContext({
    req: new Request("http://localhost/"),
    resHeaders: new Headers(),
    user: {
      id: userId, tenantId: 1, role, status: "active" as const, name: "Кто-то",
      email: "a@a.com", passwordHash: "x", avatar: null, phone: null,
      createdAt: new Date(), updatedAt: new Date(), lastSignInAt: new Date(),
    },
    tenant: {
      id: 1, slug: "t", name: "Тест", plan: "trial" as const,
      status: "active" as const, createdAt: new Date(), updatedAt: new Date(),
    },
  });
}

beforeEach(() => {
  updated = [];
  actualsForTargets.mockReset().mockResolvedValue(new Map([[42, ACTUALS]]));
});

describe("выполнение плана считается одним счётом", () => {
  it("список планов у начальника отдаёт посчитанное, а не колонки", async () => {
    const caller = salesTargetRouter.createCaller(ctx("supervisor"));
    const [row] = await caller.list({});

    expect(actualsForTargets).toHaveBeenCalledWith(expect.anything(), 1, [42]);
    expect(row.actualAmount).toBe("800000.00");
    expect(row.actualOrderCount).toBe(16);
    expect(row.actualVisitPct).toBe("75.00");
  });

  it("сводка у начальника считает долю от того же числа", async () => {
    const caller = salesTargetRouter.createCaller(ctx("supervisor"));
    const [row] = await caller.summary();

    // 800 000 из 1 000 000 — восемьдесят процентов, а не ноль из колонки.
    expect(row.revenueCompletion).toBe(80);
    expect(row.orderCompletion).toBe(80);
    expect(row.visitCompletion).toBe(75);
  });

  it("агент у себя видит ровно то же", async () => {
    const caller = salesTargetRouter.createCaller(ctx("agent"));
    const out = await caller.myQuota();

    expect(out?.revenue.actual).toBe(800000);
    expect(out?.revenue.pct).toBe(80);
    expect(out?.orders.actual).toBe(16);
    expect(out?.visits.actual).toBe(75);
  });

  /*
    Здесь была проверка пересчёта снимка в колонках actual_*. Пересчёт удалён:
    его никто не звал, а колонки никто не читает — три ручки ниже считают
    выполнение вживую. Снимок, который никто не пишет и никто не читает, — это
    просто устаревающие числа в базе.
  */

  it("все три ручки спрашивают один и тот же счёт", async () => {
    // Страховка от возврата второго расчёта: если где-то заведут свой,
    // вызовов станет меньше трёх, а числа снова разойдутся.
    const boss = salesTargetRouter.createCaller(ctx("supervisor"));
    const agent = salesTargetRouter.createCaller(ctx("agent"));

    await boss.list({});
    await boss.summary();
    await agent.myQuota();

    expect(actualsForTargets).toHaveBeenCalledTimes(3);
    for (const call of actualsForTargets.mock.calls) {
      expect(call[1], "счёт ушёл в чужую организацию").toBe(1);
    }
  });
});
