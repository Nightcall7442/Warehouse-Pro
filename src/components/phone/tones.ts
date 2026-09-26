import type { CSSProperties } from "react";
import { ORDER_STATUS_LABEL, DELIVERY_STATUS_LABEL, PLAN_STATUS_LABEL, labelled, type Lang } from "@contracts/entity-labels";
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
export type Tone = "muted" | "info" | "warning" | "success" | "danger";

/** Заливка (точка, подложка) и текст одной роли. У «тихого» они совпадают. */
export function tone(k: Tone) {
  return k === "muted"
    ? { fill: "var(--color-text-tertiary)", text: "var(--color-text-tertiary)" }
    : { fill: `var(--color-${k})`, text: `var(--color-${k}-text)` };
}

const DELIVERY_TONE: Record<string, Tone> = {
  not_assigned: "muted", assigned: "info", out_for_delivery: "warning", delivered: "success", failed: "danger",
};
const PLAN_TONE: Record<string, Tone> = { visited: "success", skipped: "warning", planned: "info" };

export function orderTone(status: string) {
  const c = STATUS[status]?.dot ?? "var(--color-text-tertiary)";
  return { dot: c, text: c };
}
export const orderStatusWord = (status: string, lang: Lang) => labelled(ORDER_STATUS_LABEL, status, lang);

export function deliveryTone(status: string) {
  const { fill, text } = tone(DELIVERY_TONE[status] ?? "muted");
  return { dot: fill, text };
}
export const deliveryStatusWord = (status: string, lang: Lang) => labelled(DELIVERY_STATUS_LABEL, status, lang);

/** Состояние визита — один вид на «Моём дне» и в «Плане»; подпись из общего словаря. */
export function planStatus(status: string, lang: Lang) {
  return { ...tone(PLAN_TONE[status] ?? "info"), label: labelled(PLAN_STATUS_LABEL, status, lang) };
}
