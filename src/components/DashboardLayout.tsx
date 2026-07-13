import { memo } from "react";

/* ─── Three colored dots — signature decorative element ─── */
export const CardDots = memo(function CardDots() {
  return (
    <div style={{ display: "flex", gap: "6px", marginBottom: "12px" }}>
      <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "var(--accent-pink, #fb7185)" }} />
      <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "var(--accent-orange, #fbbf24)" }} />
      <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "var(--accent-teal, #2dd4bf)" }} />
    </div>
  );
});

/* ─── Card — white, soft shadow, 20px radius, hover lift ─── */
export const Card = memo(function Card({ children, onClick, style }: { children: React.ReactNode; onClick?: () => void; style?: React.CSSProperties }) {
  return (
    <div className="kpi-hero" onClick={onClick} style={{
      cursor: onClick ? "pointer" : "default",
      ...style,
    }}>
      {children}
    </div>
  );
});

/* ─── Section title ─── */
export const SectionTitle = memo(function SectionTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div>
      <h2 style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px", fontWeight: 600, color: "var(--color-text-primary, #1e293b)", margin: 0 }}>
        {title}
      </h2>
      {subtitle && (
        <p style={{ fontSize: "12px", color: "var(--color-text-tertiary, #94a3b8)", margin: "4px 0 0" }}>
          {subtitle}
        </p>
      )}
    </div>
  );
});

/* ─── KPI Card with icon ─── */
export const KpiCard = memo(function KpiCard({ label, value, icon, gradient, children, onClick }: {
  label: string; value: string | number; icon?: React.ReactNode; gradient?: string; children?: React.ReactNode; onClick?: () => void;
}) {
  return (
    <Card onClick={onClick} style={onClick ? { cursor: "pointer" } : undefined}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "16px" }}>
        <span style={{ fontSize: "10px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--color-text-tertiary, #94a3b8)", fontFamily: "'DM Sans', sans-serif" }}>
          {label}
        </span>
        {icon && (
          <div className="kpi-hero-icon" style={{ background: gradient ?? "var(--color-primary-subtle, #eef2ff)" }}>
            {icon}
          </div>
        )}
      </div>
      <div className="kpi-hero-value">{value}</div>
      {children}
    </Card>
  );
});

/* ─── Table container ─── */
export const TableContainer = memo(function TableContainer({ children }: { children: React.ReactNode }) {
  return (
    <Card style={{ padding: 0, overflow: "hidden" }}>
      <div style={{ overflowX: "auto" }}>
        {children}
      </div>
    </Card>
  );
});

/* ─── Table styles ─── */
export const thStyle: React.CSSProperties = {
  fontFamily: "'DM Sans', sans-serif",
  fontSize: "10px",
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  color: "var(--color-text-tertiary, #94a3b8)",
  padding: "12px 16px",
  textAlign: "left",
  borderBottom: "1px solid var(--color-border, #e2e8f0)",
  background: "var(--color-surface-light, #f4f6f9)",
};

export const tdStyle: React.CSSProperties = {
  padding: "12px 16px",
  fontSize: "13px",
  color: "var(--color-text-primary, #1e293b)",
  borderBottom: "1px solid var(--color-border, #e2e8f0)",
};

/* ─── Button styles ─── */
export const btnPrimary: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "8px",
  padding: "10px 20px", fontSize: "13px", fontWeight: 600, fontFamily: "'DM Sans', sans-serif",
  borderRadius: "12px", border: "none", cursor: "pointer",
  background: "var(--color-primary, #6366f1)", color: "#fff",
  boxShadow: "0 2px 8px rgba(99,102,241,.25)", transition: "all 0.2s ease",
};

export const btnSecondary: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "6px",
  padding: "8px 16px", fontSize: "13px", fontWeight: 500, fontFamily: "'DM Sans', sans-serif",
  borderRadius: "10px", border: "none", cursor: "pointer",
  background: "var(--color-surface-light, #f4f6f9)", color: "var(--color-text-secondary, #64748b)",
  transition: "all 0.15s ease",
};

export const btnDanger: React.CSSProperties = {
  ...btnSecondary,
  background: "var(--color-danger-subtle, #fef2f2)",
  color: "var(--color-danger, #ef4444)",
};

/* ─── Input styles ─── */
export const inputStyle: React.CSSProperties = {
  width: "100%", padding: "10px 14px", fontSize: "13px", fontFamily: "'DM Sans', sans-serif",
  color: "var(--color-text-primary, #1e293b)", background: "var(--color-surface-light, #f4f6f9)",
  border: "1px solid transparent", borderRadius: "10px", outline: "none", transition: "all 0.15s ease",
};

/* ─── Page header ─── */
export const PageHeader = memo(function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: "12px" }}>
      <div>
        <CardDots />
        <h1 style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "24px", fontWeight: 700, color: "var(--color-text-primary, #1e293b)", letterSpacing: "-0.025em", margin: 0 }}>
          {title}
        </h1>
        {subtitle && (
          <p style={{ fontSize: "13px", color: "var(--color-text-secondary, #64748b)", margin: "4px 0 0" }}>
            {subtitle}
          </p>
        )}
      </div>
      {actions && <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>{actions}</div>}
    </div>
  );
});

/* ─── Period picker ─── */
export const PeriodPicker = memo(function PeriodPicker({ days, onChange }: { days: number; onChange: (d: number) => void }) {
  const items = [{ d: 7, label: "7 дней" }, { d: 30, label: "30 дней" }, { d: 90, label: "90 дней" }];
  return (
    <div className="range-pills">
      {items.map(r => (
        <button key={r.d} onClick={() => onChange(r.d)} className={`range-pill ${days === r.d ? "active" : ""}`}>
          {r.label}
        </button>
      ))}
    </div>
  );
});

/* ─── Chart panel ─── */
export const ChartPanel = memo(function ChartPanel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <SectionTitle title={title} />
      <div style={{ marginTop: "16px" }}>{children}</div>
    </Card>
  );
});

/* ─── Glass panel ─── */
export const GlassPanel = memo(function GlassPanel({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <Card style={style}>{children}</Card>;
});
