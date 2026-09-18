import { useEffect, useEffectEvent } from "react";

/*
  ОДНО ПОВЕДЕНИЕ ДЛЯ ВСЕХ ОКОН.

  Владелец (18.09.2026): «баги в модалках — задняя страница двигается вниз,
  и таких дохуя везде». Причина одна на все окна: у каждого была своя
  копия «модалки» (портал + fixed inset-0), и замок прокрутки был только у
  трёх из семнадцати. Колесо над окном крутило страницу под ним; на
  телефоне палец на окне уводил страницу; после закрытия окно оставляло
  страницу не там, где её открыли.

  Замок — общий и один. Не `overflow: hidden` на body: на iOS Safari это не
  держит касание, и страница под окном всё равно едет. Тело страницы
  прибивается (`position: fixed; top: -scrollY`), ширина полосы прокрутки
  возмещается отступом — иначе страница дёргается вбок при каждом открытии,
  — а при закрытии прокрутка возвращается ровно туда, где была. Замок
  считает вложенность: окно поверх окна (подтверждение поверх формы)
  снимает его только с последним.

  Escape и возврат фокуса — здесь же: окну незачем реализовывать их самому.
*/

let depth = 0;
let saved: { y: number; style: Partial<Record<"position" | "top" | "left" | "right" | "width" | "overflow" | "paddingRight", string>> } | null = null;

/** Прибить страницу под окном. Возвращает снятие; повторное снятие — ничего. */
export function lockScroll(): () => void {
  if (typeof document === "undefined") return () => {};
  const s = document.body.style;
  if (depth++ === 0) {
    const y = window.scrollY || 0;
    const gutter = window.innerWidth - document.documentElement.clientWidth;
    saved = { y, style: { position: s.position, top: s.top, left: s.left, right: s.right, width: s.width, overflow: s.overflow, paddingRight: s.paddingRight } };
    s.position = "fixed"; s.top = `-${y}px`; s.left = "0"; s.right = "0"; s.width = "100%"; s.overflow = "hidden";
    if (gutter > 0) s.paddingRight = `${gutter}px`;
  }
  // Radix Select/DropdownMenu, закрываясь ровно в момент открытия окна,
  // оставляет на <body> инлайновый pointer-events: none — портал внутри body
  // наследует его и окно мертво до перезагрузки. Снимаем и не возвращаем.
  s.pointerEvents = "";
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--depth > 0 || !saved) return;
    for (const [k, v] of Object.entries(saved.style)) (s as unknown as Record<string, string>)[k] = v ?? "";
    const y = saved.y; saved = null;
    if (typeof window.scrollTo === "function") { try { window.scrollTo(0, y); } catch { /* jsdom */ } }
  };
}

/** Сколько замков держат страницу — для тестов. */
export function scrollLockDepth(): number { return depth; }

/**
 * Поведение окна: пока open — страница прибита, Escape зовёт onClose (если
 * окно не dirty), при закрытии фокус возвращается туда, откуда открыли.
 */
export function useOverlay({ open, onClose, dirty = false }: { open: boolean; onClose?: () => void; dirty?: boolean }): void {
  const requestClose = useEffectEvent(() => onClose?.());
  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !dirty) requestClose(); };
    document.addEventListener("keydown", onKey);
    const unlock = lockScroll();
    return () => {
      document.removeEventListener("keydown", onKey);
      unlock();
      previouslyFocused?.focus?.();
    };
  }, [open, dirty]);
}
