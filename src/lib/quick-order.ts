import { useSyncExternalStore } from "react";

/**
 * Быстрый заказ — из любого места приложения.
 *
 * Окно быстрого заказа жило только на странице «Заказы»: чтобы начать заказ
 * магазину, оператор уходил из его карточки, искал магазин заново и набирал
 * позиции, которые только что видел в прошлом заказе. Горячая клавиша N вела
 * и вовсе мимо — в телефонный мастер /orders/new, хотя офис по руководству
 * работает быстрым заказом.
 *
 * Здесь — одна точка: кто угодно открывает окно со стартовыми данными
 * (магазин, строки повтора), а рисует его QuickOrderHost, который стоит один
 * на всё приложение (App.tsx). Состояние — модульное, а не контекст: открыть
 * окно нужно и из обработчика клавиш, где React-дерева под рукой нет.
 *
 * Страница «Заказы» держит своё окно как держала — её не трогаем.
 */

/** Строка корзины быстрого заказа. */
export interface QuickOrderLine {
  productId: number;
  name: string;
  code: string;
  unitPrice: number;
  quantity: number;
  /** Свободно на основном складе в момент повтора — пока каталог не ответил. */
  available?: number;
}

export interface QuickOrderStart {
  /** Магазин выбран заранее — из карточки магазина или повторяемого заказа. */
  shop?: { id: number; name: string };
  lines?: QuickOrderLine[];
  /** Чего в повторе нет: товар сняли с продажи. Показывается пометкой. */
  skipped?: Array<{ name: string; quantity: string }>;
  /** Номер повторяемого заказа — для подписи окна. */
  repeatOf?: string;
}

/** Открытое окно: стартовые данные и номер показа — новое открытие начинает с чистого листа. */
export type QuickOrderSession = QuickOrderStart & { key: number };

let session: QuickOrderSession | null = null;
let shown = 0;
const listeners = new Set<() => void>();
const emit = () => { for (const l of listeners) l(); };

export function openQuickOrder(start: QuickOrderStart = {}): void {
  session = { ...start, key: ++shown };
  emit();
}

export function closeQuickOrder(): void {
  if (!session) return;
  session = null;
  emit();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

export function useQuickOrderSession(): QuickOrderSession | null {
  return useSyncExternalStore(subscribe, () => session, () => null);
}

/**
 * Кто работает быстрым заказом: офис — руководитель, оператор, супервайзер.
 *
 * Те же роли, что оформляют заказ за другого (NewOrder, canAssign), и те, у
 * кого «Новый заказ» на главной ведёт в это окно. Агенту и мерчандайзеру —
 * мастер /orders/new: он свёрстан под телефон, с которым они и ходят.
 */
export function usesQuickOrder(role: string | undefined): boolean {
  return role === "ceo" || role === "operator" || role === "supervisor";
}
