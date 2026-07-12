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
          width: "100%", padding: "10px 14px", borderRadius: "10px",
          background: "#f8f9fb", color: selected ? "#111827" : "#9ca3af",
          border: open ? "1.5px solid #818cf8" : "1.5px solid transparent",
          boxShadow: open ? "0 0 0 3px rgba(129,140,248,.12)" : "none",
          fontSize: "13px", fontFamily: "'DM Sans', sans-serif", fontWeight: 500,
          cursor: "pointer", transition: "all 0.15s ease", outline: "none",
        }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {selected?.label ?? placeholder}
        </span>
        <ChevronDown size={16} style={{ color: "#9ca3af", transform: open ? "rotate(180deg)" : "rotate(0)", transition: "transform 0.15s ease", flexShrink: 0 }} />
      </button>

      {/* Dropdown */}
      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 6px)", left: 0, right: 0, zIndex: 50,
          background: "#ffffff", borderRadius: "12px",
          boxShadow: "0 4px 12px rgba(0,0,0,.08), 0 1px 3px rgba(0,0,0,.04)",
          border: "1px solid #f3f4f6",
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
                background: value === opt.value ? "#eff6ff" : "transparent",
                color: value === opt.value ? "#818cf8" : "#111827",
                fontSize: "13px", fontFamily: "'DM Sans', sans-serif", fontWeight: value === opt.value ? 600 : 400,
                textAlign: "left",
              }}
              onMouseEnter={e => { if (value !== opt.value) e.currentTarget.style.background = "#f8f9fb"; }}
              onMouseLeave={e => { if (value !== opt.value) e.currentTarget.style.background = "transparent"; }}
            >
              {selected?.value === opt.value && (
                <div style={{
                  width: "18px", height: "18px", borderRadius: "6px",
                  background: "#818cf8", display: "flex",
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
