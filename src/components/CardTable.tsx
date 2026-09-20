import { useLayoutEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { useIsMobile } from "@/hooks/use-mobile";

/*
  Таблица, которая на телефоне становится карточками.

  Прогон 20.09.2026 при 390×844: «Пользователи», «Приходы», «KPI», «P&L» и
  «Контроль» — таблицы шире экрана с боковой прокруткой: правые колонки
  (роль, кнопки, суммы) режутся, и человек не знает, что там что-то есть.

  Приём один на всех и не трогает разметку таблиц: на узком экране заголовок
  прячется, каждая строка — карточка, каждая ячейка — строка «подпись ·
  значение», подпись берётся из заголовка её колонки (data-label, CSS в
  index.css → .card-table). На настольном экране обёртка — та же прокрутка,
  что и была.

  Подписи ставятся после отрисовки и при каждой смене строк (страница,
  фильтр, сортировка) — за этим следит MutationObserver; атрибуты он не
  слушает, поэтому сам себя не будит.
*/
export function CardTable({ children, className = "", style }: { children: ReactNode; className?: string; style?: CSSProperties }) {
  const ref = useRef<HTMLDivElement>(null);
  const isMobile = useIsMobile();

  useLayoutEffect(() => {
    const root = ref.current;
    if (!isMobile || !root) return;
    const label = () => {
      for (const table of root.querySelectorAll("table")) {
        const heads = Array.from(table.querySelectorAll(":scope > thead th")).map(th => th.textContent?.trim() ?? "");
        for (const tr of table.querySelectorAll(":scope > tbody > tr")) {
          // Колонка считается с учётом colspan предыдущих ячеек: в итоговой строке
          // «Итого за период» на пять колонок сумма стоит в шестой, а не во второй.
          let col = 0;
          for (const td of Array.from(tr.children)) {
            const span = Number(td.getAttribute("colspan") ?? 1) || 1;
            // Ячейка на несколько колонок (пусто, загрузка, «итого») и колонки без подписи (кнопки) — без «подпись ·».
            if (heads[col] && span === 1) td.setAttribute("data-label", heads[col]);
            else td.removeAttribute("data-label");
            col += span;
          }
        }
      }
    };
    label();
    const mo = new MutationObserver(label);
    mo.observe(root, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, [isMobile]);

  return (
    <div ref={ref} className={`card-table ${className}`} style={style}>
      {children}
    </div>
  );
}
