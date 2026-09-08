/* ═══════════════════════════════════════════════════════════════════════════
   Состояния записей так, как они называются человеку — на обоих языках.

   ── Что здесь было раньше ───────────────────────────────────────────────────

   Этот файл заводился для выгрузок: в файлы уходило значение колонки как есть
   («active», «pending», «unloading»). Словарь был один, зато только русский, и
   экраны им пользоваться не могли — им нужен ещё узбекский. Поэтому каждый
   экран завёл свой.

   К чему это привело: словарей состояния заказа стало ПЯТЬ. Три полные, две —
   с четырьмя значениями из семи, причём одно из четырёх («completed»)
   состоянием заказа не было никогда (см. api/lib/order-status.ts). На сводке
   у руководителя в круговой диаграмме вместо «Доставлен» стояло «delivered», а
   на карточке магазина статус доставленного заказа не показывался вовсе:
   словарь возвращал undefined, и на месте состояния была пустота.

   Теперь словарь снова один, и он двуязычный. Экраны берут подпись отсюда,
   выгрузки — отсюда же.

   ── Почему типы именно такие ────────────────────────────────────────────────

   `Record<Order["status"], Label>` — не украшение, а обязательство. Тип берётся
   прямо из схемы базы: добавится восьмое состояние — здесь перестанет
   собираться сборка, и это случится у разработчика, а не у руководителя на
   экране. Ровно так же сделан словарь на сервере, и по той же причине.

   ── Правило про неизвестное значение ────────────────────────────────────────

   Незнакомое значение показывается как есть, а не прячется и не подменяется
   похожим. Промолчать о нём хуже: человек хотя бы увидит, что появилось новое
   состояние, и спросит. А подменить — хуже всего: значок состояния, который
   для незнакомого значения рисовал «Новый», врал бы уверенно и молча.
   Пусто — это прочерк, а не пустая клетка: в таблице их не отличить от
   потерянных данных.
   ═══════════════════════════════════════════════════════════════════════════ */
import type {
  Order, User, Arrival, DailyPlan, Tenant, Subscription, OrderAdjustment,
} from "@contracts/types";

/** Подпись на двух языках. */
export interface Label { ru: string; uz: string }

export type Lang = "ru" | "uz";

/**
 * Состояние заказа.
 *
 * Слова те же, что в уведомлениях с сервера (api/lib/order-status.ts): агент
 * получает в телефон «Статус изменён: доставлен» и видит на экране
 * «Доставлен» — это должно быть одно слово, иначе он думает, что речь о разном.
 */
export const ORDER_STATUS_LABEL: Record<Order["status"], Label> = {
  new:        { ru: "Новый",       uz: "Yangi" },
  processing: { ru: "В обработке", uz: "Jarayonda" },
  shipped:    { ru: "Отгружен",    uz: "Yuklandi" },
  pending:    { ru: "Ожидает",     uz: "Kutishda" },
  delivered:  { ru: "Доставлен",   uz: "Yetkazildi" },
  cancelled:  { ru: "Отменён",     uz: "Bekor qilindi" },
  returned:   { ru: "Возвращён",   uz: "Qaytarildi" },
};

/** Состояние доставки заказа — им живёт экран курьера. */
export const DELIVERY_STATUS_LABEL: Record<NonNullable<Order["deliveryStatus"]>, Label> = {
  not_assigned:     { ru: "Не назначена", uz: "Tayinlanmagan" },
  assigned:         { ru: "Назначена",    uz: "Tayinlangan" },
  out_for_delivery: { ru: "В пути",       uz: "Yo'lda" },
  delivered:        { ru: "Доставлена",   uz: "Yetkazildi" },
  failed:           { ru: "Не удалась",   uz: "Muvaffaqiyatsiz" },
};

/** Чем платят. */
export const PAYMENT_METHOD_LABEL: Record<NonNullable<Order["paymentMethod"]>, Label> = {
  cash:     { ru: "Наличные",     uz: "Naqd" },
  card:     { ru: "Карта",        uz: "Plastik" },
  transfer: { ru: "Перечисление", uz: "O'tkazma" },
  debt:     { ru: "Долг",         uz: "Qarz" },
};

/** Срочность заказа. */
export const PRIORITY_LABEL: Record<NonNullable<Order["priority"]>, Label> = {
  low:    { ru: "Низкий",  uz: "Past" },
  normal: { ru: "Обычный", uz: "Oddiy" },
  high:   { ru: "Высокий", uz: "Yuqori" },
};

/** Чем правили заказ после оформления. */
export const ADJUSTMENT_TYPE_LABEL: Record<OrderAdjustment["type"], Label> = {
  partial_delivery: { ru: "Частичная доставка",     uz: "Qisman yetkazib berish" },
  partial_payment:  { ru: "Частичная оплата",       uz: "Qisman to'lov" },
  price_change:     { ru: "Изменение цены",         uz: "Narx o'zgarishi" },
  quantity_change:  { ru: "Изменение количества",   uz: "Miqdor o'zgarishi" },
};

