/**
 * «Сроки»: продастся ли партия до срока — чистые правила контракта.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Экран сроков показывал дату и сумму, но не отвечал, уйдёт ли партия сама.
 * Правило теперь одно — contracts/expiry.ts — и его края должны быть ровно
 * там, где написано в шапке: темп без отрицательных значений, FEFO по сроку,
 * день срока не продаётся, ступени скидки «до 7 включительно», «ниже
 * закупки» строго меньше.
 *
 * ── Что проверяется ─────────────────────────────────────────────────────────
 *
 *  1. Темп: (продано − возвращено) / окно; возвратов больше — ноль.
 *  2. FEFO: партия получает только спрос, оставшийся после партий впереди;
 *     вход в любом порядке; при равном сроке — порядок входа.
 *  3. Партия впереди, не успевшая продаться, перестаёт забирать спрос в свой
 *     срок — следующей достаётся остальное; «кончится через N дней» честное.
 *  4. Вердикты: просрочено, не на основном, нет продаж, срок сегодня.
 *  5. Товары не делят темп друг друга.
 *  6. Скидка по лестнице: края 7/8, 14/15; цена до копеек.
 *  7. Деньги скидки: «ниже закупки» строго; без закупки не судим.
 *  8. Свод: группы, скрытая закупка — null, уценённые — только среди «не успеют».
 *  9. Фразы — на двух языках, с числами.
 *
 * Нарочная поломка: в forecastBatches убрать `- ahead` — падает 2 и 3;
 * `daysLeft <= step.upToDays` → `<` — падает 6; `price < cost` → `<=` —
 * падает 7; в salesPace убрать `net > 0 ?` — падает 1.
 */
import { describe, it, expect } from "vitest";
import {
  EXPIRY_RULES, daysBetween, salesPace, forecastBatches, discountPctFor, discountedPrice, discountMoney,
  summarizeExpiry, expiryReasonText, needsAction, type BatchFacts,
} from "@contracts/expiry";

const TODAY = "2099-03-10";
const batch = (over: Partial<BatchFacts> & Pick<BatchFacts, "batchId" | "expiresAt" | "quantity">): BatchFacts =>
  ({ productId: 1, onDefault: true, ...over });
const at = (pace: number) => () => pace;

