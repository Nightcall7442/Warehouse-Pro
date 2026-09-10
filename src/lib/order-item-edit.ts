/* ═══════════════════════════════════════════════════════════════════════════
   Правка состава заказа: строки экрана → то, что понимает сервер.

   ── Зачем отдельный файл ────────────────────────────────────────────────────

   Правило одно, а экранов теперь два: панель заказа у оператора
   (OrderSlideOver) и карточка заказа, где состав правит в том числе агент
   (OrderDetail). Разъезжается здесь ровно одно место — УБРАННЫЕ строки.

   Сервер не знает, что строку выкинули: он видит только присланный список, а
   всё, чего в нём нет, оставляет как было («Lines the caller did not mention
   stay as they are» — services/order.ts). То есть просто не прислать строку —
   значит НЕ удалить её, а молча сохранить: товар остался бы в заказе, деньги
   в сумме, а резерв на складе. Удаление выражается количеством ноль.

   Забыть это во второй копии — вопрос времени, поэтому копия одна.
   ═══════════════════════════════════════════════════════════════════════════ */

/** Строка в редакторе. Без itemId — новая, ещё не существующая в заказе. */
export interface EditLine {
  /** Ключ для React: у новой строки идентификатора позиции ещё нет. */
  key: string;
  itemId?: number;
  productId: number;
  productName: string;
  /* Строками, а не числами: пока человек набирает, поле может быть пустым или
     содержать запятую, и приводить это к числу на каждом нажатии значит
     дёргать курсор. Разбор — один раз, при отправке. */
  quantity: string;
  unitPrice: string;
}

/** Позиция заказа, как её отдаёт сервер. */
export interface OrderLine {
  id: number;
  productId: number;
  productName?: string | null;
  quantity: string | number;
  unitPrice: string | number;
  /*
    Единица измерения товара: штуки, литры, ящики.

    Подставлять «шт» всем подряд нельзя — у товара, который продают литрами,
    это прямая ложь в накладной, а количество человек вводит рядом.
  */
  unit?: string | null;
}

/** Что уходит в order.updateItems. */
export type ItemPayload =
  | { itemId: number; quantity: number; unitPrice?: string }
  | { productId: number; quantity: number; unitPrice?: string };

/** Разложить заказ в строки редактора. */
export function linesFromOrder(items: OrderLine[]): EditLine[] {
  return items.map(i => ({
    key: `item-${i.id}`,
    itemId: i.id,
    productId: i.productId,
    productName: i.productName ?? "",
    quantity: String(Number(i.quantity)),
    unitPrice: String(Number(i.unitPrice)),
  }));
}

/**
 * Собрать запрос: изменённые и новые строки плюс НУЛИ на выброшенные.
 *
 * `original` нужен именно для нулей: без него удаление не выражается никак.
 */
export function linesToPayload(original: OrderLine[], edited: EditLine[]): ItemPayload[] {
  const kept = new Set(edited.map(l => l.itemId).filter((id): id is number => id !== undefined));

  const changed: ItemPayload[] = edited.map(l =>
    l.itemId !== undefined
      ? { itemId: l.itemId, quantity: Number(l.quantity), unitPrice: l.unitPrice }
      : { productId: l.productId, quantity: Number(l.quantity), unitPrice: l.unitPrice },
  );

  // Ноль — это и есть «удалить»: сервер по нему снимает резерв и убирает
  // строку. Просто промолчать о ней значит оставить её в заказе.
  const removed: ItemPayload[] = original
    .filter(o => !kept.has(o.id))
    .map(o => ({ itemId: o.id, quantity: 0 }));

  return [...changed, ...removed];
}

/**
 * Что не так со строками — одним сообщением или ничего.
 *
 * Проверки здесь те же, что у сервера, и стоят до отправки не вместо него, а
 * чтобы человек не ждал ответа ради «количество должно быть больше нуля».
 */
export function validateLines(edited: EditLine[]): string | null {
  if (edited.length === 0) return "В заказе должна остаться хотя бы одна позиция";
  if (edited.some(l => !(Number(l.quantity) > 0))) return "Количество должно быть больше нуля";
  if (edited.some(l => !Number.isFinite(Number(l.unitPrice)) || Number(l.unitPrice) < 0)) {
    return "Цена не может быть отрицательной";
  }
  /*
    Тот же товар второй строкой сервер отвергает: резерв по заказу собирается
    одним UPDATE с `CASE WHEN product_id = ...`, и MySQL берёт первый совпавший
    — вторая строка молча не резервировалась бы. Сказать это здесь дешевле, чем
    получить отказ после сохранения.
  */
  const seen = new Set<number>();
  for (const l of edited) {
    if (seen.has(l.productId)) return "Один товар — одна строка: измените количество, а не добавляйте вторую";
    seen.add(l.productId);
  }
  return null;
}
