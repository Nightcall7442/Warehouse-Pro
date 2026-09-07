import React from "react";
import type { LucideIcon } from "lucide-react";
import { F, COLORS, PLAN_COLORS, STATUS_COLORS } from "./types";
import { labelled, TENANT_PLAN_LABEL, ACTIVE_STATUS_LABEL } from "@/lib/entity-labels";
import { AppModal } from "@/components/ui/AppModal";

// ── Badge components ────────────────────────────────────────────────────────
export function PlanBadge({ plan }: { plan: string }) {
  const c = PLAN_COLORS[plan] ?? PLAN_COLORS.basic;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", padding: "3px 10px", borderRadius: "20px", fontSize: "10px", fontWeight: 700, fontFamily: F.body, color: c.fg, background: c.bg, letterSpacing: "0.04em" }}>
      {labelled(TENANT_PLAN_LABEL, plan)}
    </span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const c = STATUS_COLORS[status] ?? STATUS_COLORS.active;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", padding: "3px 10px", borderRadius: "20px", fontSize: "10px", fontWeight: 700, fontFamily: F.body, color: c.fg, background: c.bg, letterSpacing: "0.04em" }}>
      {labelled(ACTIVE_STATUS_LABEL, status)}
    </span>
  );
}

// ── KPI Card ────────────────────────────────────────────────────────────────
export function KpiCard({ label, value, icon: Icon, gradient, loading }: {
  label: string; value: string | number; icon: LucideIcon; gradient: string; loading?: boolean;
}) {
  return (
    <div className="kpi-hero" style={{ padding: "22px", position: "relative", overflow: "hidden" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "16px" }}>
        <span style={{ fontFamily: F.display, fontSize: "10px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: COLORS.textTertiary }}>{label}</span>
        <div style={{ width: "40px", height: "40px", borderRadius: "12px", background: gradient, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Icon size={18} color="#fff" />
        </div>
      </div>
      {loading
        ? <div style={{ height: "28px", borderRadius: "8px", background: COLORS.surfaceLight, animation: "pulse 1.5s infinite" }} />
        : <div style={{ fontFamily: F.display, fontSize: "28px", fontWeight: 700, color: COLORS.textPrimary, lineHeight: 1, letterSpacing: "-0.03em" }}>{value}</div>
      }
    </div>
  );
}

// ── Section wrapper ─────────────────────────────────────────────────────────
export function Section({ title, icon: Icon, children }: {
  title: string; icon: LucideIcon; children: React.ReactNode;
}) {
  return (
    <div style={{ background: COLORS.surface, borderRadius: "20px", boxShadow: "var(--shadow-sm, 0 1px 3px rgba(0,0,0,.06), 0 1px 2px rgba(0,0,0,.04))" }}>
      <div style={{ padding: "16px 20px", display: "flex", alignItems: "center", gap: "10px", borderBottom: `1px solid ${COLORS.border}` }}>
        <div style={{ width: "28px", height: "28px", borderRadius: "8px", display: "flex", alignItems: "center", justifyContent: "center", background: "color-mix(in srgb, var(--color-primary) 10%, transparent)", color: COLORS.primaryText }}>
          <Icon size={14} />
        </div>
        <h3 style={{ fontFamily: F.display, fontSize: "13px", fontWeight: 600, color: COLORS.textPrimary }}>{title}</h3>
      </div>
      <div style={{ padding: "20px" }}>{children}</div>
    </div>
  );
}

// ── Modal ───────────────────────────────────────────────────────────────────
/**
 * Окно суперадмина — общий шелл приложения, а не свой.
 *
 * Здесь стояла голая подложка с панелью: ни Escape, ни возврата фокуса, ни
 * замка прокрутки, ни поправки на клавиатуру. Заголовок каждое окно рисовало
 * само, и два окна выглядели по-разному. AppModal всё это уже умеет.
 */
export function Modal({ onClose, title, subtitle, footer, maxWidth = 480, children }: {
  onClose: () => void;
  title: string;
  subtitle?: string;
  footer?: React.ReactNode;
  maxWidth?: number;
  children: React.ReactNode;
}) {
  return (
    <AppModal open onClose={onClose} title={title} subtitle={subtitle} footer={footer} maxWidth={maxWidth}>
      {children}
    </AppModal>
  );
}

// ── Input ───────────────────────────────────────────────────────────────────
export function Input({ label, ...props }: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div>
      <label style={{ fontFamily: F.body, fontSize: "10px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: COLORS.textTertiary, display: "block", marginBottom: "6px" }}>{label}</label>
      <input {...props} style={{ width: "100%", padding: "10px 14px", borderRadius: "10px", border: `1px solid ${COLORS.border}`, background: COLORS.surfaceLight, color: COLORS.textPrimary, fontFamily: F.body, fontSize: "13px", outline: "none", transition: "border-color 0.15s", ...props.style }} />
    </div>
  );
}

// ── Buttons ─────────────────────────────────────────────────────────────────
export function BtnPrimary({ children, disabled, onClick, style: s }: {
  children: React.ReactNode; disabled?: boolean; onClick?: () => void; style?: React.CSSProperties;
}) {
  return (
    <button onClick={onClick} disabled={disabled} style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "6px", padding: "10px 20px", borderRadius: "10px", fontSize: "13px", fontWeight: 600, fontFamily: F.body, color: "var(--color-on-primary)", background: "var(--color-primary)", border: "none", cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.5 : 1, transition: "all 0.2s", ...s }}>
      {children}
    </button>
  );
}

export function BtnSecondary({ children, onClick, style: s }: {
  children: React.ReactNode; onClick?: () => void; style?: React.CSSProperties;
}) {
  return (
    <button onClick={onClick} style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "6px", padding: "10px 20px", borderRadius: "10px", fontSize: "13px", fontWeight: 600, fontFamily: F.body, color: COLORS.textSecondary, background: COLORS.surface, border: `1px solid ${COLORS.border}`, cursor: "pointer", transition: "all 0.15s", ...s }}>
      {children}
    </button>
  );
}
