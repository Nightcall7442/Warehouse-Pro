import { memo } from "react";

/* ─── Three colored dots — signature decorative element ─── */
export const CardDots = memo(function CardDots() {
  return (
    <div style={{ display: "flex", gap: "6px", marginBottom: "12px" }}>
      <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#fb7185" }} />
      <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#fbbf24" }} />
      <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#2dd4bf" }} />
    </div>
  );
});

/* ─── Card — white, soft shadow, 20px radius ─── */
export const Card = memo(function Card({ children, onClick, style }: { children: React.ReactNode; onClick?: () => void; style?: React.CSSProperties }) {
  return (
    <div onClick={onClick} style={{
      background: "var(--color-surface, #ffffff)",
      borderRadius: "20px",
      padding: "22px",
      boxShadow: "0 1px 3px rgba(0,0,0,.06), 0 1px 2px rgba(0,0,0,.03)",
      cursor: onClick ? "pointer" : "default",
      transition: "all 0.2s ease",
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
      <h2 style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px", fontWeight: 600, color: "var(--color-text-primary, #111827)", margin: 0 }}>
        {title}
      </h2>
      {subtitle && (
        <p style={{ fontSize: "12px", color: "var(--color-text-tertiary, #9ca3af)", margin: "4px 0 0" }}>
          {subtitle}
        </p>
      )}
    </div>
  );
});

/* ─── KPI Card with icon ─── */
export const KpiCard = memo(function KpiCard({ label, value, icon, gradient, children }: {
  label: string; value: string; icon?: React.ReactNode; gradient?: string; children?: React.ReactNode;
}) {
  return (
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "12px" }}>
        <CardDots />
        {icon && (
          <div style={{ width: "40px", height: "40px", borderRadius: "12px", background: gradient ?? "var(--color-primary-subtle, rgba(129,140,248,.10))", display: "flex", alignItems: "center", justifyContent: "center" }}>
            {icon}
          </div>
        )}
      </div>
      <p style={{ fontSize: "11px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--color-text-tertiary, #9ca3af)", margin: 0, fontFamily: "'DM Sans', sans-serif" }}>
        {label}
      </p>
      <p style={{ fontSize: "28px", fontWeight: 700, color: "var(--color-text-primary, #111827)", margin: "8px 0 0", letterSpacing: "-0.03em", fontFamily: "'DM Sans', sans-serif" }}>
        {value}
      </p>
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
  color: "var(--color-text-tertiary, #9ca3af)",
  padding: "12px 16px",
  textAlign: "left",
  borderBottom: "1px solid var(--color-border, #f3f4f6)",
  background: "var(--color-surface-light, #f8f9fb)",
};

export const tdStyle: React.CSSProperties = {
  padding: "12px 16px",
  fontSize: "13px",
  color: "var(--color-text-primary, #111827)",
  borderBottom: "1px solid var(--color-border, #f3f4f6)",
};

/* ─── Button styles ─── */
export const btnPrimary: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "8px",
  padding: "10px 20px", fontSize: "13px", fontWeight: 600, fontFamily: "'DM Sans', sans-serif",
  borderRadius: "12px", border: "none", cursor: "pointer",
  background: "var(--color-primary, #818cf8)", color: "#fff",
  boxShadow: "0 2px 8px rgba(129,140,248,.25)", transition: "all 0.2s ease",
};

export const btnSecondary: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "6px",
  padding: "8px 16px", fontSize: "13px", fontWeight: 500, fontFamily: "'DM Sans', sans-serif",
  borderRadius: "10px", border: "none", cursor: "pointer",
  background: "var(--color-surface-light, #f8f9fb)", color: "var(--color-text-secondary, #6b7280)",
  transition: "all 0.15s ease",
};

export const btnDanger: React.CSSProperties = {
  ...btnSecondary,
  background: "var(--color-danger-subtle, rgba(248,113,113,.10))",
  color: "var(--color-danger, #f87171)",
};

/* ─── Input styles ─── */
export const inputStyle: React.CSSProperties = {
  width: "100%", padding: "10px 14px", fontSize: "13px", fontFamily: "'DM Sans', sans-serif",
  color: "var(--color-text-primary, #111827)", background: "var(--color-surface-light, #f8f9fb)",
  border: "1px solid transparent", borderRadius: "10px", outline: "none", transition: "all 0.15s ease",
};

/* ─── Page header ─── */
export const PageHeader = memo(function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: "12px" }}>
      <div>
        <CardDots />
        <h1 style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "24px", fontWeight: 700, color: "var(--color-text-primary, #111827)", letterSpacing: "-0.025em", margin: 0 }}>
          {title}
        </h1>
        {subtitle && (
          <p style={{ fontSize: "13px", color: "var(--color-text-secondary, #6b7280)", margin: "4px 0 0" }}>
            {subtitle}
          </p>
        )}
      </div>
      {actions && <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>{actions}</div>}
    </div>
  );
});
