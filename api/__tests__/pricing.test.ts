import { describe, it, expect } from "vitest";
import { users } from "@db/schema";
import { PLANS, PRODUCT_FEATURES, SERVICE_FEATURES, planFeatures, planHas, planHasProTools, plansWithProTools, type PlanKey } from "@contracts/constants";
import {
  ANNUAL_DISCOUNT, FIELD_PRICE_UZS, FIELD_ROLES, GRANDFATHER_UNTIL, LEGACY_PLANS, LEGACY_PRICES_UZS, MIN_FIELD_USERS,
  amountForPeriod, annualPrice, annualSaving, billedFieldUsers, countFieldUsers, effectivePlan, isFieldRole,
  isGrandfathered, monthlyPrice, periodBreakdown, planSellable, priceForTenant,
} from "@contracts/pricing";

/**
 * Цена за полевого сотрудника — решение владельца 05.10.2026 (вариант «A»).
 *
 * Числа в ожиданиях ниже набраны руками нарочно: это не копия модуля, а то,
 * что владелец назвал словами («5 агентов + 2 курьера = 7 → 833 000»). Тест
 * падает, если модуль начнёт считать иначе, чем было обещано.
 */

// Ташкент — UTC+5: полночь 05.10.2027 по Ташкенту — 04.10.2027 19:00 UTC.
const LAST_OLD_MINUTE = new Date("2027-10-04T18:59:59Z");
const FIRST_NEW_MINUTE = new Date("2027-10-04T19:00:00Z");
const TODAY = new Date("2026-10-05T09:00:00Z");

describe("кто платит", () => {
  it("полевые — агент, курьер, мерчендайзер; остальные роли бесплатны", () => {
    expect([...FIELD_ROLES].sort()).toEqual(["agent", "courier", "merchandiser"]);
    // Каждая роль из базы разобрана явно: новая роль не проскочит ни в платные, ни в бесплатные молча.
    const office = ["superadmin", "ceo", "operator", "supervisor"];
    for (const role of users.role.enumValues) {
      expect(isFieldRole(role) || office.includes(role), `роль ${role} не разобрана`).toBe(true);
    }
    for (const role of office) expect(isFieldRole(role), `${role} платный`).toBe(false);
  });

  it("отключённый сотрудник не считается", () => {
    expect(countFieldUsers([
      { role: "agent", status: "active" },
      { role: "courier", status: "active" },
      { role: "merchandiser", status: "inactive" },
      { role: "supervisor", status: "active" },
      { role: "ceo", status: "active" },
      { role: "operator", status: "active" },
    ])).toBe(2);
  });
});

describe("сколько стоит", () => {
  it("119 000 за человека, минимум трое", () => {
    expect(FIELD_PRICE_UZS).toBe(119_000);
    expect(MIN_FIELD_USERS).toBe(3);
    expect(monthlyPrice(0)).toBe(357_000);
    expect(monthlyPrice(1)).toBe(357_000);
    expect(monthlyPrice(3)).toBe(357_000);
    expect(monthlyPrice(4)).toBe(476_000);
    expect(billedFieldUsers(-5)).toBe(3);
    expect(billedFieldUsers(2.7)).toBe(3);
  });

  it("примеры владельца: 7 → 833 000, 26 → 3 094 000, 65 → 7 735 000", () => {
    expect(monthlyPrice(5 + 2)).toBe(833_000);
    expect(monthlyPrice(20 + 6)).toBe(3_094_000);
    expect(monthlyPrice(50 + 15)).toBe(7_735_000);
  });

  it("год — 12 месяцев минус 15 %, целыми сумами", () => {
    expect(ANNUAL_DISCOUNT).toBe(0.15);
    expect(annualPrice(7)).toBe(8_496_600);
    expect(annualSaving(7)).toBe(833_000 * 12 - 8_496_600);
    for (let n = 0; n <= 500; n++) {
      const a = annualPrice(n);
      expect(Number.isInteger(a)).toBe(true);
      expect(a).toBe(Math.round(monthlyPrice(n) * 12 * 0.85));
    }
  });

  it("пробный бесплатен, но говорит, во что обойдётся", () => {
    const p = priceForTenant("trial", 7, TODAY);
    expect(p.model).toBe("trial");
    expect(p.monthly).toBe(0);
    expect(p.nextMonthly).toBe(833_000);
  });

  it("«Стандарт» — за полевых", () => {
    const p = priceForTenant("standard", 26, TODAY);
    expect(p).toMatchObject({ plan: "standard", model: "perField", monthly: 3_094_000, annual: annualPrice(26), grandfatheredUntil: null });
  });
});

