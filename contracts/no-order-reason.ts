/**
 * Почему визит прошёл без заказа — список причин и их подписи.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Агент отмечал визит «посещён», заказа не было — и всё. Директор видел, что
 * у агента двадцать визитов и восемь заказов, но не знал, что за остальными
 * двенадцатью: «закрыто» лечится временем визита, «нет денег» — отсрочкой,
 * «есть остаток» — меньшим заказом, «берёт у конкурента» — ценой. Это разные
 * разговоры, и без причины ни один из них не начинался.
 *
 * ── Как теперь ──────────────────────────────────────────────────────────────
 *
 * Причина — одна из шести; для «Другое» обязателен короткий текст. Список
 * общий: его читают ручки (agent.updatePlanStatus, agent.saveVisitPhoto),
 * отчёт (reports.noOrderVisits), светофор магазина и оба экрана агента.
 * Столбец daily_plans.no_order_reason повторяет его буквально — тест держит
 * совпадение.
 *
 * Во входе ручек причина необязательна: мобилка старой версии поля не знает
 * и продолжает отмечать визиты как раньше. Обязательна она в экранах агента
 * (веб и PWA) — там визит без заказа без причины не закрывается.
 */

export const NO_ORDER_REASONS = ["closed", "no_money", "has_stock", "competitor", "no_owner", "other"] as const;
export type NoOrderReason = typeof NO_ORDER_REASONS[number];

/** Столбец daily_plans.no_order_note — varchar(200). */
export const NO_ORDER_NOTE_MAX = 200;

/**
 * С какого «подряд» отчёт подсказывает директору: магазин три визита кряду
 * «есть остаток» — заказ, похоже, великоват для его оборота.
 */
export const NO_ORDER_STREAK_HINT = 3;

export const NO_ORDER_REASON_LABEL: Record<NoOrderReason, { ru: string; uz: string }> = {
  closed:     { ru: "Закрыто",                       uz: "Yopiq" },
  no_money:   { ru: "Нет денег",                     uz: "Pul yo'q" },
  has_stock:  { ru: "Есть остаток",                  uz: "Qoldiq bor" },
  competitor: { ru: "Берёт у конкурента",            uz: "Raqobatchidan oladi" },
  no_owner:   { ru: "Нет хозяина / ответственного",  uz: "Egasi yoki mas'ul yo'q" },
  other:      { ru: "Другое",                        uz: "Boshqa" },
};

/** Визит без заказа, причину которого не прислали (мобилка старой версии). */
export const NO_ORDER_UNSPECIFIED = { ru: "Не указана", uz: "Ko'rsatilmagan" };

export function isNoOrderReason(v: unknown): v is NoOrderReason {
  return typeof v === "string" && (NO_ORDER_REASONS as readonly string[]).includes(v);
}

/** Подпись причины на языке экрана; null — «не указана». */
export function noOrderReasonLabel(reason: NoOrderReason | null | undefined, lang: string): string {
  const label = reason ? NO_ORDER_REASON_LABEL[reason] : NO_ORDER_UNSPECIFIED;
  return lang === "uz" ? label.uz : label.ru;
}

/** «Другое: ремонт» — причина с пояснением, если оно есть. */
export function noOrderReasonText(reason: NoOrderReason | null | undefined, note: string | null | undefined, lang: string): string {
  const label = noOrderReasonLabel(reason, lang);
  const text = note?.trim();
  return reason === "other" && text ? `${label}: ${text}` : label;
}

/**
 * Что не так с причиной — одно правило для сервера и экрана.
 *
 * null — всё в порядке. Пустая причина тоже в порядке: решать, обязательна
 * ли она, — дело вызывающего (экран агента — обязательна, ручка — нет).
 */
export function noOrderInputError(reason: NoOrderReason | null | undefined, note: string | null | undefined): "note_required" | "note_too_long" | null {
  const text = note?.trim() ?? "";
  if (text.length > NO_ORDER_NOTE_MAX) return "note_too_long";
  if (reason === "other" && text.length === 0) return "note_required";
  return null;
}
