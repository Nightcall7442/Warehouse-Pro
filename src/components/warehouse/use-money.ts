import { useCallback } from "react";
import { useCurrency } from "@/hooks/useCurrency";

const NBSP = String.fromCharCode(160);

/**
 * Деньги, которые не рвутся между строками: «2 006 400 сум» целиком.
 *
 * fmt ставит между разрядами неразрывный пробел, а перед «сум» — обычный, и
 * в длинной фразе («…а так вернётся 2 006 400 сум») название валюты уезжало
 * на следующую строку отдельно от числа. Здесь обычных пробелов не остаётся.
 */
export function useMoney(): (amount: string | number | null | undefined) => string {
  const { fmt } = useCurrency();
  return useCallback((amount) => fmt(amount).replace(/ /g, NBSP), [fmt]);
}
