import { useMemo } from "react";
import { keepPreviousData } from "@tanstack/react-query";
import { trpc } from "@/providers/trpc";
import { lightReasonText, type ShopLight, type ShopLightColor } from "@contracts/shop-light";

/* Цвета, строка-объяснение и пакетный запрос светофора — общие для значка и карточки (ShopLight.tsx). */

export const LIGHT_TONE: Record<ShopLightColor, { fill: string; text: string; subtle: string }> = {
  red:    { fill: "var(--color-danger)",  text: "var(--color-danger-text)",  subtle: "var(--color-danger-subtle)" },
  yellow: { fill: "var(--color-warning)", text: "var(--color-warning-text)", subtle: "var(--color-warning-subtle)" },
  green:  { fill: "var(--color-success)", text: "var(--color-success-text)", subtle: "var(--color-success-subtle)" },
};

/** Одна строка-объяснение цвета: причины через «; », у зелёного — «всё в норме». */
export function lightSummary(light: ShopLight, lang: string, money: (n: number) => string): string {
  if (light.reasons.length === 0) {
    return lang === "uz" ? "Qarz me'yorida, buyurtmalar odatdagi maromda" : "Долг в норме, заказывает в своём ритме";
  }
  return light.reasons.map(r => lightReasonText(r, lang, money)).join("; ");
}

/**
 * Светофоры видимых строк списка — одним запросом (shop.lights).
 * Предыдущий ответ держится, пока идёт новый: значки не мигают при листании.
 */
export function useShopLights(shopIds: number[]): Map<number, ShopLight> {
  const ids = useMemo(() => [...new Set(shopIds)].slice(0, 500), [shopIds]);
  const { data } = trpc.shop.lights.useQuery(
    { shopIds: ids },
    { enabled: ids.length > 0, staleTime: 60_000, placeholderData: keepPreviousData, retry: false },
  );
  return useMemo(() => new Map((data ?? []).map(l => [l.shopId, l as ShopLight])), [data]);
}