describe("сроки: правила", () => {
  it("0. дни — по календарю, через месяц и год", () => {
    expect(daysBetween("2099-02-27", "2099-03-01")).toBe(2);
    expect(daysBetween("2098-12-31", "2099-01-01")).toBe(1);
    expect(daysBetween(TODAY, TODAY)).toBe(0);
    expect(daysBetween(TODAY, "2099-03-07")).toBe(-3);
  });

  it("1. темп — продано минус возвращено за окно; возвратов больше — ноль, не минус", () => {
    expect(EXPIRY_RULES.PACE_WINDOW_DAYS).toBe(28);
    expect(salesPace(280, 0)).toBe(10);
    expect(salesPace(280, 28)).toBe(9);
    expect(salesPace(5, 9)).toBe(0);
    expect(salesPace(10, 10)).toBe(0);
    expect(salesPace(14, 0, 7)).toBe(2);
    expect(salesPace(14, 0, 0)).toBe(0);
  });

  it("2. FEFO: вторая партия получает только остаток спроса; порядок входа не важен", () => {
    // 10 в день. A: 30 шт., 5 дней — уйдёт за 3 дня. B: 100 шт., 8 дней — спроса 80, из них 30 ушли на A.
    const a = batch({ batchId: 1, expiresAt: "2099-03-15", quantity: 30 });
    const b = batch({ batchId: 2, expiresAt: "2099-03-18", quantity: 100 });
    for (const input of [[a, b], [b, a]]) {
      const f = forecastBatches(input, at(10), TODAY);
      expect(f.get(1)).toEqual({ batchId: 1, daysLeft: 5, sold: 30, unsold: 0, sellOutDays: 3, verdict: "sells" });
      expect(f.get(2)).toEqual({ batchId: 2, daysLeft: 8, sold: 50, unsold: 50, sellOutDays: null, verdict: "short" });
    }
    // Равный срок — порядок входа (так их отдаёт сервер: срок, приход, id).
    const c1 = batch({ batchId: 3, expiresAt: "2099-03-14", quantity: 30 });
    const c2 = batch({ batchId: 4, expiresAt: "2099-03-14", quantity: 30 });
    const f = forecastBatches([c1, c2], at(10), TODAY);
    expect(f.get(3)?.sold).toBe(30);
    expect(f.get(4)).toMatchObject({ sold: 10, unsold: 20, verdict: "short" });
  });

  it("3. партия впереди сгорает с остатком — спрос после её срока уходит следующей", () => {
    // A: 100 шт., 3 дня — продастся 30, 70 сгорят. B: 50 шт., 10 дней: с 3-го дня весь спрос её — кончится на 8-й.
    const f = forecastBatches([
      batch({ batchId: 1, expiresAt: "2099-03-13", quantity: 100 }),
      batch({ batchId: 2, expiresAt: "2099-03-20", quantity: 50 }),
    ], at(10), TODAY);
    expect(f.get(1)).toMatchObject({ sold: 30, unsold: 70, verdict: "short" });
    expect(f.get(2)).toMatchObject({ sold: 50, unsold: 0, sellOutDays: 8, verdict: "sells" });
  });

  it("4. просрочено, не на основном складе, нет продаж, срок сегодня", () => {
    const f = forecastBatches([
      batch({ batchId: 1, expiresAt: "2099-03-09", quantity: 12 }),
      batch({ batchId: 2, expiresAt: "2099-03-20", quantity: 8, onDefault: false }),
      batch({ batchId: 3, productId: 2, expiresAt: "2099-03-20", quantity: 5 }),
      batch({ batchId: 4, productId: 3, expiresAt: TODAY, quantity: 6 }),
    ], id => (id === 1 ? 50 : id === 3 ? 4 : 0), TODAY);
    expect(f.get(1)).toEqual({ batchId: 1, daysLeft: -1, sold: 0, unsold: 12, sellOutDays: null, verdict: "expired" });
    // Темп у товара есть, но с этого склада не продают — и спрос основного он не съедает.
    expect(f.get(2)).toMatchObject({ sold: 0, unsold: 8, verdict: "elsewhere" });
    expect(f.get(3)).toMatchObject({ sold: 0, unsold: 5, verdict: "no_sales" });
    // День срока не продаётся: магазин «годен до сегодня» не примет.
    expect(f.get(4)).toMatchObject({ daysLeft: 0, sold: 0, unsold: 6, verdict: "short" });
    expect(["short", "no_sales", "elsewhere"].every(v => needsAction(v as never))).toBe(true);
    expect(needsAction("sells") || needsAction("expired")).toBe(false);
  });

  it("5. товары не делят темп и очередь друг друга", () => {
    const f = forecastBatches([
      batch({ batchId: 1, productId: 1, expiresAt: "2099-03-15", quantity: 50 }),
      batch({ batchId: 2, productId: 2, expiresAt: "2099-03-15", quantity: 50 }),
    ], id => (id === 1 ? 10 : 2), TODAY);
    expect(f.get(1)).toMatchObject({ sold: 50, verdict: "sells", sellOutDays: 5 });
    expect(f.get(2)).toMatchObject({ sold: 10, unsold: 40, verdict: "short" });
  });

  it("6. скидка по дням до срока: до 7 — 30 %, до 14 — 20 %, дальше — 10 %; цена до копеек", () => {
    expect([0, 7, 8, 14, 15, 90].map(discountPctFor)).toEqual([30, 30, 20, 20, 10, 10]);
    expect(discountedPrice(9500, 20)).toBe(7600);
    expect(discountedPrice(333.33, 10)).toBe(300);
    expect(discountedPrice(12345, 30)).toBe(8641.5);
  });

  it("7. деньги скидки: ниже закупки — строго; без закупки не судим; что вернётся и что сгорит", () => {
    expect(discountMoney(70, 80, 12)).toEqual({ unitMargin: -10, belowCost: true, costKnown: true, recovered: 840, writeOff: 960 });
    expect(discountMoney(80, 80, 12)).toMatchObject({ unitMargin: 0, belowCost: false });
    expect(discountMoney(70, 0, 12)).toMatchObject({ belowCost: false, costKnown: false, writeOff: 0, recovered: 840 });
  });

  it("8. свод: три группы; закупка скрыта — null; уценённые считаются только среди «не успеют»", () => {
    const row = (verdict: never, cost: number | null, sale: number, markdown: object | null = null) => ({ verdict, atRiskCost: cost, atRiskSale: sale, markdown });
    expect(summarizeExpiry([
      row("short" as never, 100, 150, {}), row("no_sales" as never, 50, 70), row("elsewhere" as never, 10, 12),
      row("expired" as never, 40, 60), row("sells" as never, 0, 0, {}),
    ])).toEqual({ riskCount: 3, riskCost: 160, riskSale: 232, expiredCount: 1, expiredCost: 40, expiredSale: 60, sellsCount: 1, markedDown: 1 });
    expect(summarizeExpiry([row("short" as never, null, 150)])).toMatchObject({ riskCost: null, expiredCost: null, riskSale: 150 });
    expect(summarizeExpiry([])).toEqual({ riskCount: 0, riskCost: 0, riskSale: 0, expiredCount: 0, expiredCost: 0, expiredSale: 0, sellsCount: 0, markedDown: 0 });
  });

  it("9. причина словами — ru и uz, с числами", () => {
    const q = (n: number) => `${n} шт`;
    const base = { daysLeft: 8, quantity: 100, sold: 50, unsold: 50, pacePerDay: 6.25, sellOutDays: null, warehouseName: "Второй" };
    expect(expiryReasonText({ ...base, verdict: "short" }, "ru", q)).toBe("Уходит 6,3 в день: до срока продастся ~50 шт из 100 шт, останется 50 шт");
    expect(expiryReasonText({ ...base, verdict: "short" }, "uz", q)).toBe("Kuniga 6.3 sotilmoqda: muddatgacha 100 шт dan ~50 шт ketadi, 50 шт qoladi");
    expect(expiryReasonText({ ...base, verdict: "short", daysLeft: 0 }, "ru", q)).toBe("Срок сегодня — продать сегодня или списать");
    expect(expiryReasonText({ ...base, verdict: "expired", daysLeft: -3 }, "ru", q)).toContain("3 дн. назад");
    expect(expiryReasonText({ ...base, verdict: "elsewhere" }, "ru", q)).toContain("«Второй»");
    expect(expiryReasonText({ ...base, verdict: "no_sales" }, "ru", q)).toBe("За 28 дней ни одной продажи — сама не уйдёт");
    expect(expiryReasonText({ ...base, verdict: "sells", sellOutDays: 4 }, "ru", q)).toBe("Успеет: уйдёт за ~4 дн., до срока 8 дн.");
    expect(expiryReasonText({ ...base, verdict: "sells", sellOutDays: 4 }, "uz", q)).toBe("Ulguradi: ~4 kunda tugaydi, muddatgacha 8 kun");
  });
});
