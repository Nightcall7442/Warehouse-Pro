import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router";

/* ═══════════════════════════════════════════════════════════════════════════
   Раскрывающееся меню шапки: кнопка и панель.

   ── Что было ───────────────────────────────────────────────────────────────

   Мобильное меню лендинга открывалось и закрывалось только своей кнопкой.
   Esc не делал ничего, касание мимо меню — тоже: человек, открывший меню
   случайно, должен был найти крестик. Кнопка не говорила скринридеру, открыто
   ли меню и каким блоком оно управляет (ни aria-expanded, ни aria-controls).
   В шапке сравнения (/compare) на телефоне меню не было вовсе — ни разделов,
   ни «Войти», ни «Начать».

   ── Что делает ─────────────────────────────────────────────────────────────

   · Esc закрывает и возвращает фокус на кнопку — клавиатура не теряется;
   · касание вне панели и кнопки закрывает (фокус не трогается: человек
     нажал куда-то сам);
   · смена адреса (переход по разделу, якорь) закрывает;
   · кнопка несёт aria-expanded и aria-controls, панель — id и inert, пока
     закрыта: max-height 0 прячет её только глазами, а табом в неё
     проваливался фокус.

   Один крючок на обе шапки — лендинга и страниц сайта в оболочке конкурса.
   ═══════════════════════════════════════════════════════════════════════════ */

export function useDisclosure(id: string) {
  const [open, setOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Переход по адресу или якорю закрывает меню. Сравнение при отрисовке, а
  // не эффект: эффект показал бы один кадр открытого меню поверх нового места.
  const { pathname, hash } = useLocation();
  const at = pathname + hash;
  const [seenAt, setSeenAt] = useState(at);
  if (seenAt !== at) {
    setSeenAt(at);
    setOpen(false);
  }

  const close = useCallback((returnFocus = false) => {
    setOpen(false);
    if (returnFocus) toggleRef.current?.focus();
  }, []);
  const toggle = useCallback(() => setOpen(o => !o), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close(true);
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (!t) return;
      if (panelRef.current?.contains(t) || toggleRef.current?.contains(t)) return;
      close(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [open, close]);

  return {
    open,
    close,
    toggle,
    /** На кнопку: <button {...toggleProps}>. */
    toggleProps: { ref: toggleRef, "aria-expanded": open, "aria-controls": id, onClick: toggle },
    /** На панель: <div {...panelProps}>. */
    panelProps: { ref: panelRef, id, inert: !open },
  };
}
