import React from "react";
import type { LucideIcon } from "lucide-react";
import { COLORS } from "./types";
import { AppModal } from "@/components/ui/AppModal";

/*
  Секция, поле и кнопки суперадминки — на общих классах продукта (.neo-card,
  .neo-input, .neo-btn, .neo-btn-primary), а не на своих рамках в одну точку:
  обводка вокруг кнопок и полей читалась как чужой продукт («дёшево»).
  Цели касания — 44 точки.
*/
export function Section({ title, icon: Icon, children }: {
  title: string; icon: LucideIcon; children: React.ReactNode;
}) {
  return (
    <section className="neo-card neo-card-static" style={{ padding: 0, borderRadius: 20 }}>
      <div style={{ padding: "16px 20px 0", display: "flex", alignItems: "center", gap: "10px", minHeight: 44 }}>
        <div style={{ width: "32px", height: "32px", borderRadius: "10px", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--color-primary-subtle)", color: COLORS.primaryText, flexShrink: 0 }}>
          <Icon size={16} />
        </div>
        <h3 style={{ fontSize: "15px", fontWeight: 700, color: COLORS.textPrimary, margin: 0 }}>{title}</h3>
      </div>
      <div style={{ padding: "14px 20px 20px" }}>{children}</div>
    </section>
  );
}

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
      <label style={{ fontSize: "12px", fontWeight: 600, color: COLORS.textSecondary, display: "block", marginBottom: "6px" }}>{label}</label>
      <input {...props} className="neo-input w-full" style={{ minHeight: 44, fontSize: 14, ...props.style }} />
    </div>
  );
}

export function BtnPrimary({ children, disabled, onClick, style: s }: {
  children: React.ReactNode; disabled?: boolean; onClick?: () => void; style?: React.CSSProperties;
}) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className="neo-btn-primary" style={{ minHeight: 44, ...s }}>
      {children}
    </button>
  );
}

export function BtnSecondary({ children, disabled, onClick, style: s }: {
  children: React.ReactNode; disabled?: boolean; onClick?: () => void; style?: React.CSSProperties;
}) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className="neo-btn" style={{ minHeight: 44, ...s }}>
      {children}
    </button>
  );
}
