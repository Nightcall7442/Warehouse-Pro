import { useState, useRef, useEffect } from "react";
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

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const selected = options.find(o => o.value === value);

  return (
    <div ref={ref} style={{ position: "relative", width: width || "auto" }}>
      {/* Trigger */}
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          width: "100%", padding: "10px 14px", borderRadius: "12px",
          background: "var(--color-surface-light)", color: selected ? "var(--color-text-primary)" : "var(--color-text-tertiary)",
          border: open ? "2px solid var(--color-primary)" : "2px solid transparent",
          boxShadow: open ? "0 0 0 4px rgba(99,102,241,0.1)" : "none",
          fontSize: "14px", fontFamily: "'DM Sans', sans-serif", fontWeight: 500,
          cursor: "pointer", transition: "all 0.2s ease", outline: "none",
        }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {selected?.label ?? placeholder}
        </span>
        <ChevronDown size={16} style={{ color: "var(--color-text-tertiary)", transform: open ? "rotate(180deg)" : "rotate(0)", transition: "transform 0.2s ease", flexShrink: 0 }} />
      </button>

      {/* Dropdown */}
      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 6px)", left: 0, right: 0, zIndex: 50,
          background: "var(--color-surface)", borderRadius: "14px",
          boxShadow: "0 8px 32px rgba(0,0,0,0.12), 0 2px 8px rgba(0,0,0,0.06)",
          border: "1px solid var(--color-border-subtle)",
          maxHeight: "240px", overflowY: "auto", padding: "4px",
        }}>
          {options.map(opt => (
            <button
              key={opt.value}
              onClick={() => { onChange(opt.value); setOpen(false); }}
              style={{
                display: "flex", alignItems: "center", gap: "10px",
                width: "100%", padding: "10px 12px", borderRadius: "10px",
                border: "none", cursor: "pointer", transition: "all 0.15s ease",
                background: value === opt.value ? "var(--color-primary-subtle)" : "transparent",
                color: value === opt.value ? "var(--color-primary)" : "var(--color-text-primary)",
                fontSize: "13px", fontFamily: "'DM Sans', sans-serif", fontWeight: value === opt.value ? 600 : 400,
                textAlign: "left",
              }}
              onMouseEnter={e => { if (value !== opt.value) e.currentTarget.style.background = "var(--color-surface-light)"; }}
              onMouseLeave={e => { if (value !== opt.value) e.currentTarget.style.background = "transparent"; }}
            >
              {selected?.value === opt.value && (
                <div style={{
                  width: "18px", height: "18px", borderRadius: "6px",
                  background: "var(--color-primary)", display: "flex",
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
        </div>
      )}
    </div>
  );
}
