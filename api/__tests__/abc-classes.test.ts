/**
 * ABC-классы и тревога маржи — правила contracts/margin.ts.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * ABC-анализа и маржи по строкам не было вовсе: директор видел валовую
 * прибыль одним числом в P&L и не видел, кто её съедает. Правила здесь новые,
 * и ломаются они молча — на границе класса и на «ровно пяти процентах».
 *
 * ── Что проверяется ─────────────────────────────────────────────────────────
 *
 *  1. Граница 80%: позиция, на которой накопленная доля ДОСТИГАЕТ 80%, — ещё
 *     A, следующая — B; то же на 95% между B и C. Крупнейшая позиция не
 *     становится B только потому, что одна даёт 85%.
 *  2. Ноль и минус — всегда C и не раздувают доли соседей.
 *  3. Равные суммы — порядок по названию: класс не прыгает между обновлениями.
 *  4. Тревога: убыток — при любом объёме; «низкая» — только при заметной доле
 *     выручки; ровно 5% маржи — не низкая (сравнение целыми, без дробей).
 *
 * ── Нарочные поломки ────────────────────────────────────────────────────────
 *
 *  • класс по доле С позицией (`cum * 100 <= …` вместо `before * 100 < …`) —
 *    падает «перескочившая 80%»: 85% одной позицией уходит в B;
 *  • нестрогое сравнение (`before * 100 <= …`) — падают «80 / 15 / 5»,
 *    «ровно 80%» и «ровно 95%»: позиция на границе уезжает в старший класс;
 *  • убрать отсев `value > 0` — падает «ноль и минус»;
 *  • в marginFlagOf `<` → `<=` — падает «ровно 5%».
 */
import { describe, it, expect } from "vitest";
import {
  ABC_RULES, MARGIN_RULES, abcClassify, abcTotals, marginFlagOf, marginPctOf, pct1,
} from "@contracts/margin";

const items = (...values: number[]) => values.map((value, i) => ({ key: i + 1, name: `П${String(i + 1).padStart(2, "0")}`, value }));
const classes = (rows: ReturnType<typeof abcClassify>) => rows.map(r => r.abc).join("");

describe("ABC: границы 80 и 95%", () => {
  it("пороги — 80 и 95", () => {
    expect(ABC_RULES.A_SHARE_PCT).toBe(80);
    expect(ABC_RULES.B_SHARE_PCT).toBe(95);
  });

  it("80 / 15 / 5 — ровно A, B, C", () => {
    expect(classes(abcClassify(items(80, 15, 5)))).toBe("ABC");
  });

  it("позиция, на которой накопленное доходит ровно до 80%, — ещё A; следующая — B", () => {
    const rows = abcClassify(items(50, 30, 15, 5));
    expect(classes(rows)).toBe("AABC");
    expect(rows.map(r => r.cumShare)).toEqual([50, 80, 95, 100]);
  });

  it("позиция, перескочившая 80%, — A; крупнейшая не уходит в B", () => {
    expect(classes(abcClassify(items(85, 10, 5)))).toBe("ABC");
    // 79 → A (до неё 0), 14 → A (до неё 79 < 80), 5 → B (до неё 93), 2 → C (до неё 98).
    expect(classes(abcClassify(items(79, 2, 14, 5)))).toBe("AABC");
  });

  it("ровно 95% до позиции — уже C", () => {
    // 60 + 20 = 80 → A, A; +15 = 95 → B; следующая начинается с 95 — C.
    expect(classes(abcClassify(items(60, 20, 15, 3, 2)))).toBe("AABCC");
  });

  it("ноль и минус — C и в сумму не входят", () => {
    const rows = abcClassify(items(60, -40, 30, 0, 10));
    expect(rows.map(r => [r.value, r.abc])).toEqual([[60, "A"], [30, "A"], [10, "B"], [0, "C"], [-40, "C"]]);
    // Доли — от 100 (60 + 30 + 10), а не от 60: убыток не делает соседей крупнее.
    expect(rows[0].share).toBe(60);
    expect(rows.at(-1)!.share).toBe(0);
  });

  it("равные суммы — по названию, вход в любом порядке даёт одно и то же", () => {
    const a = abcClassify([{ key: 2, name: "Б", value: 40 }, { key: 1, name: "А", value: 40 }, { key: 3, name: "В", value: 20 }]);
    const b = abcClassify([{ key: 3, name: "В", value: 20 }, { key: 1, name: "А", value: 40 }, { key: 2, name: "Б", value: 40 }]);
    expect(a.map(r => `${r.name}${r.abc}`)).toEqual(["АA", "БA", "ВB"]);
    expect(b.map(r => `${r.name}${r.abc}`)).toEqual(a.map(r => `${r.name}${r.abc}`));
  });

  it("итоги классов: сколько позиций и какая доля денег", () => {
    const totals = abcTotals(abcClassify(items(50, 30, 15, 5, 0)));
    expect(totals.A).toEqual({ count: 2, value: 80, share: 80 });
    expect(totals.B).toEqual({ count: 1, value: 15, share: 15 });
    expect(totals.C).toEqual({ count: 2, value: 5, share: 5 });
  });
});

describe("маржа и тревога", () => {
  it("маржа — одна десятая из целых; без выручки — нет маржи", () => {
    expect(marginPctOf(3, 1)).toBe(33.3);
    expect(marginPctOf(0, -10)).toBeNull();
    expect(pct1(1, 0)).toBeNull();
  });

  it("убыток — тревога при любом объёме", () => {
    expect(marginFlagOf({ revenue: 10, profit: -1 }, 1_000_000)).toBe("loss");
    expect(marginFlagOf({ revenue: 0, profit: -50 }, 1_000_000)).toBe("loss");
  });

  it("ровно 5% — не низкая; 4,9% при заметной доле — низкая", () => {
    expect(MARGIN_RULES.LOW_MARGIN_PCT).toBe(5);
    expect(marginFlagOf({ revenue: 1000, profit: 50 }, 10_000)).toBeNull();
    expect(marginFlagOf({ revenue: 1000, profit: 49 }, 10_000)).toBe("low");
  });

  it("низкая маржа у мелочи — не тревога: доля выручки меньше порога", () => {
    expect(MARGIN_RULES.NOTABLE_REVENUE_SHARE_PCT).toBe(2);
    // Ровно 2% выручки — уже заметно; 1,99% — нет.
    expect(marginFlagOf({ revenue: 200, profit: 1 }, 10_000)).toBe("low");
    expect(marginFlagOf({ revenue: 199, profit: 1 }, 10_000)).toBeNull();
  });
});
