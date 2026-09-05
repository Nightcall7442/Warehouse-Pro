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
  cash:     { ru: "Наличные",    uz: "Naqd",          icon: Banknote,      color: "var(--color-success-text)" },
  transfer: { ru: "Перечисление", uz: "O'tkazma",      icon: ArrowRightLeft, color: "var(--color-primary-text)" },
  debt:     { ru: "Долг",        uz: "Qarz",          icon: AlertTriangle, color: "var(--color-warning-text)" },
  card:     { ru: "Карта",       uz: "Plastik karta", icon: CreditCard,    color: "#9b59b6" },
};

/*
  Рядом с числом нужна короткая подпись: «12 шт», а не «12 штук».
  Сам список — общий, в src/lib/units.ts.
*/
export { UNIT_LABELS } from "@/lib/units";
export { unitShort as unitLabel } from "@/lib/units";

export const EMPTY_ITEM: OrderItem = {
  productId: 0, quantity: "", unitPrice: "",
  productName: "", available: "0", unit: "pcs", unitWeight: 0,
};
