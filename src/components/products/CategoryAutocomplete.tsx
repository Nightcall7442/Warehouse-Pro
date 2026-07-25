import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Plus } from "lucide-react";

interface CategoryAutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  categories: string[];
  placeholder?: string;
}

export function CategoryAutocomplete({ value, onChange, categories, placeholder = "Категория" }: CategoryAutocompleteProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(value);
  const ref = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0, width: 0 });

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

  useEffect(() => {
    if (open && inputRef.current) {
      const rect = inputRef.current.getBoundingClientRect();
      setDropdownPos({ top: rect.bottom + 4, left: rect.left, width: rect.width });
    }
  }, [open]);

  const filtered = query
    ? categories.filter(c => c.toLowerCase().includes(query.toLowerCase()))
    : categories;

  const exactMatch = categories.some(c => c.toLowerCase() === query.toLowerCase());

  const handleSelect = (val: string) => {
    onChange(val);
    setQuery(val);
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
          onFocus={() => setOpen(true)}
          onChange={e => {
            setQuery(e.target.value);
            onChange(e.target.value);
            setOpen(true);
          }}
        />
        <button
          onClick={() => setOpen(v => !v)}
          style={{
            position: "absolute", right: "8px", top: "50%", transform: "translateY(-50%)",
            background: "none", border: "none", cursor: "pointer", padding: "2px",
          }}
        >
          <ChevronDown size={16} style={{
            color: "var(--color-text-tertiary, #98a0b8)",
            transform: open ? "rotate(180deg)" : "rotate(0)",
            transition: "transform 0.15s ease",
          }} />
        </button>
      </div>

      {open && createPortal(
        <div ref={dropdownRef} style={{
          position: "fixed", top: dropdownPos.top, left: dropdownPos.left, width: dropdownPos.width, zIndex: 99999,
          background: "var(--color-surface, #ffffff)", borderRadius: "12px",
          boxShadow: "0 4px 12px rgba(0,0,0,.08), 0 1px 3px rgba(0,0,0,.04)",
          border: "1px solid var(--color-border, #f0f3f8)",
          maxHeight: "240px", overflowY: "auto", padding: "4px",
        }}>
          {filtered.map(cat => (
            <button
              key={cat}
              onClick={() => handleSelect(cat)}
              style={{
                display: "flex", alignItems: "center",
                width: "100%", padding: "8px 12px", borderRadius: "8px",
                border: "none", cursor: "pointer", transition: "all 0.15s ease",
                background: value === cat ? "var(--color-primary-subtle, rgba(75,108,246,.10))" : "transparent",
                color: value === cat ? "var(--color-primary, #5b6d8a)" : "var(--color-text-primary, #2b3450)",
                fontSize: "13px", fontFamily: "'DM Sans', sans-serif", fontWeight: value === cat ? 600 : 400,
                textAlign: "left",
              }}
              onMouseEnter={e => { if (value !== cat) e.currentTarget.style.background = "var(--color-surface-light, #f0f3f8)"; }}
              onMouseLeave={e => { if (value !== cat) e.currentTarget.style.background = "transparent"; }}
            >
              {cat}
            </button>
          ))}

          {query && !exactMatch && (
            <button
              onClick={() => handleSelect(query)}
              style={{
                display: "flex", alignItems: "center", gap: "8px",
                width: "100%", padding: "8px 12px", borderRadius: "8px",
                border: "none", cursor: "pointer", transition: "all 0.15s ease",
                background: "transparent", color: "var(--color-primary, #5b6d8a)",
                fontSize: "13px", fontFamily: "'DM Sans', sans-serif", fontWeight: 500,
                textAlign: "left", borderTop: "1px solid var(--color-border, #f0f3f8)", marginTop: "4px",
              }}
            >
              <Plus size={14} />
              Использовать «{query}»
            </button>
          )}

          {filtered.length === 0 && !query && (
            <div style={{ padding: "12px", textAlign: "center", color: "var(--color-text-tertiary, #98a0b8)", fontSize: "12px" }}>
              Нет категорий
            </div>
          )}
        </div>,
        document.body
      )}
    </div>
  );
}
