import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Plus } from "lucide-react";

const ROW = 34;
const PANEL_PADDING = 8;
const GAP = 4;
const MAX_PANEL = 240;

interface CategoryAutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  categories: string[];
  placeholder?: string;
}

export function CategoryAutocomplete({ value, onChange, categories, placeholder = "Категория" }: CategoryAutocompleteProps) {
  const [open, setOpen] = useState(false);
  /**
   * Печатал ли человек в поле.
   *
   * В правке товара поле уже заполнено, и без этого признака нажатие на
   * стрелку показывало ровно одну строку — ту самую категорию, что уже
   * стоит. Остальные приходилось откапывать, стирая текст вручную, то есть
   * выбрать другую категорию было нельзя.
   */
  const [typed, setTyped] = useState(false);
  const [query, setQuery] = useState(value);
  const ref = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0, width: 0, maxHeight: MAX_PANEL });

  // eslint-disable-next-line react-hooks/set-state-in-effect -- sync local state when parent value changes (form reset)
  useEffect(() => { setQuery(value); }, [value]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (ref.current?.contains(target) || dropdownRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const filtered = query && typed
    ? categories.filter(c => c.toLowerCase().includes(query.toLowerCase()))
    : categories;

  const exactMatch = categories.some(c => c.toLowerCase() === query.toLowerCase());
  // Строк в списке: найденные + строка «использовать своё» + «нет категорий».
  const rows = filtered.length + (query && typed && !exactMatch ? 1 : 0) + (filtered.length === 0 && !query ? 1 : 0);

  /**
   * Список рисуется поверх страницы (position: fixed), поэтому его положение
   * приходится пересчитывать всякий раз, когда поле сдвинулось.
   *
   * Раньше замер делался только в миг открытия и всегда вниз. Из-за этого
   * список уезжал за нижний край экрана, если форма стояла низко на странице, —
   * а стоит она тем ниже, чем длиннее список товаров. Отсюда и жалоба, что
   * «категорию не выбрать»: выбирать было нечего, список просто не помещался.
   */
  const place = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const wanted = Math.min(MAX_PANEL, rows * ROW + PANEL_PADDING);
    const below = window.innerHeight - r.bottom - GAP - 8;
    const above = r.top - GAP - 8;
    // Вверх — когда снизу список не помещается, а сверху места больше.
    const flip = below < wanted && above > below;
    setDropdownPos({
      top: flip ? Math.max(8, r.top - GAP - Math.min(wanted, above)) : r.bottom + GAP,
      left: r.left,
      width: r.width,
      maxHeight: Math.max(ROW + PANEL_PADDING, Math.min(wanted, flip ? above : below)),
    });
  }, [rows]);

  useEffect(() => {
    if (!open) return;
    place();
    // capture — чтобы считалась прокрутка любого родителя, не только окна.
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, place]);


  const handleSelect = (val: string) => {
    onChange(val);
    setQuery(val);
    setTyped(false);
    setOpen(false);
  };

  return (
    <div ref={ref} style={{ position: "relative", width: "100%" }}>
      <div style={{ position: "relative" }}>
        <input
          ref={inputRef}
          className="neo-input"
          style={{ width: "100%", paddingRight: "32px" }}
          placeholder={placeholder}
          value={query}
          onFocus={() => { setTyped(false); setOpen(true); }}
          onChange={e => {
            setTyped(true);
            setQuery(e.target.value);
            onChange(e.target.value);
            setOpen(true);
          }}
        />
        <button
          onClick={() => { setTyped(false); setOpen(v => !v); }}
          style={{
            position: "absolute", right: "8px", top: "50%", transform: "translateY(-50%)",
            background: "none", border: "none", cursor: "pointer", padding: "2px",
          }}
        >
          <ChevronDown size={16} style={{
            color: "var(--color-text-tertiary, #6b6760)",
            transform: open ? "rotate(180deg)" : "rotate(0)",
            transition: "transform 0.15s ease",
          }} />
        </button>
      </div>

      {open && createPortal(
        <div ref={dropdownRef} style={{
          position: "fixed", top: dropdownPos.top, left: dropdownPos.left, width: dropdownPos.width, zIndex: 99999,
          background: "var(--color-surface, #efedea)", borderRadius: "12px",
          boxShadow: "0 4px 12px rgba(0,0,0,.08), 0 1px 3px rgba(0,0,0,.04)",
          border: "1px solid var(--color-border, #d8d5cd)",
          maxHeight: dropdownPos.maxHeight, overflowY: "auto", padding: "4px",
        }}>
          {filtered.map(cat => (
            <button
              key={cat}
              onClick={() => handleSelect(cat)}
              style={{
                display: "flex", alignItems: "center",
                width: "100%", padding: "8px 12px", borderRadius: "8px",
                border: "none", cursor: "pointer", transition: "all 0.15s ease",
                background: value === cat ? "var(--color-primary-subtle)" : "transparent",
                color: value === cat ? "var(--color-primary-text)" : "var(--color-text-primary, #2b2a28)",
                fontSize: "13px", fontFamily: "'DM Sans', sans-serif", fontWeight: value === cat ? 600 : 400,
                textAlign: "left",
              }}
              onMouseEnter={e => { if (value !== cat) e.currentTarget.style.background = "var(--color-surface-light, #f6f4f0)"; }}
              onMouseLeave={e => { if (value !== cat) e.currentTarget.style.background = "transparent"; }}
            >
              {cat}
            </button>
          ))}

          {query && typed && !exactMatch && (
            <button
              onClick={() => handleSelect(query)}
              style={{
                display: "flex", alignItems: "center", gap: "8px",
                width: "100%", padding: "8px 12px", borderRadius: "8px",
                border: "none", cursor: "pointer", transition: "all 0.15s ease",
                background: "transparent", color: "var(--color-primary)",
                fontSize: "13px", fontFamily: "'DM Sans', sans-serif", fontWeight: 500,
                textAlign: "left", borderTop: "1px solid var(--color-border, #d8d5cd)", marginTop: "4px",
              }}
            >
              <Plus size={14} />
              Использовать «{query}»
            </button>
          )}

          {filtered.length === 0 && !query && (
            <div style={{ padding: "12px", textAlign: "center", color: "var(--color-text-tertiary, #6b6760)", fontSize: "12px" }}>
              Нет категорий
            </div>
          )}
        </div>,
        document.body
      )}
    </div>
  );
}
