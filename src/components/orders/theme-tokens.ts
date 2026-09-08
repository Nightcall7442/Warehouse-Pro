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
/*
  Цвет статуса.

  Поле было одно из четырёх: рядом с `dot` лежали `bg`, `text` и `border` —
  классы Tailwind вида `bg-purple-100 text-purple-600`. Их не читал НИКТО: все
  пятнадцать мест вызова берут только `dot` и разводят из него и заливку
  (colorMix), и рамку. Толку от трёх полей не было, а вред был: они называли
  цвета из палитры Tailwind, которой у нас нет. `purple-100` не меняется от
  темы вовсе, и в тёмной остался бы светло-сиреневым пятном.

  Сиреневый и оранжевый литералы у `shipped` и `pending` — из той же истории:
  цвета, взятые не из палитры приложения, а «на глаз». В тёмной теме они
  оставались прежними, а рядом с золотым фирменным читались как чужие. Ровно на
  них и указали: «дешёвая фиолетовая линия».

  Теперь у каждого статуса один цвет и он из палитры. Все они — «текстовые»
  варианты: цвет служит и точкой, и подписью, а подпись обязана читаться.
*/
type StatusStyle = { dot: string };

const STATUS_STYLE: Record<OrderStatus, StatusStyle> = {
  // Пришёл, ещё наш — фирменный.
  new:        { dot: "var(--color-primary-text)" },
  // Взяли в работу.
  processing: { dot: "var(--color-warning-text)" },
  // Уехал — синий «в пути», а не сиреневый ниоткуда.
  shipped:    { dot: "var(--color-info-text, var(--color-info))" },
  // Ждёт: сейчас ничего не происходит, кричать не о чем.
  pending:    { dot: "var(--color-text-secondary)" },
  delivered:  { dot: "var(--color-success-text)" },
  /*
    Отменён приглушён, возвращён — красный.

    Раньше оба были красными, и на экране две разные истории выглядели одной
    бедой. Отменённый заказ просто не состоялся; возвращённый — состоялся,
    поехал и вернулся, и вот с ним действительно надо разбираться.
  */
  cancelled:  { dot: "var(--color-text-tertiary)" },
  returned:   { dot: "var(--color-danger-text)" },
};

const PAYMENT_COLOR: Record<PaymentMethod, string> = {
  cash:     "var(--color-success-text)",
  transfer: "var(--color-primary-text)",
  debt:     "var(--color-warning-text)",
  // Был сиреневый литерал — тот же, что у «Отгружен», и с той же бедой.
  card:     "var(--color-info-text, var(--color-info))",
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
