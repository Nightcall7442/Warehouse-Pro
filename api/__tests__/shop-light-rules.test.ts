/**
 * Правила светофора и список причин «без заказа» — чистые функции контракта.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Ни цвета магазина, ни причин отказа не существовало. Правила теперь живут
 * одним местом (contracts/shop-light.ts, contracts/no-order-reason.ts), и их
 * края должны быть ровно там, где написано в комментарии: «больше 70%», а
 * не «от 70%»; «больше двух интервалов», а не «от двух».
 *
 * ── Что проверяется ─────────────────────────────────────────────────────────
 *
 *  1. Красный: просрочка; долг больше лимита (ровно лимит — ещё не красный);
 *     лимит 0 при долге — красный (как у заказа в долг).
 *  2. Жёлтый: долг строго больше 70% лимита; пауза строго больше двух
 *     обычных интервалов; без интервала (мало заказов) о паузе не судим.
 *  3. Красный забирает и жёлтые причины — директор видит всё сразу.
 *  4. Фраза причины — на двух языках, с деньгами организации.
 *  5. Список причин совпадает со столбцом daily_plans.no_order_reason;
 *     «Другое» требует текст, текст длиннее 200 — нет.
 *
 * Нарочная поломка: в contracts/shop-light.ts `debt > limit *
 * NEAR_LIMIT_SHARE` → `>=` — падает 2; убрать "other" из NO_ORDER_REASONS —
 * падает 5.
 */
import { describe, it, expect } from "vitest";
import { dailyPlans } from "@db/schema";
import { lightOf, lightReasonText, SHOP_LIGHT_RULES, type ShopLightFacts } from "@contracts/shop-light";
import { NO_ORDER_REASONS, noOrderInputError, noOrderReasonText, NO_ORDER_NOTE_MAX } from "@contracts/no-order-reason";

const facts = (over: Partial<ShopLightFacts> = {}): ShopLightFacts => ({
  debt: 0, overdue: { amount: 0, oldestDays: 0 }, creditLimit: null, daysSinceOrder: 3, usualIntervalDays: 7, ...over,
});

describe("светофор: края правил", () => {
  it("1. красный — просрочка или долг больше лимита; ровно лимит — не красный", () => {
    expect(lightOf(facts({ debt: 800, overdue: { amount: 800, oldestDays: 40 } })))
      .toEqual({ color: "red", reasons: [{ code: "overdue", amount: 800, oldestDays: 40 }] });
    expect(lightOf(facts({ debt: 1001, creditLimit: 1000 })).color).toBe("red");
    expect(lightOf(facts({ debt: 1000, creditLimit: 1000 })).color).toBe("yellow");
    expect(lightOf(facts({ debt: 1, creditLimit: 0 })).reasons).toEqual([{ code: "over_limit", debt: 1, limit: 0 }]);
    expect(lightOf(facts({ debt: 0, creditLimit: 0 })).color).toBe("green");
  });

  it("2. жёлтый — строго больше 70% лимита и строго больше двух интервалов", () => {
    expect(SHOP_LIGHT_RULES.NEAR_LIMIT_SHARE).toBe(0.7);
    expect(lightOf(facts({ debt: 700, creditLimit: 1000 })).color).toBe("green");
    expect(lightOf(facts({ debt: 701, creditLimit: 1000 })).reasons).toEqual([{ code: "near_limit", debt: 701, limit: 1000, pct: 70 }]);
    expect(lightOf(facts({ daysSinceOrder: 14, usualIntervalDays: 7 })).color).toBe("green");
    expect(lightOf(facts({ daysSinceOrder: 15, usualIntervalDays: 7 })).reasons).toEqual([{ code: "long_pause", daysSince: 15, usualDays: 7 }]);
    expect(lightOf(facts({ daysSinceOrder: 400, usualIntervalDays: null })).color, "о ритме судили при малом числе заказов").toBe("green");
    expect(lightOf(facts({ daysSinceOrder: null, usualIntervalDays: null })).color).toBe("green");
  });

  it("3. красный забирает и жёлтые причины", () => {
    const r = lightOf(facts({ debt: 900, creditLimit: 1000, overdue: { amount: 500, oldestDays: 20 }, daysSinceOrder: 30, usualIntervalDays: 7 }));
    expect(r.color).toBe("red");
    expect(r.reasons.map(x => x.code)).toEqual(["overdue", "near_limit", "long_pause"]);
  });

  it("4. причина словами — на двух языках, деньгами организации", () => {
    const sum = (n: number) => `${String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ")} сум`;
    expect(lightReasonText({ code: "overdue", amount: 800000, oldestDays: 40 }, "ru", sum)).toBe("Просрочено 800 000 сум, самый старый — 40 дн.");
    expect(lightReasonText({ code: "overdue", amount: 800000, oldestDays: 40 }, "uz", sum)).toBe("Muddati o'tgan: 800 000 сум, eng eskisi — 40 kun");
    expect(lightReasonText({ code: "long_pause", daysSince: 30, usualDays: 7 }, "ru", sum)).toBe("Не заказывает 30 дн., обычно — раз в 7 дн.");
    expect(lightReasonText({ code: "near_limit", debt: 800, limit: 1000, pct: 80 }, "ru", sum)).toBe("Долг 800 сум — 80% лимита 1 000 сум");
  });
});

describe("причины «без заказа»: контракт", () => {
  it("5. список совпадает со столбцом; «Другое» требует текст; длина — по столбцу", () => {
    expect([...NO_ORDER_REASONS]).toEqual(dailyPlans.noOrderReason.enumValues);
    expect(dailyPlans.noOrderNote.getSQLType()).toBe(`varchar(${NO_ORDER_NOTE_MAX})`);
    expect(noOrderInputError("other", "")).toBe("note_required");
    expect(noOrderInputError("other", "   ")).toBe("note_required");
    expect(noOrderInputError("other", "ремонт")).toBeNull();
    expect(noOrderInputError("closed", undefined)).toBeNull();
    expect(noOrderInputError("closed", "я".repeat(NO_ORDER_NOTE_MAX + 1))).toBe("note_too_long");
    expect(noOrderReasonText("other", " ремонт ", "ru")).toBe("Другое: ремонт");
    expect(noOrderReasonText(null, null, "uz")).toBe("Ko'rsatilmagan");
    expect(noOrderReasonText("competitor", "лишнее", "ru")).toBe("Берёт у конкурента");
  });
});
