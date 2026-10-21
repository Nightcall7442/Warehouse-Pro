import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, X } from "lucide-react";
import { useTranslate } from "@/i18n";
import { useOverlay } from "@/lib/overlay";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  DELIVERY_FAIL_REASONS, deliveryFailLabel, type DeliveryFailReason,
} from "@contracts/delivery-fail-reason";

/*
  Окно курьера и офиса для доставки: причина срыва, перенос, подтверждение.

  Устроено как «Почему без заказа?» у агента (components/visits/
  NoOrderReason.tsx): на телефоне — шторка снизу, под большой палец, на
  компьютере — окно по центру. Промах мимо и Escape не закрывают окно, в
  котором уже что-то набрано (dirty): курьер у прилавка, и случайное касание
  не должно стирать подпись магазина.
*/

export function DeliverySheet({ title, subtitle, dirty = false, onClose, children, footer, testId }: {
  title: string;
  subtitle?: string | null;
  dirty?: boolean;
  onClose: () => void;
  children: ReactNode;
  footer: ReactNode;
  testId?: string;
}) {
  const t = useTranslate();
  const phone = useIsMobile();
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => { panelRef.current?.focus(); }, []);
  useOverlay({ open: true, onClose, dirty });

  return createPortal(
    <div className="fixed inset-0 flex justify-center pointer-events-auto"
      style={{ zIndex: 10000, alignItems: phone ? "flex-end" : "center", padding: phone ? 0 : 16 }}>
      <div className="absolute inset-0" style={{ background: "var(--overlay-scrim)", backdropFilter: "blur(4px)" }}
        onClick={dirty ? undefined : onClose} aria-hidden />
      <div
        role="dialog" aria-modal="true" aria-labelledby={titleId} ref={panelRef} tabIndex={-1}
        className="neo-card pointer-events-auto relative w-full flex flex-col animate-scale-in outline-none"
        style={phone
          ? { borderRadius: "24px 24px 0 0", padding: "20px 16px calc(16px + env(safe-area-inset-bottom))", maxHeight: "92dvh", overflowY: "auto" }
          : { borderRadius: 24, padding: 24, maxWidth: 560, maxHeight: "90vh", overflowY: "auto" }}
        data-testid={testId}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id={titleId} style={{ fontSize: 18, fontWeight: 700, color: "var(--color-text-primary)", margin: 0 }}>{title}</h2>
            {subtitle && <p className="truncate" style={{ fontSize: 13, color: "var(--color-text-tertiary)", margin: "2px 0 0" }}>{subtitle}</p>}
          </div>
          <button type="button" onClick={onClose} aria-label={t("Закрыть", "Yopish")}
            className="neo-btn-icon flex-shrink-0" style={{ width: 44, height: 44, borderRadius: 12 }}>
            <X size={18} />
          </button>
        </div>
        <div style={{ marginTop: 16 }}>{children}</div>
        <div className="flex flex-wrap gap-2" style={{ marginTop: 16 }}>{footer}</div>
      </div>
    </div>,
    document.body,
  );
}

/** Выбор одной причины — кнопками, как у агента. */
export function ReasonChips({ value, onChange, lang, reasons = DELIVERY_FAIL_REASONS, testPrefix = "fail-reason" }: {
  value: DeliveryFailReason | null;
  onChange: (r: DeliveryFailReason) => void;
  lang: string;
  reasons?: readonly DeliveryFailReason[];
  testPrefix?: string;
}) {
  const t = useTranslate();
  return (
    <div role="radiogroup" aria-label={t("Причина", "Sabab")} className="grid grid-cols-1 sm:grid-cols-2 gap-2">
      {reasons.map(r => {
        const on = value === r;
        return (
          <button key={r} type="button" role="radio" aria-checked={on} onClick={() => onChange(r)}
            className="neo-btn tap flex items-center gap-2.5 text-left"
            style={{ minHeight: 48, padding: "10px 14px", borderRadius: 14, justifyContent: "flex-start", fontSize: 14, fontWeight: 600, whiteSpace: "normal",
                     color: on ? "var(--color-primary-text)" : "var(--color-text-primary)",
                     background: on ? "color-mix(in srgb, var(--color-primary) 14%, var(--color-surface))" : undefined }}
            data-testid={`${testPrefix}-${r}`}>
            <span className="flex items-center justify-center flex-shrink-0 rounded-full"
              style={{ width: 20, height: 20, background: on ? "var(--color-primary)" : "var(--color-surface-light)", boxShadow: on ? "none" : "var(--shadow-pressed)" }}>
              {on && <Check size={13} color="var(--color-on-primary)" strokeWidth={3} />}
            </span>
            <span className="min-w-0">{deliveryFailLabel(r, lang)}</span>
          </button>
        );
      })}
    </div>
  );
}
