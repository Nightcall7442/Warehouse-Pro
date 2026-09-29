import { useEffect } from "react";
import { useNavigate } from "react-router";
import { openQuickOrder, usesQuickOrder } from "@/lib/quick-order";

/**
 * Поле, куда «/» ставит каретку, — помечено атрибутом.
 *
 * Искалось по тексту подсказки: input[placeholder*="Поиск"] и ещё три
 * написания. По-узбекски подсказки пишутся со строчной — «Buyurtma
 * qidirish…», — и под «Qidirish» с заглавной не подходила ни одна: «/» в
 * узбекском интерфейсе всегда открывал палитру вместо поиска страницы. А у
 * поиска магазинов («Название, владелец, телефон…») слова «Поиск» нет ни на
 * одном языке. Текст подсказки — дело перевода, а не клавиатуры; атрибут от
 * языка не зависит. Ставится на поле поиска страницы (SearchInput — сам).
 */
export const HOTKEY_SEARCH_ATTR = "data-hotkey-search";

function isInputFocused() {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    (el as HTMLElement).isContentEditable
  );
}

/**
 * Открыто ли поверх страницы модальное окно.
 *
 * Проверка идёт по разметке, а не по фокусу, и это принципиально. Фокус
 * внутри окна может стоять где угодно: на панели, на кнопке, а после клика по
 * затемнению — вообще на body. Ни один из этих случаев не INPUT, поэтому
 * isInputFocused отвечал «нет» и клавиши срабатывали.
 *
 * Признак aria-modal ставят и AppModal, и диалоги Radix — то есть одна
 * проверка накрывает все окна приложения разом, включая те, что появятся
 * потом.
 */
function isModalOpen(): boolean {
  return document.querySelector('[aria-modal="true"]') !== null;
}

/**
 * Должны ли клавиши-сокращения молчать прямо сейчас.
 *
 * Вынесено отдельной функцией, чтобы проверять её на настоящем DOM: сам хук
 * без роутера не поднять, а вся суть поломки — здесь.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Проверялся только фокус, и только на INPUT, TEXTAREA и contentEditable.
 * AppModal при открытии ставит фокус на свою панель — это div с tabIndex=-1.
 * Значит сразу после открытия ЛЮБОГО окна нажатие «n» проходило проверку и
 * уводило на /orders/new: приложение меняло страницу, а окно вместе с
 * набранным исчезало. Тот же эффект после клика по любой кнопке внутри окна —
 * фокус оказывался на BUTTON.
 *
 * Клавиша «/» вела себя не лучше: она искала поле поиска по всей странице и
 * ставила каретку в поле, лежащее ПОД открытым окном.
 *
 * Escape сюда не попадает намеренно: он для того и нужен, чтобы окна
 * закрывать.
 */
export function areHotkeysBlocked(key: string): boolean {
  if (key === "Escape") return false;
  return isInputFocused() || isModalOpen();
}

/*
  Клавиша — по месту на клавиатуре (e.code), а не по букве (e.key).

  Сравнивалось e.key с латиницей. В офисе стоит русская раскладка: там N
  даёт «т», Ctrl+K — «л», а «/» и вовсе на другой клавише (на её месте
  «.»). Ни одно сокращение не срабатывало, пока человек не переключит язык, —
  а переключать его ради клавиши никто не станет. e.code называет клавишу,
  а не символ, и одинаков в любой раскладке; латинская буква оставлена
  вторым признаком — для раскладок, где N стоит в другом месте.
*/
export function isNewOrderKey(e: Pick<KeyboardEvent, "code" | "key">): boolean {
  return e.code === "KeyN" || e.key === "n" || e.key === "N";
}

export function isSearchKey(e: Pick<KeyboardEvent, "code" | "key" | "shiftKey">): boolean {
  // Shift+та же клавиша — «?» или «,», не поиск.
  return (e.code === "Slash" && !e.shiftKey) || e.key === "/";
}

/**
 * role — чтобы N открывала то, чем роль оформляет заказ: офису — окно
 * быстрого заказа поверх текущей страницы, полевым — мастер /orders/new.
 * Раньше N вела в мастер всех, хотя офис по руководству работает окном.
 */
export function useHotkeys(role?: string) {
  const navigate = useNavigate();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (areHotkeysBlocked(e.key)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      // N → new order
      if (isNewOrderKey(e)) {
        e.preventDefault();
        if (usesQuickOrder(role)) openQuickOrder();
        else navigate("/orders/new");
        return;
      }

      // / → focus search input
      if (isSearchKey(e)) {
        e.preventDefault();
        const searchInput = document.querySelector<HTMLInputElement>(`[${HOTKEY_SEARCH_ATTR}]`);
        if (searchInput) {
          searchInput.focus();
        } else {
          // Open CommandPalette via Ctrl+K shortcut
          document.dispatchEvent(
            new KeyboardEvent("keydown", { key: "k", code: "KeyK", ctrlKey: true, bubbles: true })
          );
        }
        return;
      }

      // Escape → close any open modal/dialog
      if (e.key === "Escape") {
        // Click visible overlay backdrops (Radix dialogs, custom modals)
        const backdrops = document.querySelectorAll<HTMLElement>(
          '[data-state="open"][class*="overlay"], [class*="backdrop"], [class*="overlay"]'
        );
        for (const backdrop of backdrops) {
          if (backdrop.offsetParent !== null) {
            backdrop.click();
            return;
          }
        }
      }
    };

    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [navigate, role]);
}
