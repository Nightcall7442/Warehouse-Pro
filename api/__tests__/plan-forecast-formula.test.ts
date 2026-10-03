/**
 * Прогноз выполнения плана — формула contracts/plan-forecast.ts.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Прогноза не было: директор видел «выполнено 38%» четырнадцатого числа и
 * сам прикидывал, хорошо это или плохо. Формула новая; ошибается она тихо —
 * на воскресеньях, на округлении «99,6% → 100%» и на первых днях месяца.
 *
 * ── Что проверяется ─────────────────────────────────────────────────────────
 *
 *  1. Рабочие дни — понедельник–суббота; сегодняшний считается прошедшим,
 *     воскресенье — нет.
 *  2. Прогноз = факт ÷ прошедшие × все; % плана — вниз (99,96% — не зелёный),
 *     «нужно в день» — вверх.
 *  3. Цвета: ≥100 зелёный, 90–99 жёлтый, <90 красный; первые 3 рабочих дня —
 *     «рано судить» без цвета; выполненный план — зелёный всегда.
 *
 * Даты — март 2031 года: календарь фиксирован, а не «сегодня», которое
 * однажды станет прошлым (так уже дважды падали соседние тесты).
 * 1 марта 2031 — суббота; воскресенья — 2, 9, 16, 23, 30.
 *
 * ── Нарочные поломки ────────────────────────────────────────────────────────
 *
 *  • WEEKEND_DAYS = [] — падает «26 рабочих дней»;
 *  • Math.floor → Math.round у % плана — падает «99,96% — не зелёный»;
 *  • EARLY_WORKDAYS = 0 — падает «рано судить».
 */
import { describe, it, expect } from "vitest";
import { FORECAST_RULES, forecastLine, needPerDayText, workDaysOf } from "@contracts/plan-forecast";

describe("рабочие дни месяца", () => {
  it("март 2031: 26 рабочих дней — без пяти воскресений", () => {
    expect(workDaysOf("2031-03-01")).toEqual({ total: 26, passed: 1, left: 25 });
    expect(workDaysOf("2031-03-31")).toEqual({ total: 26, passed: 26, left: 0 });
  });

  it("сегодняшний будний — прошёл; воскресенье в счёт не идёт", () => {
    expect(workDaysOf("2031-03-14").passed).toBe(12); // пятница: 14 дней минус 2-е и 9-е
    expect(workDaysOf("2031-03-16").passed).toBe(13); // воскресенье: суббота 15-го — последний рабочий
    expect(workDaysOf("2031-03-15").passed).toBe(13);
  });

  it("февраль 2031 — 24 рабочих дня", () => {
    expect(workDaysOf("2031-02-10").total).toBe(24);
  });
});

describe("прогноз, % плана и «нужно в день»", () => {
  const mid = workDaysOf("2031-03-14"); // 12 из 26, осталось 14

  it("темп × все рабочие дни, деньги целыми", () => {
    const f = forecastLine(1_000_000, 2_600_000, mid);
    expect(f.forecast).toBe(2_166_667); // 1 000 000 × 26 / 12 = 2 166 666,67
    expect(f.forecastPct).toBe(83);
    expect(f.needPerDay).toBe(114_286); // 1 600 000 / 14 = 114 285,71 — вверх
    expect(f.tone).toBe("red");
  });

  it("% плана — вниз: 99,96% не становится зелёными 100", () => {
    // факт 1 199 520 × 26 / 12 = 2 598 960 → 99,96% от 2 600 000.
    const f = forecastLine(1_199_520, 2_600_000, mid);
    expect(f.forecast).toBe(2_598_960);
    expect(f.forecastPct).toBe(99);
    expect(f.tone).toBe("yellow");
  });

  it("границы цветов: 100 — зелёный, 90 — жёлтый, 89 — красный", () => {
    const d = { total: 10, passed: 5, left: 5 };
    expect(forecastLine(500, 1000, d).tone).toBe("green");   // прогноз 1000 = 100%
    expect(forecastLine(450, 1000, d).tone).toBe("yellow");  // 900 = 90%
    expect(forecastLine(449, 1000, d).tone).toBe("red");     // 898 = 89%
    expect(FORECAST_RULES.GREEN_PCT).toBe(100);
    expect(FORECAST_RULES.YELLOW_PCT).toBe(90);
  });

  it("план выполнен — зелёный и «нужно» ноль", () => {
    const f = forecastLine(3_000_000, 2_600_000, mid);
    expect(f.tone).toBe("green");
    expect(f.needPerDay).toBe(0);
  });

  it("последний рабочий день — «нужно» весь остаток сегодня", () => {
    const f = forecastLine(900, 1000, workDaysOf("2031-03-31"));
    expect(f.needPerDay).toBe(100);
  });

  it("без плана — ни процента, ни цвета, ни «нужно»", () => {
    const f = forecastLine(1_000_000, null, mid);
    expect(f).toMatchObject({ plan: null, forecastPct: null, needPerDay: null, tone: "none", forecast: 2_166_667 });
    expect(forecastLine(1_000, 0, mid).tone).toBe("none");
  });
});

describe("рано судить", () => {
  it("первые три рабочих дня — «early», хоть прогноз и красный", () => {
    expect(FORECAST_RULES.EARLY_WORKDAYS).toBe(3);
    // 4 марта — третий рабочий (1-е, 3-е, 4-е).
    const third = forecastLine(10_000, 2_600_000, workDaysOf("2031-03-04"));
    expect(third.tone).toBe("early");
    expect(third.forecastPct).toBe(3);
    // 5 марта — четвёртый: уже судим.
    expect(forecastLine(10_000, 2_600_000, workDaysOf("2031-03-05")).tone).toBe("red");
  });

  it("выполненный план зелёный и в первые дни", () => {
    expect(forecastLine(3_000_000, 2_600_000, workDaysOf("2031-03-03")).tone).toBe("green");
  });
});

describe("«Нужно в день» — не рвётся на телефоне", () => {
  const fmt = (n: number) => `${n.toLocaleString("ru")}\u00A0сум`;
  it("сумма, «в» и «день» — неразрывными пробелами (было «7 711 711 сум в / день»)", () => {
    const s = needPerDayText({ needPerDay: 7711711 }, "ru", fmt);
    expect(s.endsWith("\u00A0в\u00A0день")).toBe(true);
    expect(s).not.toMatch(/ /);
    expect(needPerDayText({ needPerDay: 5 }, "uz", fmt)).not.toMatch(/ /);
  });
  it("без плана — прочерк, выполнен — словом", () => {
    expect(needPerDayText({ needPerDay: null }, "ru", fmt)).toBe("—");
    expect(needPerDayText({ needPerDay: 0 }, "ru", fmt)).toBe("выполнен");
    expect(needPerDayText({ needPerDay: 0 }, "uz", fmt)).toBe("bajarildi");
  });
});
