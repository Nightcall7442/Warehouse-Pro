import type { CSSProperties } from "react";
import { ORDER_STATUS_LABEL, DELIVERY_STATUS_LABEL } from "@contracts/entity-labels";
import { STATUS } from "@/components/orders/theme-tokens";

/** Белая карточка мобилки v8: поверхность, мягкая тень (линия в тёмной). */
export const CARD: CSSProperties = { background: "var(--color-surface)", boxShadow: "var(--shadow-raised)" };

/*
  Цвет состояния заказа — тот же, что на экране заказов веба
  (components/orders/theme-tokens.ts, STATUS): один словарь на оба вида, иначе
  заказ в списке и на главной окажется разного цвета. Доставка — своими
  ролями: ждёт — тихий, назначена — синий, в пути — жёлтый, довезена —
  зелёный, не удалась — красный (как у курьера в мобилке).
*/
const DELIVERY_TONE: Record<string, "muted" | "info" | "warning" | "success" | "danger"> = {
  not_assigned: "muted", assigned: "info", out_for_delivery: "warning", delivered: "success", failed: "danger",
};
const FILL = { warning: "var(--color-warning)", info: "var(--color-info)", success: "var(--color-success)", danger: "var(--color-danger)", muted: "var(--color-text-tertiary)" };
const TEXT = { warning: "var(--color-warning-text)", info: "var(--color-info-text)", success: "var(--color-success-text)", danger: "var(--color-danger-text)", muted: "var(--color-text-tertiary)" };

export function orderTone(status: string) {
  const c = STATUS[status]?.dot ?? "var(--color-text-tertiary)";
  return { dot: c, text: c };
}
export function orderStatusWord(status: string, lang: "ru" | "uz"): string {
  const l = ORDER_STATUS_LABEL[status as keyof typeof ORDER_STATUS_LABEL];
  return l ? l[lang] : status;
}
export function deliveryTone(status: string) {
  const k = DELIVERY_TONE[status] ?? "muted";
  return { dot: FILL[k], text: TEXT[k] };
}
export function deliveryStatusWord(status: string, lang: "ru" | "uz"): string {
  const l = DELIVERY_STATUS_LABEL[status as keyof typeof DELIVERY_STATUS_LABEL];
  return l ? l[lang] : status;
}
