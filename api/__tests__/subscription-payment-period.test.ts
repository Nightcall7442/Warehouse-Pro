/**
 * Период оплаты, доля месяца и строка журнала — правила из contracts, общие
 * для сервера и формы «Записать оплату».
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Оплат не было; продление считалось днями («+30») от конца оплаченного в
 * одном месте (tenant.updatePlan). Форма и сервер, посчитав период каждый
 * по-своему, разошлись бы на день — на экране «до 15.01», в подписке 14.01.
 *
 * ── Что проверяется ─────────────────────────────────────────────────────────
 *
 *   · с какого момента: active и срок впереди — от конца; истёк, пробный,
 *     нет подписки — от сейчас (то же правило теперь у updatePlan);
 *   · календарные месяцы с прижатием: 31.01 + 1 = 28.02 (29.02 в високосный),
 *     31.01 + 3 = 30.04; время суток сохраняется; день — по Ташкенту
 *     (23:30 UTC — уже следующий день);
 *   · доля месяца по дням периода: две соседние оплаты дают месяцу ровно
 *     одну месячную сумму; период вне месяца — ноль;
 *   · строка журнала: «было → стало» только по изменившимся полям, у оплаты —
 *     сумма, способ и период.
 *
 * Нарочная поломка: в addMonths убрать Math.min(day, lastDay) — падает
 * «прижатие»; в monthShare брать месяц целиком при пересечении — падает
 * «соседние оплаты»; tashkentDay без +5 часов — падает «по Ташкенту».
 */
import { describe, it, expect } from "vitest";
import { addMonths, monthShare, paidUntilBase, paymentPeriod, tashkentDay, tashkentMonth } from "@contracts/subscription-payment";
import { describePlatformEntry } from "@contracts/platform-journal";

const NOW = new Date("2026-10-15T09:00:00Z");

describe("с какого момента продлевать", () => {
  it("active и впереди — от конца; истёк, пробный, нет подписки — от сейчас", () => {
    const ends = new Date("2026-10-25T10:00:00Z");
    expect(paidUntilBase({ status: "active", currentPeriodEnds: ends }, NOW)).toEqual(ends);
    expect(paidUntilBase({ status: "active", currentPeriodEnds: "2026-10-25T10:00:00.000Z" }, NOW).toISOString()).toBe(ends.toISOString());
    expect(paidUntilBase({ status: "active", currentPeriodEnds: new Date("2026-10-01T00:00:00Z") }, NOW)).toBe(NOW);
    expect(paidUntilBase({ status: "trialing", currentPeriodEnds: ends }, NOW)).toBe(NOW);
    expect(paidUntilBase(null, NOW)).toBe(NOW);
  });
});

describe("календарные месяцы", () => {
  it("прижатие к концу месяца, время сохраняется", () => {
    const jan31 = new Date("2030-01-31T10:00:00Z"); // 15:00 по Ташкенту
    expect(addMonths(jan31, 1).toISOString()).toBe("2030-02-28T10:00:00.000Z");
    expect(addMonths(jan31, 3).toISOString()).toBe("2030-04-30T10:00:00.000Z");
    expect(addMonths(new Date("2028-01-31T10:00:00Z"), 1).toISOString()).toBe("2028-02-29T10:00:00.000Z");
    expect(addMonths(new Date("2026-10-15T09:00:00Z"), 12).toISOString()).toBe("2027-10-15T09:00:00.000Z");
  });

  it("день — по Ташкенту: 23:30 UTC — уже следующий день", () => {
    expect(tashkentDay(new Date("2026-10-14T23:30:00Z"))).toBe("2026-10-15");
    expect(tashkentDay(new Date("2026-10-14T18:59:00Z"))).toBe("2026-10-14");
    // Ташкентская полночь — месяц по Ташкенту.
    expect(tashkentMonth(new Date("2026-09-30T19:30:00Z"))).toEqual({ first: "2026-10-01", last: "2026-10-31", days: 31 });
    const p = paymentPeriod({ status: "active", currentPeriodEnds: new Date("2030-01-31T10:00:00Z") }, 3, NOW);
    expect([p.fromDay, p.toDay]).toEqual(["2030-01-31", "2030-04-30"]);
  });
});

describe("доля месяца", () => {
  const oct = { first: "2026-10-01", last: "2026-10-31" };
  it("соседние оплаты дают октябрю одну месячную сумму, а не две", () => {
    const a = monthShare({ amount: 1_000_000, periodFrom: "2026-09-15", periodTo: "2026-10-15" }, oct);
    const b = monthShare({ amount: 1_000_000, periodFrom: "2026-10-15", periodTo: "2026-11-15" }, oct);
    expect(a).toBeCloseTo(1_000_000 * 14 / 30, 6);
    expect(b).toBeCloseTo(1_000_000 * 17 / 31, 6);
    expect(Math.round(a + b)).toBeGreaterThan(990_000);
    expect(Math.round(a + b)).toBeLessThan(1_020_000);
  });
  it("вне месяца — ноль; годовая — доля по дням", () => {
    expect(monthShare({ amount: 1_000_000, periodFrom: "2026-08-01", periodTo: "2026-09-01" }, oct)).toBe(0);
    expect(monthShare({ amount: 1_000_000, periodFrom: "2026-11-01", periodTo: "2026-12-01" }, oct)).toBe(0);
    expect(monthShare({ amount: 12_000_000, periodFrom: "2026-10-01", periodTo: "2027-10-01" }, oct)).toBeCloseTo(12_000_000 * 31 / 365, 6);
  });
});

describe("строка журнала", () => {
  it("было → стало только по изменившимся; у оплаты — сумма, способ, период", () => {
    expect(describePlatformEntry({ action: "tenant.plan", before: { plan: "basic", periodEnds: "2026-10-20T10:00:00Z" }, after: { plan: "pro", periodEnds: "2026-11-19T10:00:00Z" } }))
      .toBe("Тариф: Базовый → Про · Оплачено до: 20.10.2026 → 19.11.2026");
    expect(describePlatformEntry({ action: "tenant.status", before: { status: "active" }, after: { status: "suspended" } }))
      .toBe("Статус: работает → приостановлена");
    expect(describePlatformEntry({
      action: "payment.recorded", before: { plan: "pro", periodEnds: "2026-10-20T10:00:00Z" }, after: { plan: "pro", periodEnds: "2027-01-20T10:00:00Z" },
      meta: { amount: 1_797_000, method: "payme", periodFrom: "2026-10-20", periodTo: "2027-01-20" },
    })).toBe("1 797 000 сум · Payme · период 20.10.2026–20.01.2027 · Оплачено до: 20.10.2026 → 20.01.2027");
    expect(describePlatformEntry({ action: "announcement.created", meta: { audience: "plans", plans: ["pro", "exclusive"], level: "warning", startsAt: "2026-10-05T05:00:00Z", endsAt: "2026-10-12T05:00:00Z" } }))
      .toBe("тарифы: Про, Эксклюзив · внимание · с 05.10.2026 до 12.10.2026");
    expect(describePlatformEntry({ action: "announcement.created", meta: { audience: "tenants", tenantIds: [3, 7], level: "info", startsAt: "2026-10-05T05:00:00Z", endsAt: null } }))
      .toBe("организаций: 2 · с 05.10.2026, без срока");
    expect(describePlatformEntry({ action: "tenant.offboarded", before: { status: "suspended" }, meta: { total: 1843 } }))
      .toBe("стёрто строк: 1843");
  });
});
