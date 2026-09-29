import { useMemo } from "react";
import { keepPreviousData } from "@tanstack/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../api/router";
import { trpc } from "@/providers/trpc";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";

type ShopRow = inferRouterOutputs<AppRouter>["agent"]["availableShops"][number];
/** Выбранный магазин: его может не быть в текущем ответе, но показать его надо. */
export type PickedShop = Pick<ShopRow, "id" | "name"> & Partial<ShopRow>;

/** Сколько магазинов приходит на один запрос пикера: дальше человек уточняет поиск. */
export const SHOP_PICK_LIMIT = 30;

/**
 * Магазины для выбора — поиском на сервере, а не фильтром по загруженному.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Окно быстрого заказа, первый шаг мастера, фильтр отчётов и расписание
 * визитов грузили N самых НОВЫХ магазинов (200–500) и искали в них у себя. У
 * организации с тремя с половиной тысячами точек старые — то есть основные —
 * клиенты не находились никак, а поиск по телефону не работал вовсе, хотя
 * сервер по телефону ищет.
 *
 * ── Что теперь ──────────────────────────────────────────────────────────────
 *
 * Строка поиска уходит на сервер (agent.availableShops: название, владелец,
 * телефон, район, город), с задержкой набора, окном в SHOP_PICK_LIMIT строк.
 * Этот маршрут открыт всем, кто оформляет заказ (руководитель, оператор,
 * супервайзер, агент, мерчендайзер), и отдаёт ровно то, что раньше видел
 * каждый из них: действующие магазины своей организации.
 *
 * `pinned` — выбранный магазин: если нового ответа на него нет, он всё равно
 * стоит первым, иначе выбор пропадал бы с экрана при следующей букве.
 */
export function useShopSearch(search: string, opts: { enabled?: boolean; limit?: number; pinned?: PickedShop | null } = {}) {
  const limit = opts.limit ?? SHOP_PICK_LIMIT;
  const term = useDebouncedValue(search.trim());
  const q = trpc.agent.availableShops.useQuery(
    { search: term || undefined, limit },
    { enabled: opts.enabled ?? true, placeholderData: keepPreviousData },
  );
  const pinned = opts.pinned;
  const shops = useMemo<PickedShop[]>(() => {
    const found = q.data ?? [];
    return pinned && !found.some(s => s.id === pinned.id) ? [pinned, ...found] : found;
  }, [q.data, pinned]);
  return {
    shops,
    isLoading: q.isLoading,
    /** Ответ упёрся в окно: есть ещё, надо уточнить поиск. */
    more: (q.data?.length ?? 0) >= limit,
  };
}
