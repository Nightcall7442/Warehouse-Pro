import { useCallback, type MouseEvent } from "react";
import { useNavigate } from "react-router";

/**
 * Обычная ссылка сайта (<a href="/register?utm_source=…">), которая при
 * обычном нажатии переходит внутри приложения, без перезагрузки.
 *
 * Кнопки «Начать» были <button onClick={navigate("/register")}>: у них нет
 * адреса — ни открыть в новой вкладке, ни скопировать, ни передать с ним
 * метки рекламы. Ссылкой они стали ради адреса (lib/attribution,
 * withAttribution), но голая ссылка перезагружала бы всё приложение на
 * каждом нажатии. Здесь обычное нажатие — переход роутера; с Ctrl, Cmd,
 * Shift, колёсиком или на чужой сайт — как у браузера.
 */
export function useSiteLinkClick() {
  const navigate = useNavigate();
  return useCallback((e: MouseEvent<HTMLAnchorElement>) => {
    const a = e.currentTarget;
    const href = a.getAttribute("href") ?? "";
    if (!href.startsWith("/") || href.startsWith("//")) return;
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (a.target && a.target !== "_self") return;
    e.preventDefault();
    navigate(href);
  }, [navigate]);
}
