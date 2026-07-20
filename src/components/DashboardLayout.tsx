import { memo } from "react";

/* ─── Three colored dots — reference signature ─── */
export const CardDots = memo(function CardDots({ style }: { style?: React.CSSProperties }) {
  return (
    <div style={{ display: "flex", gap: "6px", marginBottom: "12px", ...style }}>
      <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "var(--accent-pink, #c06080)", boxShadow: "var(--shadow-xs)" }} />
      <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "var(--accent-orange, #c49530)", boxShadow: "var(--shadow-xs)" }} />
      <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "var(--accent-teal, #3a9a8a)", boxShadow: "var(--shadow-xs)" }} />
    </div>
  );
});

/* ─── Card — white, soft shadow, rounded ─── */
export const Card = memo(function Card({ children, onClick, style }: { children: React.ReactNode; onClick?: () => void; style?: React.CSSProperties }) {
  return (
    <div className="kpi-hero" onClick={onClick} style={{ cursor: onClick ? "pointer" : "default", ...style }}>
      {children}
    </div>
  );
});

/* ─── Section title ─── */
export const SectionTitle = memo(function SectionTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div>
      <h2 style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", fontWeight: 700, color: "var(--color-text-primary, #2b3450)", margin: 0, letterSpacing: "-0.01em" }}>{title}</h2>
      {subtitle && <p style={{ fontSize: "12px", color: "var(--color-text-tertiary, #98a0b8)", margin: "3px 0 0" }}>{subtitle}</p>}
    </div>
  );
});

/* ─── KPI Card with icon ─── */
export const KpiCard = memo(function KpiCard({ label, value, icon, gradient, children, onClick }: {
  label: string; value: string | number; icon?: React.ReactNode; gradient?: string; children?: React.ReactNode; onClick?: () => void;
}) {
  return (
    <Card onClick={onClick} style={onClick ? { cursor: "pointer" } : undefined}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "14px" }}>
        <span className="kpi-hero-label">{label}</span>
        {icon && <div className="kpi-hero-icon" style={{ background: gradient ?? "var(--color-primary-subtle, #e8edfd)" }}>{icon}</div>}
      </div>
      <div className="kpi-hero-value">{value}</div>
      {children}
    </Card>
  );
});

/* ─── Table container ─── */
export const TableContainer = memo(function TableContainer({ children }: { children: React.ReactNode }) {
  return <Card style={{ padding: 0, overflow: "hidden" }}><div style={{ overflowX: "auto" }}>{children}</div></Card>;
});

/* ─── Page header ─── */
export const PageHeader = memo(function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: "12px" }}>
      <div>
        <CardDots />
        <h1 style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "24px", fontWeight: 700, color: "var(--color-text-primary, #2b3450)", letterSpacing: "-0.025em", margin: 0 }}>{title}</h1>
        {subtitle && <p style={{ fontSize: "13px", color: "var(--color-text-secondary, #6a7290)", margin: "4px 0 0" }}>{subtitle}</p>}
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
      {items.map(r => (<button key={r.d} onClick={() => onChange(r.d)} className={`range-pill ${days === r.d ? "active" : ""}`}>{r.label}</button>))}
    </div>
  );
});

/* ─── Chart panel ─── */
export const ChartPanel = memo(function ChartPanel({ title, children }: { title: string; children: React.ReactNode }) {
  return <Card><SectionTitle title={title} /><div style={{ marginTop: "16px" }}>{children}</div></Card>;
});

/* ─── Glass panel ─── */
export const GlassPanel = memo(function GlassPanel({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <Card style={style}>{children}</Card>;
});
