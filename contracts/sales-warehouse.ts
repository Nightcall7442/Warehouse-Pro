/**
 * Склад продажи (ADR 0012) — правила, общие для сервера и экрана.
 *
 * Сервер решает склад заказа и каталога этими правилами
 * (api/services/sales-warehouse.ts); экран по ним же решает, показывать ли
 * выбор склада и какие склады в нём. Разойдись они — кнопка обещала бы то,
 * в чём сервер откажет уже после разговора с магазином.
 */

/** Кто вправе выбрать склад заказа сам: офис. Полевым склад назначает директор. */
export const WAREHOUSE_CHOOSERS = ["ceo", "operator"] as const;

export const mayChooseWarehouse = (role: string | null | undefined): boolean =>
  !!role && (WAREHOUSE_CHOOSERS as readonly string[]).includes(role);

/**
 * С этого склада продают: действующий, основной или отмеченный «точкой
 * продаж». Склад хранения и отключённый — нет. Сервер проверяет то же самое
 * условием sellableWarehouse.
 */
export function isSellableWarehouse(w: { status: string; isDefault: boolean | number; isSalesPoint?: boolean | number | null }): boolean {
  return w.status === "active" && (Boolean(w.isDefault) || Boolean(w.isSalesPoint));
}
