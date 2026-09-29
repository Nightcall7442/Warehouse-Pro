import { sql, type SQL, type SQLWrapper } from "drizzle-orm";

/*
  Строка поиска на «Заказах»: номер заказа, название магазина, его владелец и
  телефон.

  ── Что было ────────────────────────────────────────────────────────────────

  Поиск отвечал на номер и название. Оператору же звонят со словами «это
  Алишер, 90 123 45 67» — вывеску он знает не всегда, а имя хозяина и номер
  телефона называют первым делом. Найти заказ по ним было нечем: только
  открыть «Магазины», найти точку, перейти в её заказы.

  ── Телефон — по цифрам ─────────────────────────────────────────────────────

  В базе номер записан как пришлось: «+998901234567», «+998 90 123 45 67»,
  «90-123-45-67». Строка «90 123 45 67» буквами не совпала бы ни с одним из
  них, поэтому и строка, и номер сводятся к цифрам.

  Телефоном строка считается, только если в ней нет ничего, кроме цифр и
  знаков номера, и цифр не меньше пяти. Номера заказов — «№149», «№1490»:
  короткий набор цифр — это почти всегда номер заказа, и без порога «1490»
  нашло бы вдобавок к заказу №1490 заказы всех магазинов, в чьём телефоне
  есть 1490.

  Одно правило на три места — таблицу (OrderService.list), плитки
  (order.stats) и «По агентам» (order.agentSummary). Разойдись они, плитка
  «Всего» считала бы не те заказы, что стоят в таблице под ней.
*/

/** Цифры номера, если строка похожа на телефон; иначе null. */
export function phoneDigits(raw: string): string | null {
  const s = raw.trim();
  if (!/^[\d\s+()\-.]+$/.test(s)) return null;
  let digits = s.replace(/\D/g, "");
  if (digits.length < 5) return null;
  // Полный номер с кодом страны находит и записанный без кода: «+998 90 123
  // 45 67» → «901234567», а это подстрока обеих записей.
  if (digits.length === 12 && digits.startsWith("998")) digits = digits.slice(3);
  return digits;
}

/** Столбцы магазина — таблицей из join или подзапросом (s2.name). */
export interface ShopSearchColumns {
  name: SQLWrapper;
  ownerName: SQLWrapper;
  phone: SQLWrapper;
}

/** Магазин подходит под строку: название, владелец, телефон по цифрам. */
export function shopMatches(raw: string, shop: ShopSearchColumns): SQL {
  const term = `%${raw.trim()}%`;
  const digits = phoneDigits(raw);
  const byPhone = digits
    ? sql` OR REGEXP_REPLACE(${shop.phone}, '[^0-9]', '') LIKE ${`%${digits}%`}`
    : sql``;
  return sql`(${shop.name} LIKE ${term} OR ${shop.ownerName} LIKE ${term}${byPhone})`;
}

/** Заказ подходит под строку: его номер или его магазин. */
export function orderMatches(raw: string, orderNumber: SQLWrapper, shop: ShopSearchColumns): SQL {
  return sql`(${orderNumber} LIKE ${`%${raw.trim()}%`} OR ${shopMatches(raw, shop)})`;
}
