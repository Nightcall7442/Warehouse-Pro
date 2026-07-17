import { CheckCircle2 } from "lucide-react";

interface StepsProps {
  current: number;
  labels: string[];
}

export function Steps({ current, labels }: StepsProps) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 0, marginBottom: "32px" }}>
      {labels.map((label, i) => {
        const step = i + 1;
        const done = step < current;
        const active = step === current;
        return (
          <div key={label} style={{ display: "flex", alignItems: "center", flex: 1 }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "6px", flexShrink: 0 }}>
              <div style={{
                width: "36px", height: "36px", borderRadius: "50%",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: "13px", fontWeight: 700, fontFamily: "'DM Sans', sans-serif",
                transition: "all 0.3s ease",
                background: done ? "#5b6d8a" : active ? "var(--color-primary-subtle, rgba(75,108,246,.10))" : "var(--color-surface-light, #f0f3f8)",
                color: done ? "#fff" : active ? "#5b6d8a" : "var(--color-text-tertiary, #98a0b8)",
                boxShadow: done ? "0 4px 12px rgba(75,108,246,0.3)" : active ? "0 0 0 3px rgba(75,108,246,.15)" : "none",
              }}>
                {done ? <CheckCircle2 size={18} /> : step}
              </div>
              <span style={{
                fontSize: "10px", fontWeight: 600, letterSpacing: "0.08em",
                fontFamily: "'DM Sans', sans-serif", textTransform: "uppercase",
                color: active ? "#5b6d8a" : done ? "#5b6d8a" : "var(--color-text-tertiary, #98a0b8)",
              }}>
                {label}
              </span>
            </div>
            {i < labels.length - 1 && (
              <div style={{
                flex: 1, height: "2px", margin: "0 8px", marginBottom: "20px",
                borderRadius: "1px", transition: "all 0.3s ease",
                background: step < current ? "#5b6d8a" : "var(--color-border, #f0f3f8)",
              }} />
            )}
          </div>
        );
      })}
    </div>
  );
}
