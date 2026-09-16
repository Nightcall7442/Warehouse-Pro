import { sql } from "drizzle-orm";
import { stockMovements } from "@db/schema";

/**
 * Номер документа за движением товара — тот, что напечатан на бумаге.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * История движений показывала «Доставка заказа №1484». Владелец: «у этого
 * арендатора нет заказа №1484, что происходит?» Не было: 1484 — внутренний
 * номер строки в таблице orders, сквозной по всем организациям. У арендатора
 * заказ зовётся ORD-01001, и это единственное имя, по которому его найдут в
 * «Заказах» и на накладной. Внутренний номер на экране — число, которое не
 * значит ничего, а выглядит как чужой заказ.
 *
 * ── Что здесь ───────────────────────────────────────────────────────────────
 *
 * Одно выражение для всех выборок истории: по типу ссылки берётся номер из
 * своей таблицы. Ссылка на заказ — order_number, на приход — arrival_number,
 * на возврат — return_number, на инвентаризацию — её номер. У перемещения
 * своего номера нет — остаётся порядковый; у возврата поставщику ссылка
 * ведёт на платёж, номера у него нет вовсе — документ называется без номера.
 * Подзапрос по первичному ключу: движение уже принадлежит арендатору, а
 * значит и документ, на который оно ссылается.
 */
export const movementReferenceNumber = sql<string | null>`CASE ${stockMovements.referenceType}
  WHEN 'order'            THEN (SELECT o.order_number FROM orders o WHERE o.id = ${stockMovements.referenceId})
  WHEN 'order_delivery'   THEN (SELECT o.order_number FROM orders o WHERE o.id = ${stockMovements.referenceId})
  WHEN 'order_return'     THEN (SELECT o.order_number FROM orders o WHERE o.id = ${stockMovements.referenceId})
  WHEN 'order_edit'       THEN (SELECT o.order_number FROM orders o WHERE o.id = ${stockMovements.referenceId})
  WHEN 'arrival'          THEN (SELECT a.arrival_number FROM arrivals a WHERE a.id = ${stockMovements.referenceId})
  WHEN 'return_completed' THEN (SELECT r.return_number FROM returns r WHERE r.id = ${stockMovements.referenceId})
  WHEN 'inventory'        THEN (SELECT c.number FROM stock_counts c WHERE c.id = ${stockMovements.referenceId})
  WHEN 'transfer_out'     THEN CAST(${stockMovements.referenceId} AS CHAR)
  WHEN 'transfer_in'      THEN CAST(${stockMovements.referenceId} AS CHAR)
  ELSE NULL END`;

/** Типы ссылок, у которых номер берётся из своей таблицы, — для стража. */
export const NUMBERED_REFERENCES = ["order", "order_delivery", "order_return", "order_edit", "arrival", "return_completed", "inventory"] as const;