describe("прежние тарифы — год по прежней цене", () => {
  it("дата одна и это 05.10.2027", () => {
    expect(GRANDFATHER_UNTIL).toBe("2027-10-05");
    expect([...LEGACY_PLANS]).toEqual(["basic", "pro", "exclusive"]);
    expect(LEGACY_PRICES_UZS).toEqual({ basic: 299_000, pro: 599_000, exclusive: 1_299_000 });
  });

  it("до даты — прежняя цена и сразу сумма, что будет потом", () => {
    for (const plan of LEGACY_PLANS) {
      const p = priceForTenant(plan, 7, LAST_OLD_MINUTE);
      expect(p, plan).toMatchObject({ plan, model: "legacy", monthly: LEGACY_PRICES_UZS[plan], grandfatheredUntil: GRANDFATHER_UNTIL, nextMonthly: 833_000 });
      expect(isGrandfathered(plan, LAST_OLD_MINUTE)).toBe(true);
    }
  });

  it("с 05.10.2027 по Ташкенту — «Стандарт», без правки базы", () => {
    for (const plan of LEGACY_PLANS) {
      expect(isGrandfathered(plan, FIRST_NEW_MINUTE), plan).toBe(false);
      expect(effectivePlan(plan, FIRST_NEW_MINUTE)).toBe("standard");
      expect(priceForTenant(plan, 7, FIRST_NEW_MINUTE)).toMatchObject({ plan: "standard", model: "perField", monthly: 833_000 });
    }
    expect(effectivePlan("trial", FIRST_NEW_MINUTE)).toBe("trial");
    expect(effectivePlan("standard", TODAY)).toBe("standard");
  });

  it("прежний тариф только продлевают — свой и до даты", () => {
    expect(planSellable("trial", "standard", TODAY)).toBe(true);
    expect(planSellable("pro", "standard", TODAY)).toBe(true);
    expect(planSellable("pro", "pro", TODAY)).toBe(true);
    expect(planSellable("pro", "exclusive", TODAY)).toBe(false);
    expect(planSellable("trial", "basic", TODAY)).toBe(false);
    expect(planSellable("pro", "pro", FIRST_NEW_MINUTE)).toBe(false);
  });
});

describe("сумма за период оплаты", () => {
  it("«Стандарт»: месяц, год со скидкой, год и месяц", () => {
    expect(amountForPeriod("standard", 7, 1, TODAY)).toBe(833_000);
    expect(amountForPeriod("standard", 7, 3, TODAY)).toBe(833_000 * 3);
    expect(amountForPeriod("standard", 7, 12, TODAY)).toBe(8_496_600);
    expect(amountForPeriod("standard", 7, 13, TODAY)).toBe(8_496_600 + 833_000);
    expect(amountForPeriod("trial", 7, 12, TODAY)).toBe(0);
  });

  it("прежний тариф, целиком до даты, — по прежней цене и без скидки за год", () => {
    expect(amountForPeriod("pro", 7, 12, TODAY)).toBe(599_000 * 12);
  });

  it("период через дату делится: до — по прежней, после — за полевых", () => {
    // С 05.06.2027 на 12 месяцев: июнь, июль, август, сентябрь начинаются до даты.
    const from = new Date("2027-06-05T07:00:00Z");
    const split = periodBreakdown("pro", 7, 12, from);
    expect(split).toEqual({ legacyMonths: 4, perFieldMonths: 8, years: 0, amount: 4 * 599_000 + 8 * 833_000 });
  });
});

describe("пределы и функции", () => {
  it("у «Стандарта» и пробного пределов нет ни по чему", () => {
    for (const key of ["standard", "trial"] as PlanKey[]) {
      expect(PLANS[key], key).toMatchObject({ maxUsers: null, maxProducts: null, maxOrdersMonth: null });
    }
    expect(PLANS.trial.durationDays).toBe(14);
  });

  it("у «Стандарта» и пробного — все функции, но не услуги", () => {
    for (const key of ["standard", "trial"] as PlanKey[]) {
      expect(planFeatures(key).sort(), key).toEqual([...PRODUCT_FEATURES].sort());
      for (const s of SERVICE_FEATURES) expect(planFeatures(key), `${key}: услуга ${s}`).not.toContain(s);
    }
    expect(planHas("standard", "api", TODAY)).toBe(true);
    expect(planHas("standard", "supportChat", TODAY)).toBe(true);
  });

  it("прежние до даты — ровно что было, после — всё", () => {
    expect(planHas("basic", "api", LAST_OLD_MINUTE)).toBe(false);
    expect(planHas("pro", "supportChat", LAST_OLD_MINUTE)).toBe(false);
    expect(planHas("exclusive", "api", LAST_OLD_MINUTE)).toBe(true);
    expect(planHas("basic", "api", FIRST_NEW_MINUTE)).toBe(true);
    expect(planHas("pro", "supportChat", FIRST_NEW_MINUTE)).toBe(true);
  });

  it("Контроль и бот: у всех, кроме прежнего Basic до даты", () => {
    expect(planHasProTools("standard", TODAY)).toBe(true);
    expect(planHasProTools("trial", TODAY)).toBe(true);
    expect(planHasProTools("pro", TODAY)).toBe(true);
    expect(planHasProTools("basic", LAST_OLD_MINUTE)).toBe(false);
    expect(planHasProTools("basic", FIRST_NEW_MINUTE)).toBe(true);
    expect(plansWithProTools(TODAY).sort()).toEqual(["exclusive", "pro", "standard", "trial"]);
    expect(plansWithProTools(FIRST_NEW_MINUTE)).toContain("basic");
  });
});
