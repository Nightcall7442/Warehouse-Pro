import { TrendingUp, TrendingDown, ArrowUpDown } from "lucide-react";

export const MOVE_TYPE: Record<string, { icon: React.ComponentType<{ size?: number; color?: string }>; labelRu: string; labelUz: string; color: string; sign: string }> = {
  in:         { icon: TrendingUp,   labelRu: "Приход",       labelUz: "Kirim",       color: "#34c473", sign: "+" },
  out:        { icon: TrendingDown,  labelRu: "Расход",       labelUz: "Chiqim",      color: "#e85050", sign: "−" },
  adjustment: { icon: ArrowUpDown,  labelRu: "Корректировка", labelUz: "Tuzatish",   color: "#e8a830", sign: "±" },
};

export const UNIT_LABELS: Record<string, [string, string]> = {
  kg: ["кг", "kg"], l: ["л", "l"], pcs: ["шт", "dona"],
  box: ["ящ", "quti"], pack: ["упак", "pachka"], m: ["м", "m"],
};

export function unitLabel(unit: string | undefined, lang: "ru" | "uz"): string {
  const e = UNIT_LABELS[unit ?? "pcs"];
  return e ? (lang === "uz" ? e[1] : e[0]) : (unit ?? "шт");
}

/** Convert stock quantity to kg using unitWeight. If unitWeight=0, assume already in kg */
export function toKg(stock: number | string, unitWeight: number | string | null): number {
  const qty = Number(stock ?? 0);
  const w = Number(unitWeight ?? 0);
  return w > 0 ? qty * w : qty;
}
