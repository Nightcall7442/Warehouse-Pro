import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, PlusCircle, X } from "lucide-react";
import { useLang } from "@/i18n";
import { useOverlay } from "@/lib/overlay";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  NO_ORDER_REASONS, NO_ORDER_NOTE_MAX, noOrderInputError, noOrderReasonLabel,
  type NoOrderReason,
} from "@contracts/no-order-reason";

/*
  «Почему без заказа?» — вопрос при закрытии визита, в котором нет заказа.

  Агент жмёт «Готово» (или снимок) у визита, а заказа этому магазину сегодня
  он не оформлял — экран не закрывает визит молча, а спрашивает причину: одну
  из шести, для «Другое» — коротко словами. Без причины кнопка «Закрыть
  визит» не нажимается. Заказ был (getPlans → hasOrder) — вопроса нет вовсе.

  Ручки принимают причину необязательной (старая мобилка её не шлёт);
  обязательна она только здесь, на экране.
*/

export interface NoOrderChoice {
  noOrderReason: NoOrderReason;
  noOrderNote?: string;
}

export interface GatePlan {
  id: number;
  shopId?: number | null;
  shopName?: string | null;
  hasOrder?: boolean | null;
}

export function NoOrderReasonDialog({ shopName, busy = false, onCancel, onConfirm, onOrder }: {
  shopName?: string | null;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: (choice: NoOrderChoice) => void;
  onOrder?: () => void;
}) {
  const { lang } = useLang();
  const t = (ru: string, uz: string) => (lang === "uz" ? uz : ru);
  const phone = useIsMobile();
  const titleId = useId();
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // Фокус — на окно, а не на первую причину: иначе «Закрыто» выглядит выбранным.
  useEffect(() => { panelRef.current?.focus(); }, []);
  const [reason, setReason] = useState<NoOrderReason | null>(null);
  const [note, setNote] = useState("");
  useOverlay({ open: true, onClose: onCancel, dirty: note.trim().length > 0 });

  const problem = reason ? noOrderInputError(reason, note) : null;
  const ready = reason !== null && problem === null && !busy;
  const hint = reason === null
    ? t("Выберите причину — без неё визит не закрыть", "Sababni tanlang — usiz tashrifni yopib bo'lmaydi")
    : problem === "note_required"
    ? t("Для «Другое» напишите коротко, что случилось", "«Boshqa» uchun nima bo'lganini qisqa yozing")
    : problem === "note_too_long"
    ? t(`Не длиннее ${NO_ORDER_NOTE_MAX} знаков`, `${NO_ORDER_NOTE_MAX} belgidan oshmasin`)
    : null;

  const pick = (r: NoOrderReason) => {
    setReason(r);
    if (r === "other") setTimeout(() => noteRef.current?.focus(), 0);
  };
  const submit = () => {
    if (!ready || !reason) return;
    onConfirm(reason === "other" ? { noOrderReason: reason, noOrderNote: note.trim() } : { noOrderReason: reason });
  };

  const panel: ReactNode = (
    <div
      role="dialog" aria-modal="true" aria-labelledby={titleId} ref={panelRef} tabIndex={-1}
      className="neo-card pointer-events-auto relative w-full flex flex-col animate-scale-in outline-none"
      style={phone
        ? { borderRadius: "24px 24px 0 0", padding: "20px 16px calc(16px + env(safe-area-inset-bottom))", maxHeight: "92dvh", overflowY: "auto" }
        : { borderRadius: 24, padding: 24, maxWidth: 520, maxHeight: "90vh", overflowY: "auto" }}
      data-testid="no-order-dialog"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id={titleId} style={{ fontSize: 18, fontWeight: 700, color: "var(--color-text-primary)", margin: 0 }}>
            {t("Почему без заказа?", "Nega buyurtmasiz?")}
          </h2>
          {shopName && <p className="truncate" style={{ fontSize: 13, color: "var(--color-text-tertiary)", margin: "2px 0 0" }}>{shopName}</p>}
        </div>
        <button type="button" onClick={onCancel} aria-label={t("Закрыть", "Yopish")}
          className="neo-btn-icon flex-shrink-0" style={{ width: 44, height: 44, borderRadius: 12 }}>
          <X size={18} />
        </button>
      </div>

      <div role="radiogroup" aria-label={t("Причина", "Sabab")} className="grid grid-cols-1 sm:grid-cols-2 gap-2" style={{ marginTop: 16 }}>
        {NO_ORDER_REASONS.map(r => {
          const on = reason === r;
          return (
            <button key={r} type="button" role="radio" aria-checked={on} onClick={() => pick(r)}
              className="neo-btn tap flex items-center gap-2.5 text-left"
              style={{ minHeight: 48, padding: "10px 14px", borderRadius: 14, justifyContent: "flex-start", fontSize: 14, fontWeight: 600, whiteSpace: "normal",
                       color: on ? "var(--color-primary-text)" : "var(--color-text-primary)",
                       background: on ? "color-mix(in srgb, var(--color-primary) 14%, var(--color-surface))" : undefined }}
              data-testid={`no-order-${r}`}>
              <span className="flex items-center justify-center flex-shrink-0 rounded-full"
                style={{ width: 20, height: 20, background: on ? "var(--color-primary)" : "var(--color-surface-light)", boxShadow: on ? "none" : "var(--shadow-pressed)" }}>
                {on && <Check size={13} color="var(--color-on-primary)" strokeWidth={3} />}
              </span>
              <span className="min-w-0">{noOrderReasonLabel(r, lang)}</span>
            </button>
          );
        })}
      </div>

      {reason === "other" && (
        <div style={{ marginTop: 12 }}>
          <label htmlFor={`${titleId}-note`} className="font-label text-[10px] text-secondary mb-1.5 block">
            {t("Что случилось", "Nima bo'ldi")}
          </label>
          <textarea id={`${titleId}-note`} ref={noteRef} value={note} onChange={e => setNote(e.target.value)} rows={2}
            maxLength={NO_ORDER_NOTE_MAX + 50}
            placeholder={t("Коротко: ремонт, переезд, сменился владелец…", "Qisqa: ta'mir, ko'chish, egasi almashgan…")}
            className="neo-input w-full" style={{ resize: "none" }} data-testid="no-order-note" />
        </div>
      )}

      {hint && <p role="status" style={{ fontSize: 12, color: "var(--color-text-tertiary)", margin: "12px 0 0" }} data-testid="no-order-hint">{hint}</p>}

      <div className="flex flex-wrap gap-2" style={{ marginTop: 16 }}>
        {onOrder && (
          <button type="button" onClick={onOrder} className="neo-btn tap flex items-center justify-center gap-1.5"
            style={{ minHeight: 48, padding: "0 16px", color: "var(--color-primary-text)" }}>
            <PlusCircle size={16} />{t("Оформить заказ", "Buyurtma berish")}
          </button>
        )}
        <button type="button" onClick={submit} disabled={!ready} aria-disabled={!ready}
          className="neo-btn-primary tap flex-1 flex items-center justify-center gap-1.5 disabled:opacity-40"
          style={{ minHeight: 48, minWidth: 180 }} data-testid="no-order-confirm">
          <Check size={16} />{t("Закрыть визит", "Tashrifni yopish")}
        </button>
      </div>
    </div>
  );

  return createPortal(
    <div className="fixed inset-0 flex justify-center pointer-events-auto"
      style={{ zIndex: 10000, alignItems: phone ? "flex-end" : "center", padding: phone ? 0 : 16 }}>
      <div className="absolute inset-0" style={{ background: "var(--overlay-scrim)", backdropFilter: "blur(4px)" }} onClick={onCancel} aria-hidden />
      {panel}
    </div>,
    document.body,
  );
}

