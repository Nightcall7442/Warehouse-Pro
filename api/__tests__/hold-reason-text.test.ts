/**
 * Причина удержания заказа — словами, на двух языках.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Причина ожидания была одна (скидка выше порога), писалась по-русски прямо в
 * роутере, и узбекский экран показывал её русской. Телефон после отправки
 * говорил «скидка выше порога» про любое удержание.
 *
 * ── Что проверяется ─────────────────────────────────────────────────────────
 *
 * 1. Просрочка пишется одной строкой с суммой целыми (разряды обычным
 *    пробелом) и возрастом в днях; знак валюты — до или после, как у
 *    организации.
 * 2. Узбекский экран переводит обе известные причины, и склеенные через «; »
 *    тоже; незнакомая строка остаётся как есть, пустая — пустой.
 * 3. Склейка выкидывает пустое и не выходит за столбец (255).
 *
 * Нарочная поломка: поменять слово в шаблоне overdueHoldReason, не тронув
 * разбор OVERDUE, — вторая проверка падает (узбекский получает русскую фразу).
 */
import { describe, it, expect } from "vitest";
import { overdueHoldReason, holdReasonText, joinHoldReasons, groupDigits, HOLD_REASON_MAX } from "@contracts/hold-reason";

const SUM = { symbol: "сум", position: "after" as const };

describe("причина удержания", () => {
  it("просрочка — сумма целыми и возраст в днях", () => {
    expect(overdueHoldReason({ amount: 1_200_000.4, oldestDays: 45 }, SUM)).toBe("Просроченный долг: 1 200 000 сум, самый старый — 45 дн.");
    expect(overdueHoldReason({ amount: 800, oldestDays: 40 }, { symbol: "$", position: "before" })).toBe("Просроченный долг: $ 800, самый старый — 40 дн.");
    expect(groupDigits(1234567.6)).toBe("1 234 568");
  });

  it("узбекский экран переводит обе причины, по отдельности и вместе", () => {
    const overdue = overdueHoldReason({ amount: 1_200_000, oldestDays: 45 }, SUM);
    const discount = "Скидка 15% выше порога 10% для полевых сотрудников";
    expect(holdReasonText(overdue, "uz")).toBe("Muddati o'tgan qarz: 1 200 000 сум, eng eskisi — 45 kun");
    expect(holdReasonText(discount, "uz")).toBe("Chegirma 15% dala xodimlari uchun 10% chegaradan yuqori");
    expect(holdReasonText(`${discount}; ${overdue}`, "uz"))
      .toBe("Chegirma 15% dala xodimlari uchun 10% chegaradan yuqori; Muddati o'tgan qarz: 1 200 000 сум, eng eskisi — 45 kun");
    // Русский — как лежит в базе.
    expect(holdReasonText(overdue, "ru")).toBe(overdue);
    // Незнакомое — как есть; пустое — пусто.
    expect(holdReasonText("Особая причина", "uz")).toBe("Особая причина");
    expect(holdReasonText(null, "uz")).toBe("");
  });

  it("склейка — без пустых, не длиннее столбца", () => {
    expect(joinHoldReasons(null, "", "  ")).toBeNull();
    expect(joinHoldReasons("А", null, "Б")).toBe("А; Б");
    expect(joinHoldReasons("x".repeat(300))!.length).toBe(HOLD_REASON_MAX);
  });
});
