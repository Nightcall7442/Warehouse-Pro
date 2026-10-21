import { createContext, useContext } from "react";

/**
 * Рисуется ли страница заранее, при сборке (src/site/entry-server.tsx).
 *
 * Готовый HTML читает робот и видит человек до загрузки скрипта. Тяжёлое и
 * чисто декоративное (поле ячеек — 1 536 узлов SVG, 181 КБ разметки)
 * рисуется в нём пустым местом того же размера: текст не прыгает, а браузер
 * не разбирает лишнего. Скрипт заменяет страницу настоящей целиком.
 */
export const PrerenderContext = createContext(false);

export function usePrerender(): boolean {
  return useContext(PrerenderContext);
}
