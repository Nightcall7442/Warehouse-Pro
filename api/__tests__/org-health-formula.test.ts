/**
 * Формула «здоровья» и правило «уходит» — без базы, на границах.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Оценки не было. Правило «уходит» — новое и явное (api/services/
 * org-health.ts): платящая и (7+ дней тишины, или заказы −50% при прошлых
 * ≥10, или срок ≤7 дней / кончился). Граница сдвинется на день — и в список
 * «позвонить» попадут не те; поэтому проверяются сами границы.
 *
 * ── Что проверяется ─────────────────────────────────────────────────────────
 *
 *   · веса в сумме 100, оценка в 0–100, части не выше своих весов;
 *   · правило 1: 6 дней тишины — нет, 7 — да;
 *   · правило 2: 9 прошлых и 0 текущих — шум, не обвал; 10 → 5 — обвал;
 *     10 → 6 — нет;
 *   · правило 3: 8 дней до конца — нет, 7 — да; кончился — да; past_due — да;
 *   · пробная не «уходит» ни при каких фактах;
 *   · «здорова» — с 70; причины плохие сверху; дни склоняются.
 *
 * Нарочная поломка: CHURN_SILENT_DAYS = 8 — падает «правило 1»;
 * CHURN_MIN_PREV убрать — падает «шум»; `daysLeft < 7` — падает «правило 3».
 */
import { describe, it, expect } from "vitest";
import { CHURN_MIN_PREV, HEALTH_WEIGHTS, HEALTHY_FROM, plural, scoreOrgHealth, type HealthFacts } from "../services/org-health";

const DAY = 86_400_000;
const NOW = new Date("2026-10-15T09:00:00Z");
const ago = (d: number) => new Date(NOW.getTime() - d * DAY);
const ahead = (d: number) => new Date(NOW.getTime() + d * DAY);

const facts = (f: Partial<HealthFacts> = {}): HealthFacts => ({
  plan: "pro", subStatus: "active", subPeriodEnds: ahead(30), trialEnds: null, createdAt: ago(200),
  lastOrderAt: ago(0.1), lastLoginAt: ago(0.1), orders30: 20, ordersPrev30: 20, users: 4, activeUsers: 4,
  areas: { products: true, shops: true, agentOrders: true, deliveries: true, gps: true },
  ...f,
});
const score = (f: Partial<HealthFacts>) => scoreOrgHealth(facts(f), NOW);

describe("оценка", () => {
  it("веса в сумме 100; всё в ходу — 100; части не выше весов", () => {
    expect(Object.values(HEALTH_WEIGHTS).reduce((a, b) => a + b, 0)).toBe(100);
    const h = score({});
    expect(h.score).toBe(100);
    expect(h.level).toBe("healthy");
    for (const [k, w] of Object.entries(HEALTH_WEIGHTS)) expect(h.parts[k as keyof typeof HEALTH_WEIGHTS]).toBeLessThanOrEqual(w);
    const worst = score({ lastOrderAt: null, lastLoginAt: null, orders30: 0, ordersPrev30: 0, subStatus: "past_due", activeUsers: 0,
      areas: { products: false, shops: false, agentOrders: false, deliveries: false, gps: false } });
    expect(worst.score).toBe(0);
  });

  it("«здорова» с 70: 69 — под наблюдением", () => {
    expect(HEALTHY_FROM).toBe(70);
    // 30 + 25 + 14 (срок 10 дней) + 0 (широта) + 0 = 69
    const h = score({ subPeriodEnds: ahead(10), activeUsers: 0, areas: { products: false, shops: false, agentOrders: false, deliveries: false, gps: false } });
    expect(h.score).toBe(69);
    expect(h.level).toBe("watch");
  });

  it("причины: плохие сверху, дни склоняются", () => {
    const h = score({ lastOrderAt: ago(21.5), lastLoginAt: ago(21.5), orders30: 3, ordersPrev30: 4 });
    expect(h.reasons[0]).toEqual({ tone: "bad", text: "21 день без заказов и входов" });
    expect(h.reasons.at(-1)!.tone).toBe("good");
    expect([plural(1, ["день", "дня", "дней"]), plural(3, ["день", "дня", "дней"]), plural(11, ["день", "дня", "дней"]), plural(22, ["день", "дня", "дней"])])
      .toEqual(["1 день", "3 дня", "11 дней", "22 дня"]);
  });
});

describe("правило «уходит»", () => {
  it("правило 1: 6 дней тишины — нет, 7 — да", () => {
    expect(score({ lastOrderAt: ago(6.5), lastLoginAt: ago(6.5) }).churn).toBe(false);
    const h = score({ lastOrderAt: ago(7.2), lastLoginAt: ago(7.2) });
    expect(h.churn).toBe(true);
    expect(h.churnBecause).toEqual(["7 дней без заказов и входов"]);
  });

  it("правило 2: 9 → 0 — шум; 10 → 5 — обвал; 10 → 6 — нет", () => {
    expect(CHURN_MIN_PREV).toBe(10);
    expect(score({ ordersPrev30: 9, orders30: 0 }).churn).toBe(false);
    const drop = score({ ordersPrev30: 10, orders30: 5 });
    expect(drop.churnBecause).toEqual(["заказы упали на 50% к прошлому месяцу"]);
    expect(score({ ordersPrev30: 10, orders30: 6 }).churn).toBe(false);
  });

  it("правило 3: 8 дней — нет, 7 — да; кончился и не оплачена — да", () => {
    expect(score({ subPeriodEnds: ahead(7.5) }).churn).toBe(false);
    expect(score({ subPeriodEnds: ahead(6.9) }).churnBecause).toEqual(["срок истекает через 7 дней, продления нет"]);
    expect(score({ subPeriodEnds: ago(2) }).churnBecause).toEqual(["оплаченный срок кончился, продления нет"]);
    expect(score({ subStatus: "past_due" }).churn).toBe(true);
    expect(score({ subPeriodEnds: null }).churn).toBe(false);
  });

  it("пробная не «уходит» ни при каких фактах", () => {
    const h = score({ plan: "trial", subStatus: "trialing", trialEnds: ago(3), subPeriodEnds: null,
      lastOrderAt: null, lastLoginAt: ago(30), orders30: 0, ordersPrev30: 50 });
    expect(h.churn).toBe(false);
    expect(h.level).toBe("watch");
    expect(h.reasons.map(r => r.text)).toContain("пробный истёк, оплаты нет");
  });
});