/**
 * Кто человек в организации.
 *
 * `superadmin` здесь не для красоты: он есть в перечислении базы, и без него
 * на экране арендатора в списке сотрудников стояло английское «superadmin».
 */
export const ROLE_LABEL: Record<User["role"], Label> = {
  superadmin:   { ru: "Администратор платформы", uz: "Platforma administratori" },
  ceo:          { ru: "Руководитель",            uz: "Rahbar" },
  operator:     { ru: "Оператор",                uz: "Operator" },
  supervisor:   { ru: "Супервайзер",             uz: "Supervayzer" },
  agent:        { ru: "Агент",                   uz: "Agent" },
  merchandiser: { ru: "Мерчандайзер",            uz: "Merchandayzer" },
  courier:      { ru: "Курьер",                  uz: "Kuryer" },
};

/**
 * Работает ли запись: магазины, товары, сотрудники, поставщики, организации.
 *
 * Три значения на четыре перечисления: у сотрудника и магазина бывает
 * active/inactive, у организации — active/suspended. Общий словарь потому, что
 * слово «Работает» на всех экранах должно быть одно.
 */
export const ACTIVE_STATUS_LABEL: Record<User["status"] | Tenant["status"], Label> = {
  active:    { ru: "Работает",      uz: "Faol" },
  inactive:  { ru: "Не работает",   uz: "Faol emas" },
  suspended: { ru: "Приостановлен", uz: "To'xtatilgan" },
};

/** Состояние прихода на склад. */
export const ARRIVAL_STATUS_LABEL: Record<Arrival["status"], Label> = {
  pending:   { ru: "Ожидает",      uz: "Kutilmoqda" },
  unloading: { ru: "Разгружается", uz: "Tushirilmoqda" },
  completed: { ru: "Принят",       uz: "Qabul qilindi" },
};

/**
 * Состояние погрузочного листа.
 *
 * На сервере эти же состояния подписаны только по-русски (api/lib/order-status)
 * — там они уходят в печать и в сообщения об отказе, где язык всегда русский.
 * Экран двуязычен, отсюда своя пара.
 */
export const LOADING_LIST_STATUS_LABEL: Record<string, Label> = {
  preparing: { ru: "Готовится",  uz: "Tayyorlanmoqda" },
  ready:     { ru: "Готов",      uz: "Tayyor" },
  loading:   { ru: "Загружается", uz: "Yuklanmoqda" },
  loaded:    { ru: "Загружен",   uz: "Yuklandi" },
  delivered: { ru: "Отгружен",   uz: "Jo'natildi" },
};

/** Состояние точки в плане агента. */
export const PLAN_STATUS_LABEL: Record<DailyPlan["status"], Label> = {
  planned: { ru: "Запланирован", uz: "Rejalashtirilgan" },
  visited: { ru: "Посещён",      uz: "Borildi" },
  skipped: { ru: "Пропущен",     uz: "O'tkazildi" },
};

/** Тариф организации. */
export const TENANT_PLAN_LABEL: Record<Tenant["plan"], Label> = {
  trial:     { ru: "Пробный",   uz: "Sinov" },
  basic:     { ru: "Базовый",   uz: "Asosiy" },
  pro:       { ru: "Про",       uz: "Pro" },
  exclusive: { ru: "Эксклюзив", uz: "Eksklyuziv" },
};

/** Состояние подписки на стороне платёжной системы. */
export const SUBSCRIPTION_STATUS_LABEL: Record<Subscription["status"], Label> = {
  trialing:   { ru: "Пробный период", uz: "Sinov davri" },
  active:     { ru: "Активна",        uz: "Faol" },
  past_due:   { ru: "Ошибка оплаты",  uz: "To'lov xatosi" },
  canceled:   { ru: "Отменена",       uz: "Bekor qilingan" },
  incomplete: { ru: "Не завершена",   uz: "Yakunlanmagan" },
};

/** Запас товара по отношению к порогу — для колонки-светофора. */
export const STOCK_LEVEL_LABEL: Record<"low" | "ok", Label> = {
  low: { ru: "Мало",       uz: "Kam" },
  ok:  { ru: "Достаточно", uz: "Yetarli" },
};

/** Оценка платёжной дисциплины магазина — в таблице цвет не покажешь. */
export const TIER_LABEL: Record<"red" | "yellow" | "green" | "new", Label> = {
  red:    { ru: "Долго не платят", uz: "Uzoq to'lamayapti" },
  yellow: { ru: "Есть долг",       uz: "Qarzi bor" },
  green:  { ru: "Рассчитываются",  uz: "Hisob-kitob qiladi" },
  new:    { ru: "Заказов не было", uz: "Buyurtma bo'lmagan" },
};

/**
 * Подпись по словарю; неизвестное — как есть, пустое — прочерком.
 *
 * Язык по умолчанию русский: выгрузки и печатные документы делаются на русском
 * независимо от того, какой язык выбран в приложении, — их подшивают в папку.
 */
export function labelled(map: Record<string, Label>, v: unknown, lang: Lang = "ru"): string {
  if (v === null || v === undefined || v === "") return "—";
  const hit = map[String(v)];
  return hit ? hit[lang] : String(v);
}
