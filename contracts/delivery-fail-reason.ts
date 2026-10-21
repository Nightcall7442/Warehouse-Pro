/**
 * Почему заказ не довезли — список причин и их подписи.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Курьер жал «Не доставлен» и, если хотел, писал пару слов. Слова уходили в
 * уведомление директору и в Telegram — и пропадали: на заказе они не
 * хранились, отчёта по ним не было. «Магазин закрыт», «нет денег» и «не тот
 * товар» — разные разговоры (с агентом о времени визита, с магазином о долге,
 * со складом о сборке), а директор видел одно «не доставлен».
 *
 * ── Как теперь ──────────────────────────────────────────────────────────────
 *
 * Причина — одна из списка; для «Другое» обязателен короткий текст. Список
 * общий: его читают ручки (courier.markFailed, courier.reschedule), журнал
 * попыток (delivery_events), отчёт «Недоставленные» и экраны курьера.
 * Столбец delivery_events.reason_code повторяет его буквально — тест держит
 * совпадение.
 *
 * Во входе ручек код необязателен: мобилка старой версии его не знает и шлёт
 * свободный текст одной из трёх своих кнопок. Эти три текста узнаются
 * (legacyFailReasonCode), чтобы отчёт складывал старые и новые отметки в одни
 * и те же строки.
 */

export const DELIVERY_FAIL_REASONS = [
  "shop_closed",
  "no_owner",
  "no_money",
  "refused",
  "wrong_goods",
  "damaged",
  "address_not_found",
  "no_answer",
  "asked_reschedule",
  "no_time",
  "vehicle_issue",
  "short_stock",
  "other",
] as const;
export type DeliveryFailReason = typeof DELIVERY_FAIL_REASONS[number];

/** Столбец delivery_events.note — varchar(300). */
export const DELIVERY_FAIL_NOTE_MAX = 300;

/** На сколько дней вперёд можно перенести доставку: дальше — это уже новый заказ. */
export const RESCHEDULE_MAX_DAYS = 14;

export const DELIVERY_FAIL_LABEL: Record<DeliveryFailReason, { ru: string; uz: string }> = {
  shop_closed:       { ru: "Магазин закрыт",                 uz: "Do'kon yopiq" },
  no_owner:          { ru: "Нет хозяина / принимающего",     uz: "Egasi yoki qabul qiluvchi yo'q" },
  no_money:          { ru: "Нечем платить",                  uz: "To'lashga puli yo'q" },
  refused:           { ru: "Отказались принимать",           uz: "Qabul qilishdan bosh tortdi" },
  wrong_goods:       { ru: "Привезли не то",                 uz: "Boshqa tovar keldi" },
  damaged:           { ru: "Товар повреждён",                uz: "Tovar shikastlangan" },
  address_not_found: { ru: "Не нашёл адрес",                 uz: "Manzil topilmadi" },
  no_answer:         { ru: "Не дозвонился",                  uz: "Telefonga javob yo'q" },
  asked_reschedule:  { ru: "Просили привезти в другой день", uz: "Boshqa kuni olib kelishni so'rashdi" },
  no_time:           { ru: "Не успел за день",               uz: "Kun davomida ulgurmadim" },
  vehicle_issue:     { ru: "Проблема с машиной",             uz: "Mashinada nosozlik" },
  short_stock:       { ru: "Не хватило товара в машине",     uz: "Mashinada tovar yetmadi" },
  other:             { ru: "Другое",                         uz: "Boshqa" },
};

/** Отметка без кода (мобилка старой версии, текст не узнан). */
export const DELIVERY_FAIL_UNSPECIFIED = { ru: "Не указана", uz: "Ko'rsatilmagan" };

export function isDeliveryFailReason(v: unknown): v is DeliveryFailReason {
  return typeof v === "string" && (DELIVERY_FAIL_REASONS as readonly string[]).includes(v);
}

/**
 * Код по тексту старой кнопки.
 *
 * Мобилка до этого списка слала одну из трёх строк (src/lib/courier-route.ts,
 * FAIL_REASONS) или текст, набранный руками. Три строки узнаются буквально,
 * без учёта регистра и пробелов по краям; всё остальное — «Другое» с текстом
 * в пояснении, а пустое — «не указана».
 */
const LEGACY_TEXT: Record<string, DeliveryFailReason> = {
  "магазин закрыт": "shop_closed",
  "нет денег": "no_money",
  "отказался от товара": "refused",
};

export function legacyFailReasonCode(text: string | null | undefined): DeliveryFailReason | null {
  const t = text?.trim().toLowerCase() ?? "";
  if (!t) return null;
  return LEGACY_TEXT[t] ?? "other";
}

/** Подпись причины на языке экрана; null — «не указана». */
export function deliveryFailLabel(reason: DeliveryFailReason | null | undefined, lang: string): string {
  const label = reason ? DELIVERY_FAIL_LABEL[reason] : DELIVERY_FAIL_UNSPECIFIED;
  return lang === "uz" ? label.uz : label.ru;
}

/** «Другое: шлагбаум закрыт» — причина с пояснением, если оно есть. */
export function deliveryFailText(reason: DeliveryFailReason | null | undefined, note: string | null | undefined, lang: string): string {
  const label = deliveryFailLabel(reason, lang);
  const text = note?.trim();
  return text ? `${label}: ${text}` : label;
}

/**
 * Что не так с причиной — одно правило для сервера и экрана.
 *
 * null — всё в порядке. Пустой код тоже в порядке: его не шлют старые сборки,
 * и решать, обязателен ли он, — дело экрана.
 */
export function deliveryFailInputError(reason: DeliveryFailReason | null | undefined, note: string | null | undefined): "note_required" | "note_too_long" | null {
  const text = note?.trim() ?? "";
  if (text.length > DELIVERY_FAIL_NOTE_MAX) return "note_too_long";
  if (reason === "other" && text.length === 0) return "note_required";
  return null;
}
