/**
 * Оформление экрана заказов: цвета, тени, подписи статусов и способов оплаты.
 *
 * Вынесено из theme.tsx, где лежало вперемешку с компонентами. Пока в одном
 * файле и то и другое, горячая перезагрузка при правке не может обновить
 * экран без полной перезагрузки страницы — а с ней теряются открытые окна и
 * наполовину заполненные формы.
 */
/**
 * Shared design tokens for the Orders surface (page, slide-over, modals,
 * kanban). Lifted from the original "Premium Design" pass on Orders.tsx
 * (pre-dates the Mimo-era components) so every order-related screen speaks
 * the same visual language instead of each new component inventing its own.
 */
import type { Order } from "@contracts/types";
import { ORDER_STATUS_LABEL, PAYMENT_METHOD_LABEL, type Label } from "@/lib/entity-labels";

type OrderStatus = Order["status"];
type PaymentMethod = NonNullable<Order["paymentMethod"]>;

export const F = { display: "'DM Sans', -apple-system, sans-serif", body: "'DM Sans', -apple-system, sans-serif" };

export const COLORS = {
  // Reads the themed accent so the dark palette isn't stuck with the light one.
  primary: "var(--color-primary)",
  // Accent-coloured *text* (a price, a code, a link). The fill colour above
  // is a hair under 4.5:1 as text on a light card, so semantic text uses
  // this darker sibling instead. See --color-primary-text in index.css.
  primaryText: "var(--color-primary-text)",
  onPrimary: "var(--color-text-inverse, #ffffff)",
  primarySubtle: "var(--color-primary-subtle)",
  success: "var(--color-success)",
  warning: "var(--color-warning)", danger: "var(--color-danger)",
  // Same fill-vs-text split as primary above: the fill colours are too pale
  // to read as text on a light card.
  successText: "var(--color-success-text)",
  warningText: "var(--color-warning-text)",
  dangerText: "var(--color-danger-text)",
  surface: "var(--color-surface, #efedea)", surfaceLight: "var(--color-surface-light, #f6f4f0)",
  textPrimary: "var(--color-text-primary, #2b2a28)", textSecondary: "var(--color-text-secondary, #5e5b54)",
  textTertiary: "var(--color-text-tertiary, #6b6760)", border: "var(--color-border, #d8d5cd)",
};

export const SHADOW = "var(--shadow-sm, 0 1px 3px rgba(0,0,0,.06), 0 1px 2px rgba(0,0,0,.04))";

/** Statuses where the goods have not been handed over yet — these can still be completed. */
export const OPEN_STATUSES = ["new", "processing", "shipped", "pending"];

/*
  Слово и оформление.

  Слово берётся из общего словаря (src/lib/entity-labels.ts) — того же, из
  которого его берут сводка, карточка магазина, поиск и выгрузки. Раньше здесь
  лежала собственная копия, и она разошлась с остальными: «Отгружён» против
  «Отгружен», «Возврат» против «Возвращён». Один заказ на двух экранах
  назывался по-разному.

  Здесь остаётся оформление: цвет точки и классы плашки. Форма таблицы не
  изменилась, поэтому пятнадцать мест вызова остались как были.
*/
type StatusStyle = { dot: string; bg: string; text: string; border: string };

const STATUS_STYLE: Record<OrderStatus, StatusStyle> = {
  new:        { dot: "var(--color-primary)", bg: "bg-info/10",    text: "text-info",       border: "border-info/25" },
  processing: { dot: "var(--color-warning)", bg: "bg-warning/10", text: "text-warning",    border: "border-warning/25" },
  shipped:    { dot: "#9b59b6",              bg: "bg-purple-100", text: "text-purple-600", border: "border-purple-200" },
  pending:    { dot: "#f09050",              bg: "bg-orange-100", text: "text-orange-600", border: "border-orange-200" },
  delivered:  { dot: "var(--color-success)", bg: "bg-success/10", text: "text-success",    border: "border-success/25" },
  cancelled:  { dot: "var(--color-danger)",  bg: "bg-danger/10",  text: "text-danger",     border: "border-danger/25" },
  returned:   { dot: "#e85050",              bg: "bg-red-100",    text: "text-red-600",    border: "border-red-200" },
};

const PAYMENT_COLOR: Record<PaymentMethod, string> = {
  cash:     "var(--color-success-text)",
  transfer: "var(--color-primary-text)",
  debt:     "var(--color-warning-text)",
  card:     "#9b59b6",
};

export const PAYMENT: Record<string, Label & { color: string }> =
  Object.fromEntries(
    (Object.keys(PAYMENT_COLOR) as PaymentMethod[])
      .map(k => [k, { ...PAYMENT_METHOD_LABEL[k], color: PAYMENT_COLOR[k] }]),
  );

export const STATUS: Record<string, Label & StatusStyle> =
  Object.fromEntries(
    (Object.keys(STATUS_STYLE) as OrderStatus[])
      .map(k => [k, { ...ORDER_STATUS_LABEL[k], ...STATUS_STYLE[k] }]),
  );
