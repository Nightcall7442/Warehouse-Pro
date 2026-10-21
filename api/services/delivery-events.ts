import { and, eq } from "drizzle-orm";
import { deliveryEvents, type InsertDeliveryEvent } from "@db/schema";
import {
  DELIVERY_FAIL_LABEL, DELIVERY_FAIL_NOTE_MAX, deliveryFailInputError, legacyFailReasonCode, type DeliveryFailReason,
} from "@contracts/delivery-fail-reason";
import { businessDaysAgo, businessToday } from "@contracts/business-time";
import { badRequest } from "../lib/errors";
import { sanitizeString } from "../lib/sanitize";
import type { Db } from "./order-shared";

/*
  Журнал попыток доставки — общие правила записи.

  Строку пишут четыре места (довёз, довёз с расчётом, не довёз, перенёс), и
  каждое — в своей транзакции, рядом со сменой статуса заказа. Здесь то, что
  у них общее: как понимать причину, присланную старой и новой мобилкой, как
  узнать повтор из очереди и какие дни можно назвать днём переноса.
*/

/** Повтор из очереди телефона: строка с этим ключом уже записана. */
export async function eventByKey(db: Pick<Db, "select">, tenantId: number, key: string | undefined | null): Promise<{ id: number; orderId: number } | null> {
  if (!key) return null;
  const [row] = await db.select({ id: deliveryEvents.id, orderId: deliveryEvents.orderId }).from(deliveryEvents)
    .where(and(eq(deliveryEvents.tenantId, tenantId), eq(deliveryEvents.idempotencyKey, key)))
    .limit(1);
  return row ?? null;
}

/**
 * Точка отметки — обе координаты или ни одной: половина точки на карту не
 * ложится, а «Где отмечено» по ней вело бы в океан.
 */
export function placeOf(input: { lat?: string | null; lng?: string | null }): { lat: string | null; lng: string | null } {
  return input.lat && input.lng ? { lat: input.lat, lng: input.lng } : { lat: null, lng: null };
}

export async function recordDeliveryEvent(tx: Pick<Db, "insert">, row: InsertDeliveryEvent): Promise<void> {
  await tx.insert(deliveryEvents).values(row);
}

/**
 * Причина недоставки из того, что прислали.
 *
 * Новая мобилка и веб шлют код и пояснение. Старая — только текст одной из
 * трёх кнопок или набранный руками: три кнопки узнаются кодом, остальное —
 * «Другое» с этим текстом в пояснении (обрезанным под столбец: старая
 * схема пускала 500 символов, столбец держит 300).
 */
export function failReasonOf(
  input: { reasonCode?: DeliveryFailReason | null; note?: string | null; reason?: string | null },
  fallback: DeliveryFailReason | null = null,
): { code: DeliveryFailReason | null; note: string | null } {
  if (input.reasonCode) {
    const note = input.note ? sanitizeString(input.note).trim() : "";
    return { code: input.reasonCode, note: note || null };
  }
  const legacy = input.reason ? sanitizeString(input.reason).trim() : "";
  const code = legacyFailReasonCode(legacy) ?? fallback;
  const note = input.note ? sanitizeString(input.note).trim() : (code === "other" ? legacy.slice(0, DELIVERY_FAIL_NOTE_MAX) : "");
  return { code, note: note || null };
}

/** Тот же разбор, что на экране: «Другое» без текста и слишком длинный текст — отказ. */
export function assertFailReason(code: DeliveryFailReason | null, note: string | null): void {
  const err = deliveryFailInputError(code, note);
  if (err === "note_required") throw badRequest("Для причины «Другое» напишите, что случилось");
  if (err === "note_too_long") throw badRequest(`Пояснение — не длиннее ${DELIVERY_FAIL_NOTE_MAX} символов`);
}

/** Причина словами для уведомления: «Магазин закрыт: после обеда». */
export function reasonWords(code: DeliveryFailReason | null, note: string | null): { ru: string; uz: string } {
  const label = code ? DELIVERY_FAIL_LABEL[code] : null;
  const join = (l: string | undefined) => [l, note].filter(Boolean).join(": ");
  return { ru: join(label?.ru), uz: join(label?.uz) };
}

/** «ГГГГ-ММ-ДД» → «дд.мм» для уведомлений. */
export function ddmm(day: string): string {
  return `${day.slice(8, 10)}.${day.slice(5, 7)}`;
}

/**
 * Проверить день переноса: настоящий день «ГГГГ-ММ-ДД» в окне [from, to]
 * дней от сегодняшнего (по Ташкенту). Курьер переносит с завтра, офис — и на
 * сегодня (вернуть заказ в сегодняшний развоз).
 */
export function assertPlanDay(day: string, fromDays: number, toDays: number, now: number = Date.now()): void {
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(day) && !Number.isNaN(Date.parse(`${day}T00:00:00Z`))
    && new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) === day;
  if (!valid) throw badRequest(`Такой даты не существует: ${day}`);
  const first = businessDaysAgo(-fromDays, now);
  const last = businessDaysAgo(-toDays, now);
  if (day < first || day > last) {
    throw badRequest(fromDays > 0
      ? `Перенести можно с завтрашнего дня и не дальше чем на ${toDays} дней`
      : `День доставки — с сегодняшнего и не дальше чем на ${toDays} дней`);
  }
}

/** Сегодня по Ташкенту — отдельным именем, чтобы стенд мог его подменить. */
export function planToday(now: number = Date.now()): string {
  return businessToday(now);
}
