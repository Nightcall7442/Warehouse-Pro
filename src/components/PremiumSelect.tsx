import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { ChevronDown } from "lucide-react";

interface PremiumSelectProps {
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  placeholder?: string;
  width?: string;
}

export function PremiumSelect({ value, options, onChange, placeholder = "Выберите...", width }: PremiumSelectProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0, width: 0 });

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => {
    if (open && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setDropdownPos({ top: rect.bottom + window.scrollY + 6, left: rect.left, width: rect.width });
    }
  }, [open]);

  const selected = options.find(o => o.value === value);

  return (
    <div ref={ref} style={{ position: "relative", width: width || "auto" }}>
      {/* Trigger */}
      <button
        ref={triggerRef}
        onClick={() => setOpen(v => !v)}
        style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          width: "100%", padding: "10px 14px", borderRadius: "10px",
          background: "var(--color-surface-light, #f0f3f8)", color: selected ? "var(--color-text-primary, #2b3450)" : "var(--color-text-tertiary, #98a0b8)",
          border: open ? "1.5px solid var(--color-primary, #4b6cf6)" : "1.5px solid transparent",
          boxShadow: open ? "0 0 0 3px color-mix(in srgb, var(--color-primary, #4b6cf6) 12%, transparent)" : "none",
          fontSize: "13px", fontFamily: "'DM Sans', sans-serif", fontWeight: 500,
          cursor: "pointer", transition: "all 0.15s ease", outline: "none",
        }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {selected?.label ?? placeholder}
        </span>
        <ChevronDown size={16} style={{ color: "var(--color-text-tertiary, #98a0b8)", transform: open ? "rotate(180deg)" : "rotate(0)", transition: "transform 0.15s ease", flexShrink: 0 }} />
      </button>

      {/* Dropdown — portal to avoid clipping */}
      {open && createPortal(
        <div style={{
          position: "fixed", top: dropdownPos.top, left: dropdownPos.left, width: dropdownPos.width, zIndex: 99999,
          background: "var(--color-surface, #ffffff)", borderRadius: "12px",
          boxShadow: "0 4px 12px rgba(0,0,0,.08), 0 1px 3px rgba(0,0,0,.04)",
          border: "1px solid var(--color-border, #f0f3f8)",
          maxHeight: "240px", overflowY: "auto", padding: "4px",
        }}>
          {options.map(opt => (
            <button
              key={opt.value}
              onClick={() => { onChange(opt.value); setOpen(false); }}
              style={{
                display: "flex", alignItems: "center", gap: "10px",
                width: "100%", padding: "10px 12px", borderRadius: "8px",
                border: "none", cursor: "pointer", transition: "all 0.15s ease",
                background: value === opt.value ? "var(--color-primary-subtle, rgba(75,108,246,.10))" : "transparent",
                color: value === opt.value ? "var(--color-primary, #4b6cf6)" : "var(--color-text-primary, #2b3450)",
                fontSize: "13px", fontFamily: "'DM Sans', sans-serif", fontWeight: value === opt.value ? 600 : 400,
                textAlign: "left",
              }}
              onMouseEnter={e => { if (value !== opt.value) e.currentTarget.style.background = "var(--color-surface-light, #f0f3f8)"; }}
              onMouseLeave={e => { if (value !== opt.value) e.currentTarget.style.background = "transparent"; }}
            >
              {selected?.value === opt.value && (
                <div style={{
                  width: "18px", height: "18px", borderRadius: "6px",
                  background: "#4b6cf6", display: "flex",
                  alignItems: "center", justifyContent: "center", flexShrink: 0,
                }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </div>
              )}
              {opt.label}
            </button>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}
