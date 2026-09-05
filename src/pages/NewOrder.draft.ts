import type { OrderItem, PaymentMethod } from "@/components/orders/types";

/**
 * Черновик набираемого заказа.
 *
 * Магазин, позиции, примечание и скидка жили только в памяти страницы. На
 * шаге «Товары» между кнопкой «Продолжить» и вкладками внизу всего 10 точек:
 * промах пальцем по «Каталогу» или «Моим заказам» — и весь набранный заказ
 * исчезал. Возврат на «Заказ» открывал пустой первый шаг, ни вопроса «уйти?»,
 * ни следа набранного. То же самое делала перезагрузка страницы и любой
 * переход по ссылке.
 *
 * Хранится у самого браузера, а не в очереди офлайн-заказов: та — для уже
 * ОФОРМЛЕННЫХ заказов, которые ждут связи, и класть туда недособранный значит
 * однажды его отправить.
 *
 * Владелец у записи по той же причине, что и в очереди
 * (OfflineOrders.helpers.ts): на складе компьютер бывает общий. Агент А набрал
 * половину заказа и вышел, вошёл агент Б — Б не должен увидеть чужой набор и
 * тем более отправить его от своего имени.
 */
export type OrderDraft = {
  shopId: number;
  shopName: string;
  items: OrderItem[];
  notes: string;
  discount: string;
  paymentMethod: PaymentMethod;
};

const KEY = "warehouse_pro_order_draft";

/** Ключ свой у каждого, кто входит на этом устройстве. */
const keyFor = (ownerId: number) => `${KEY}:${ownerId}`;

export function saveDraft(ownerId: number, draft: OrderDraft): void {
  // Хранилище бывает недоступно: приватное окно, запрет на данные сайта,
  // переполнение. Черновик — подстраховка, а не работа: из-за него нельзя
  // ронять сам экран заказа.
  try {
    localStorage.setItem(keyFor(ownerId), JSON.stringify(draft));
  } catch { /* не сохранилось — не беда */ }
}

export function loadDraft(ownerId: number): OrderDraft | null {
  try {
    const raw = localStorage.getItem(keyFor(ownerId));
    if (!raw) return null;
    const d = JSON.parse(raw) as OrderDraft;
    // Пустой черновик восстанавливать нечего и незачем: он бы лишь мешал
    // приходу с готовым магазином из карточки (/orders/new?shopId=5).
    if (!d || typeof d.shopId !== "number" || d.shopId <= 0) return null;
    if (!Array.isArray(d.items)) return null;
    return d;
  } catch {
    // Разбор не удался — значит, запись от другой версии. Молча забываем:
    // выбор в любом случае надёжнее сделать заново, чем угадывать.
    return null;
  }
}

export function clearDraft(ownerId: number): void {
  try {
    localStorage.removeItem(keyFor(ownerId));
  } catch { /* не удалилось — не беда */ }
}

/** Есть ли в черновике что терять. */
export function draftHasWork(draft: OrderDraft): boolean {
  return draft.shopId > 0 && draft.items.some(i => i.productId > 0 && Number(i.quantity) > 0);
}
