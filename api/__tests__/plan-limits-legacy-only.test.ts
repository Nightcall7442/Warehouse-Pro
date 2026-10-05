import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PLANS, type PlanKey } from "@contracts/constants";
import { LEGACY_EXTRA_PRICES_UZS, LEGACY_PLANS, LEGACY_PRICES_UZS } from "@contracts/pricing";

/**
 * Пределы — только у прежних тарифов и только до GRANDFATHER_UNTIL.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Решение 10.09.2026: безлимита нет ни у кого — у Exclusive 50 мест и 250
 * позиций, у пробного 3 / 20 / 50 заказов. Надбавка за место и позицию
 * закрывала нехватку в несколько единиц.
 *
 * ── Что стало (05.10.2026) ──────────────────────────────────────────────────
 *
 * Цена — за полевых сотрудников, и пределов нет ни по чему: ни у «Стандарта»,
 * ни у пробного. Прежние Basic / Pro / Exclusive живут со своими пределами и
 * надбавками ещё год — до этого дня у них не меняется ничего, — а дальше
 * effectivePlan превращает их в «Стандарт» (contracts/pricing.ts).
 */
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("пределы тарифов", () => {
  it("у «Стандарта» и пробного пределов нет ни по местам, ни по товарам, ни по заказам", () => {
    for (const key of ["standard", "trial"] as PlanKey[]) {
      expect(PLANS[key].maxUsers, `${key}: появился предел мест`).toBeNull();
      expect(PLANS[key].maxProducts, `${key}: появился предел товаров`).toBeNull();
      expect(PLANS[key].maxOrdersMonth, `${key}: появился предел заказов`).toBeNull();
    }
  });

  it("прежние тарифы держат свои места и позиции — до этого дня не меняется ничего", () => {
    for (const key of LEGACY_PLANS) {
      expect(PLANS[key].maxUsers, `${key}: места без предела`).not.toBeNull();
      expect(PLANS[key].maxProducts, `${key}: позиции без предела`).not.toBeNull();
      expect(PLANS[key].maxOrdersMonth, `${key}: у заказов появился предел`).toBeNull();
    }
    expect([PLANS.basic.maxUsers, PLANS.pro.maxUsers, PLANS.exclusive.maxUsers]).toEqual([5, 20, 50]);
    expect([PLANS.basic.maxProducts, PLANS.pro.maxProducts, PLANS.exclusive.maxProducts]).toEqual([50, 100, 250]);
  });

  it("проверка пределов берёт тариф на сегодня, а не из базы как есть", () => {
    /*
      Иначе в базе «pro» и после 05.10.2027 — и организация упиралась бы в
      20 мест, уже платя за полевых по новой цене.
    */
    const limits = read("api/lib/plan-limits.ts");
    expect(limits).toContain("PLANS[effectivePlan(tenant.plan, new Date())]");
    expect(limits).toContain("PLANS[effectivePlan(plan, new Date())]?.maxOrdersMonth");
  });

  it("лестница прежних не сломана: старший даёт больше, переход и надбавка согласованы", () => {
    const step = (from: (typeof LEGACY_PLANS)[number], to: (typeof LEGACY_PLANS)[number]) => {
      const money = LEGACY_PRICES_UZS[to] - LEGACY_PRICES_UZS[from];
      return {
        perUser:    money / (Number(PLANS[to].maxUsers) - Number(PLANS[from].maxUsers)),
        perProduct: money / (Number(PLANS[to].maxProducts) - Number(PLANS[from].maxProducts)),
      };
    };
    const toPro = step("basic", "pro");
    const toExclusive = step("pro", "exclusive");
    expect(toPro.perUser).toBeLessThan(LEGACY_EXTRA_PRICES_UZS.user);
    expect(toExclusive.perUser).toBeLessThan(LEGACY_EXTRA_PRICES_UZS.user);
    expect(toPro.perProduct).toBeGreaterThan(LEGACY_EXTRA_PRICES_UZS.product);
    expect(toExclusive.perProduct).toBeLessThan(LEGACY_EXTRA_PRICES_UZS.product);
  });
});
