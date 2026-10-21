/**
 * Причины недоставки — контракт и столбец журнала попыток.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * «Не доставлен» нёс свободный текст, и тот нигде не хранился. Теперь причина
 * — код из contracts/delivery-fail-reason.ts, и тот же список выписан
 * буквально в delivery_events.reason_code (схему читает drizzle-kit своим
 * загрузчиком, импортировать список туда нельзя).
 *
 * ── Что проверяется ─────────────────────────────────────────────────────────
 *
 *  1. Список совпадает со столбцом, длина пояснения — со столбцом note.
 *  2. «Другое» требует текст; длиннее столбца — нет.
 *  3. Три текста кнопок старой мобилки узнаются кодами; свой текст — «Другое»;
 *     пусто — «не указана».
 *  4. Подписи — на обоих языках у каждого кода.
 *
 * Нарочная поломка: убрать "no_answer" из DELIVERY_FAIL_REASONS — падает 1;
 * убрать строку «нет денег» из LEGACY_TEXT — падает 3.
 */
import { describe, it, expect } from "vitest";
import { deliveryEvents } from "@db/schema";
import {
  DELIVERY_FAIL_REASONS, DELIVERY_FAIL_LABEL, DELIVERY_FAIL_NOTE_MAX,
  deliveryFailInputError, deliveryFailText, legacyFailReasonCode, isDeliveryFailReason,
} from "@contracts/delivery-fail-reason";

describe("причины недоставки: контракт", () => {
  it("1. список совпадает со столбцом delivery_events.reason_code; длина — по столбцу note", () => {
    expect([...DELIVERY_FAIL_REASONS]).toEqual(deliveryEvents.reasonCode.enumValues);
    expect(deliveryEvents.note.getSQLType()).toBe(`varchar(${DELIVERY_FAIL_NOTE_MAX})`);
  });

  it("2. «Другое» требует текст; текст длиннее столбца — нет", () => {
    expect(deliveryFailInputError("other", "")).toBe("note_required");
    expect(deliveryFailInputError("other", "   ")).toBe("note_required");
    expect(deliveryFailInputError("other", "шлагбаум")).toBeNull();
    expect(deliveryFailInputError("shop_closed", undefined)).toBeNull();
    expect(deliveryFailInputError(null, null)).toBeNull();
    expect(deliveryFailInputError("refused", "я".repeat(DELIVERY_FAIL_NOTE_MAX + 1))).toBe("note_too_long");
  });

  it("3. тексты старой мобилки узнаются; свой текст — «Другое»; пусто — без кода", () => {
    expect(legacyFailReasonCode("Магазин закрыт")).toBe("shop_closed");
    expect(legacyFailReasonCode(" нет денег ")).toBe("no_money");
    expect(legacyFailReasonCode("Отказался от товара")).toBe("refused");
    expect(legacyFailReasonCode("сломался шлагбаум")).toBe("other");
    expect(legacyFailReasonCode("")).toBeNull();
    expect(legacyFailReasonCode(undefined)).toBeNull();
  });

  it("4. у каждого кода две подписи; текст причины — с пояснением", () => {
    for (const code of DELIVERY_FAIL_REASONS) {
      expect(DELIVERY_FAIL_LABEL[code].ru.trim().length, code).toBeGreaterThan(0);
      expect(DELIVERY_FAIL_LABEL[code].uz.trim().length, code).toBeGreaterThan(0);
      expect(DELIVERY_FAIL_LABEL[code].uz, `${code}: узбекская подпись по-русски`).not.toMatch(/[а-яё]/i);
    }
    expect(deliveryFailText("other", " шлагбаум ", "ru")).toBe("Другое: шлагбаум");
    expect(deliveryFailText(null, null, "uz")).toBe("Ko'rsatilmagan");
    expect(isDeliveryFailReason("no_money")).toBe(true);
    expect(isDeliveryFailReason("closed")).toBe(false);
  });
});
