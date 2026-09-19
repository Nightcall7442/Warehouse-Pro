import { useLayoutEffect, useRef } from "react";
import { useLocation, useNavigationType } from "react-router";

/*
  Новая страница открывается с начала.

  Приложение — одна страница, и переход по меню не перезагружает окно:
  прокрутка остаётся той, что была. Пролистал «Товары» до конца, нажал
  «Настройки» — «Настройки» открылись внизу (владелец, 19.09.2026: «некоторые
  страницы открываются в конце, а настройки всегда снизу»).

  Кнопка «назад» — исключение: там браузер сам возвращает место, где человек
  был, и это правильно (вернулся в список — туда, откуда ушёл). Смена только
  запроса (?tab=, ?section=) — это вкладка на той же странице, прокрутку не
  трогаем.
*/
export function ScrollToTop() {
  const { pathname } = useLocation();
  const type = useNavigationType();
  // Прежний путь — чтобы смена одного лишь запроса или способа перехода
  // (replace вместо push) не считалась новой страницей.
  const last = useRef(pathname);
  useLayoutEffect(() => {
    const changed = last.current !== pathname;
    last.current = pathname;
    if (!changed || type === "POP") return;
    window.scrollTo(0, 0);
  }, [pathname, type]);
  return null;
}
