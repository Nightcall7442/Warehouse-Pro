import type { LucideIcon } from "lucide-react";
import { TrendingUp, TrendingDown, ArrowUpDown } from "lucide-react";

// Иконки здесь — lucide, и вызывающий передаёт им style. Рукописный тип
// разрешал только size и color, поэтому MovementHistory не компилировался.
export const MOVE_TYPE: Record<string, { icon: LucideIcon; labelRu: string; labelUz: string; color: string; sign: string }> = {
  in:         { icon: TrendingUp,   labelRu: "Приход",       labelUz: "Kirim",       color: "var(--color-success-text)", sign: "+" },
  out:        { icon: TrendingDown,  labelRu: "Расход",       labelUz: "Chiqim",      color: "var(--color-danger-text)", sign: "−" },
  adjustment: { icon: ArrowUpDown,  labelRu: "Корректировка", labelUz: "Tuzatish",   color: "var(--color-warning-text)", sign: "±" },
};

// Общий список единиц — src/lib/units.ts.
export { UNIT_LABELS } from "@/lib/units";
export { unitShort as unitLabel } from "@/lib/units";

/** Convert stock quantity to kg using unitWeight. If unitWeight=0, assume already in kg */
export function toKg(stock: number | string, unitWeight: number | string | null): number {
  const qty = Number(stock ?? 0);
  const w = Number(unitWeight ?? 0);
  return w > 0 ? qty * w : qty;
}
