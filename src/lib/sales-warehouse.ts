import { mayChooseWarehouse, isSellableWarehouse } from "@contracts/sales-warehouse";

/**
 * Склад, по которому мастер заказа читает каталог (ADR 0012).
 *
 * Сервер оформит заказ со склада: выбранного офисом → склада агента заказа →
 * основного. Каталог шага «Товары» должен показать остаток и цену того же
 * склада, иначе офис увидит одно число, а заказ спишет с другого склада.
 * Поэтому в каталог уходят те же доводы, что уйдут в order.create:
 *   · выбран склад (только офис) — он, агент тогда ни при чём;
 *   · оформляют на другого агента — его склад решит сервер (agentId);
 *   · иначе — ничего: свой склад сервер знает сам.
 *
 * Пустой ответ у агента нарочно: ключ запроса каталога остаётся прежним
 * ({ shopId }), и общий кэш и офлайн-копия не делятся на два.
 */
export interface CatalogScope { warehouseId?: number; agentId?: number }

/** Кто оформляет заказы за другого — тот же круг, что в order.create. */
const ASSIGNERS = ["ceo", "operator", "supervisor"];

export function catalogScope(o: { role?: string; userId?: number; agentId: number; warehouseId: number }): CatalogScope {
  if (o.warehouseId > 0 && mayChooseWarehouse(o.role)) return { warehouseId: o.warehouseId };
  if (o.role && ASSIGNERS.includes(o.role) && o.agentId > 0 && o.agentId !== o.userId) return { agentId: o.agentId };
  return {};
}

/** Склады, с которых продают, — для выбора склада в заказе и у сотрудника. */
export function sellableWarehouses<W extends { status: string; isDefault: boolean; isSalesPoint?: boolean | null }>(list: W[] | undefined): W[] {
  return (list ?? []).filter(isSellableWarehouse);
}

export { mayChooseWarehouse };
