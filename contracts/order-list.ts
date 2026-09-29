/*
  Список заказов: чем его можно отсортировать и по сколько строк показать.

  Читают двое: сервер (белый список во входе order.list) и экран «Заказы»
  (заголовки столбцов, адрес страницы). Копия на одной из сторон разъехалась
  бы с другой при первой правке — и столбец, который экран предлагает,
  сервер отвергал бы ошибкой, а ссылка с ним открывала бы страницу отказа.
*/

/** Столбцы, по которым сортирует сервер. Первый — как было всегда. */
export const ORDER_SORT_KEYS = ["createdAt", "total", "shopName", "deliveredAt", "courierName", "status"] as const;
export type OrderSortKey = typeof ORDER_SORT_KEYS[number];

export const ORDER_SORT_DIRS = ["desc", "asc"] as const;
export type OrderSortDir = typeof ORDER_SORT_DIRS[number];

/** Строк на странице — выбор оператора. Первое — как было всегда. */
export const ORDER_PAGE_SIZES = [25, 50, 100] as const;
