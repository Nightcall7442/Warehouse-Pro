import { urlEnum } from "@/hooks/useUrlState";
import type { MarginDim, MarginRow } from "@contracts/margin";

/** Сортировка и разрез раздела «Прибыль» — из адреса (?by=…&sort=…&dir=…). */
export type ProfitSort = "name" | "revenue" | "cost" | "profit" | "margin" | "share";
const SORTS: readonly ProfitSort[] = ["revenue", "name", "cost", "profit", "margin", "share"];
export const SORT_CODEC = urlEnum<ProfitSort>(SORTS, "revenue");
export const DIR_CODEC = urlEnum<"asc" | "desc">(["desc", "asc"], "desc");
export const BY_CODEC = urlEnum<MarginDim>(["product", "shop", "agent"], "product");

/** Сортировка строк — по столбцу из адреса. Пустые проценты — в конец при любом направлении. */
export function sortMarginRows(rows: readonly MarginRow[], sort: ProfitSort, dir: "asc" | "desc"): MarginRow[] {
  const sign = dir === "asc" ? 1 : -1;
  const val = (r: MarginRow): number | string | null => {
    switch (sort) {
      case "name": return r.name;
      case "revenue": return r.revenue;
      case "cost": return r.cost;
      case "profit": return r.profit;
      case "margin": return r.marginPct;
      case "share": return r.profitShare;
    }
  };
  return [...rows].sort((a, b) => {
    const x = val(a), y = val(b);
    if (x == null && y == null) return a.name.localeCompare(b.name, "ru");
    if (x == null) return 1;
    if (y == null) return -1;
    const c = typeof x === "string" ? x.localeCompare(String(y), "ru") : x - (y as number);
    return c * sign || a.name.localeCompare(b.name, "ru");
  });
}

