import { cloneElement, isValidElement, useId } from "react";
import type { ReactElement, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

/**
 * Общие кирпичи для страницы настроек.
 *
 * Раньше каждый раздел рисовал подписи, поля и кнопку сохранения по-своему:
 * где-то подпись 10px заглавными с разрядкой, где-то обычная; кнопка
 * «Сохранить» — то в конце формы, то посреди неё; отступы 3, 4, 5 и 6 подряд.
 * Семь разделов, семь трактовок одного и того же — именно из этого и
 * складывается ощущение дешёвой страницы.
 *
 * Здесь эти решения приняты один раз.
 */

/* ── Заголовок раздела ─────────────────────────────────────────────────────
   Заголовок объясняет, ЧТО настраивается, а не повторяет пункт меню слева. */
export function SectionHeader({ title, description }: { title: string; description?: string }) {
  return (
    <header className="mb-6">
      <h2 className="font-display text-lg font-semibold text-primary tracking-tight">{title}</h2>
      {description && <p className="text-sm text-secondary mt-1 max-w-prose">{description}</p>}
    </header>
  );
}

/* ── Группа полей ──────────────────────────────────────────────────────────
   Разделитель ставится сверху и только между группами — линия перед первой
   группой отделяет её от заголовка и выглядит случайной. */
export function FieldGroup({ title, children, first = false }: { title?: string; children: ReactNode; first?: boolean }) {
  return (
    <section className={first ? "" : "mt-8 pt-8 border-t border-border-subtle"}>
      {title && <h3 className="text-sm font-semibold text-primary mb-4">{title}</h3>}
      {children}
    </section>
  );
}

/* ── Поле ──────────────────────────────────────────────────────────────────
   Подпись — 13px обычным регистром. Прежние 10px заглавными с разрядкой на
   тёмном фоне давали контраст ниже нормы и читались как служебный шум. */
export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactElement<{ id?: string; "aria-describedby"?: string }> }) {
  const id = useId();
  const hintId = `${id}-hint`;

  // Подпись связывается с полем через htmlFor, а пояснение — через
  // aria-describedby, и оно намеренно ВНЕ <label>. Иначе доступным именем поля
  // становится «Телефон Для звонков из заказов»: скринридер зачитывает
  // пояснение как часть названия при каждом переходе по форме.
  return (
    <div>
      <label htmlFor={id} className="block text-[13px] font-medium text-secondary mb-1.5">{label}</label>
      {isValidElement(children)
        ? cloneElement(children, { id, "aria-describedby": hint ? hintId : undefined })
        : children}
      {hint && <p id={hintId} className="text-xs text-tertiary mt-1.5">{hint}</p>}
    </div>
  );
}

/** Поля в две колонки на широком экране, в одну — на узком. */
export function FieldRow({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-4">{children}</div>;
}

/* ── Сегментированный переключатель ────────────────────────────────────────
   Для выбора из двух-трёх равнозначных значений. Каждая кнопка ставит СВОЁ
   значение: раньше обе кнопки темы висели на одном toggle, и нажатие на уже
   выбранную включало противоположную. */
export type SegmentOption<T extends string> = { value: T; label: string; Icon?: LucideIcon };

export function Segmented<T extends string>({
  value, options, onChange, ariaLabel,
}: { value: T; options: SegmentOption<T>[]; onChange: (v: T) => void; ariaLabel: string }) {
  return (
    <div role="radiogroup" aria-label={ariaLabel}
      className="inline-flex p-1 rounded-xl gap-1"
      style={{ background: "var(--color-surface-light)", border: "1px solid var(--color-border)" }}>
      {options.map(o => {
        const selected = o.value === value;
        return (
          <button key={o.value} type="button" role="radio" aria-checked={selected}
            onClick={() => onChange(o.value)}
            className={`flex items-center justify-center gap-2 h-10 px-4 rounded-lg text-sm font-medium transition-colors ${
              selected ? "text-primary" : "text-secondary hover:text-primary"
            }`}
            style={selected
              ? { background: "var(--color-surface)", boxShadow: "var(--shadow-sm)" }
              : undefined}>
            {o.Icon && <o.Icon size={15} />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/* ── Строка сохранения ─────────────────────────────────────────────────────
   Одна и та же во всех разделах: кнопка справа, слева — что произойдёт. */
export function SaveBar({ onSave, isPending, label, hint, disabled }: {
  onSave: () => void;
  isPending?: boolean;
  label: string;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <div className="mt-8 pt-5 border-t border-border-subtle flex items-center justify-between gap-4 flex-wrap">
      <p className="text-xs text-tertiary">{hint}</p>
      <button onClick={onSave} disabled={isPending || disabled}
        className="neo-btn-primary h-10 px-5 disabled:opacity-40 disabled:cursor-not-allowed">
        {isPending && <span className="inline-block w-3.5 h-3.5 rounded-full border-2 border-white/40 border-t-white animate-spin" />}
        {label}
      </button>
    </div>
  );
}
