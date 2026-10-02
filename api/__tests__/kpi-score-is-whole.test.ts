/**
 * Балл KPI — целое число при любом штрафе за подозрительные визиты.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * На телефоне агента в карточке «Показатели» стояло «27.900000000000002/100».
 * Состав балла округлялся, а штраф — нет: 7% подозрительных визитов × 0,3 =
 * 2,1, и 30 − 2,1 в двоичной дроби — это 27,900000000000002. Число уходило в
 * ответ как есть и печаталось как есть: на телефоне, в карточке KPI, в
 * зарплате («KPI балл») и в таблице агентов.
 *
 * ── Что проверяется ─────────────────────────────────────────────────────────
 *
 *  1. Ровно тот случай: состав 30, фрод 7% → 28, а не 27.9…
 *  2. Целое при любом фроде от 0 до 100% и любом составе — перебором.
 *
 * Отображение тоже округляет (src/__tests__/kpi-score-whole-on-phone.test.tsx)
 * — на случай старого ответа из кэша мобилки.
 *
 * ── Нарочная поломка ────────────────────────────────────────────────────────
 *
 * Убрать Math.round в kpiScoreOf — падают обе проверки.
 */
import { describe, it, expect } from "vitest";
import { kpiScoreOf } from "../services/kpi";

const ONLY_VISITS = { visitCompletion: 100, revenue: 0, conversion: 0, returnRate: 0, debtCollection: 0 };

describe("балл KPI — целым", () => {
  it("состав 30 и 7% фрода — 28, а не 27.900000000000002", () => {
    const score = kpiScoreOf(ONLY_VISITS, 7);
    expect(String(score)).toBe("28");
  });

  it("перебор: любой фрод, любой состав — целое от 0 до 100", () => {
    for (let fraud = 0; fraud <= 100; fraud++) {
      for (const visit of [0, 13, 37, 64, 100]) {
        const s = kpiScoreOf({ ...ONLY_VISITS, visitCompletion: visit, conversion: visit % 41, debtCollection: 100 - visit }, fraud);
        expect(Number.isInteger(s), `фрод ${fraud}%, визиты ${visit}%: ${s}`).toBe(true);
        expect(s).toBeGreaterThanOrEqual(0);
        expect(s).toBeLessThanOrEqual(100);
      }
    }
  });
});
