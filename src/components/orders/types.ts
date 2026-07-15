import { Banknote, ArrowRightLeft, AlertTriangle, CreditCard } from "lucide-react";

export type PaymentMethod = "cash" | "transfer" | "debt" | "card";

export interface OrderItem {
  productId: number;
  quantity: string;
  unitPrice: string;
  productName: string;
  available: string;
  unit: string;
  unitWeight: number;
}

export const PAYMENT_METHODS: Record<PaymentMethod, { ru: string; uz: string; icon: typeof Banknote; color: string }> = {
  cash:     { ru: "Наличные",    uz: "Naqd",          icon: Banknote,      color: "#34c473" },
  transfer: { ru: "Перечисление", uz: "O'tkazma",      icon: ArrowRightLeft, color: "#4b6cf6" },
  debt:     { ru: "Долг",        uz: "Qarz",          icon: AlertTriangle, color: "#e8a830" },
  card:     { ru: "Карта",       uz: "Plastik karta", icon: CreditCard,    color: "#9b59b6" },
};

export const UNIT_LABELS: Record<string, { ru: string; uz: string; short: string }> = {
  kg:   { ru: "кг",      uz: "kg",   short: "кг" },
  l:    { ru: "литр",    uz: "litr", short: "л" },
  pcs:  { ru: "шт",      uz: "dona", short: "шт" },
  box:  { ru: "ящ",      uz: "quti", short: "ящ" },
  pack: { ru: "упак",    uz: "pach", short: "упак" },
  m:    { ru: "метр",    uz: "metr", short: "м" },
};

export function unitLabel(unit: string | undefined, lang: "ru" | "uz"): string {
  const e = UNIT_LABELS[unit ?? "pcs"];
  return e ? (lang === "uz" ? e.uz : e.ru) : (unit ?? "шт");
}

export const EMPTY_ITEM: OrderItem = {
  productId: 0, quantity: "", unitPrice: "",
  productName: "", available: "0", unit: "pcs", unitWeight: 0,
};
