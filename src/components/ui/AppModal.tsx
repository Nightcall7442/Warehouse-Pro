import { useEffect, useRef, useId } from "react";
import { createPortal } from "react-dom";
import { useOverlay } from "@/lib/overlay";
import { X } from "lucide-react";
import { useTranslate } from "@/i18n";

/**
 * The shared modal shell.
 *
 * Every page outside Orders already spoke one visual language — the neumorphic
 * `neo-*` system in index.css, with a brass gradient header, uppercase section
 * labels and a Save/Cancel footer. The Orders feature was built alongside it
 * with a private theme.tsx and inline styles, so its dialogs read as a
 * different product. This component is that shared language extracted from the
 * "Новый приход" modal, so a screen can adopt it instead of re-deriving it.
 *
 * What it adds beyond copying the markup: Escape closes, the page behind stops
 * scrolling, focus moves in on open and returns to wherever it came from on
 * close, and the header stays put while a long body scrolls under it. Those are
 * things every dialog needs and no dialog should have to reimplement.
 */
export interface AppModalProps {
  open: boolean;
  onClose: () => void;
  /**
   * В окне есть несохранённая работа.
   *
   * Тогда промах мимо панели и Escape перестают его закрывать. Без этого
   * один неточный клик стирал собранный заказ на двадцать позиций: подложка
   * звала onClose, а onClose в быстром заказе — это resetForm() плюс
   * закрытие. Ни подтверждения, ни черновика; двадцать строк, магазин,
   * скидка и примечание исчезали молча.
   *
   * Закрыть по-прежнему можно — крестиком или «Отмена». Это осознанное
   * действие, и спрашивать подтверждение уместно там, а не здесь.
   */
  dirty?: boolean;
  title: string;
  subtitle?: string;
  /** Max content width. Defaults to the 720px the arrival modal uses. */
  maxWidth?: number | string;
  /** Rendered against the bottom edge, outside the scrolling body. */
  footer?: React.ReactNode;
  /** Extra controls in the header, left of the close button. */
  headerActions?: React.ReactNode;
  children: React.ReactNode;
}

/** Section heading inside a modal body — matches the other pages' `sectionLabel`. */
export const modalSectionLabel = "font-label text-[10px] tracking-wider uppercase mb-3 block";
/** Label for an individual field. */
export const modalFieldLabel = "font-label text-[10px] text-secondary mb-1.5 block";

export function AppModal({
  open, onClose, title, subtitle, maxWidth = 720, footer, headerActions, children, dirty = false }: AppModalProps) {
  const t = useTranslate();
  const panelRef = useRef<HTMLDivElement>(null);
  // useId вместо случайного числа в ссылке.
  //
  // Прежняя строка делала во время отрисовки сразу две запретных вещи:
  // звала Math.random и читала .current у ссылки. React 19 даёт для этого
  // отдельный хук — он и предназначен для связывания подписи с полем.
  const titleId = useId();

  // Замок прокрутки, Escape (не трогает окно с работой — dirty) и возврат
  // фокуса — общие для всех окон (src/lib/overlay.ts). Здесь только фокус
  // на панель при открытии: эффект зависит лишь от open, иначе стрелка
  // onClose, новая на каждый рендер, уводила бы фокус из поля при каждом
  // нажатии клавиши.
  useOverlay({ open, onClose, dirty });
  useEffect(() => { if (open) panelRef.current?.focus(); }, [open]);

  if (!open) return null;

  return createPortal(
    <>
      {/*
        pointer-events-auto обязателен на обоих слоях.

        Пока открыта боковая панель Radix, он держит на <body> инлайновый
        pointer-events: none, чтобы страница под панелью не принимала клики.
        Этот портал — прямой потомок body, поэтому наследует запрет и окно
        оказывается видимым, но полностью мёртвым: ни ввести сумму, ни нажать
        «Завершить», ни «Отмена». Выход остаётся только через перезагрузку
        страницы.

        Сторож RadixPointerEventsGuard здесь не помогает и не должен: он снимает
        залипший запрет лишь тогда, когда открытых слоёв Radix не осталось, а
        панель в этот момент открыта намеренно — окно завершения заказа живёт
        поверх неё.

        Ровно так же вылечено окно долга в OrderSlideOver; здесь эта строка
        просто не была проставлена.
      */}
      <div
        className="pointer-events-auto"
        // Имя для проверок: искать затемнение по строке инлайнового стиля
        // хрупко — браузер переписывает rgba(0,0,0,.75) по-своему.
        data-modal-overlay
        style={{ position: "fixed", inset: 0, zIndex: 9999, backgroundColor: "rgba(0,0,0,0.75)" }}
        onClick={() => { if (!dirty) onClose(); }}
      />
      <div className="pointer-events-auto fixed inset-0 z-[10000] flex items-center justify-center p-4 app-modal-shell">
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          tabIndex={-1}
          className="relative w-full neo-card animate-scale-in flex flex-col outline-none"
          style={{
            maxWidth: typeof maxWidth === "number" ? `${maxWidth}px` : maxWidth,
            // Не выше оставшейся от клавиатуры полосы: 90vh считается от
            // полного экрана, и с открытой клавиатурой панель была бы выше
            // места, которое ей осталось.
            maxHeight: "min(90vh, calc(100vh - var(--keyboard-inset, 0px) - 32px))",
            borderRadius: "24px",
            padding: 0,
            boxShadow: "0 25px 80px -12px rgba(0,0,0,0.35)",
          }}
        >
          {/* Brass gradient header — the signature the rest of the app uses. */}
          <div
            className="relative overflow-hidden shrink-0"
            style={{
              background: "linear-gradient(135deg, var(--color-primary), var(--color-primary-hover, #4a5c78))",
              borderRadius: "24px 24px 0 0",
              padding: "28px 32px 24px",
            }}
          >
            <div className="absolute -top-16 -right-16 w-40 h-40 rounded-full" style={{ background: "rgba(255,255,255,0.08)" }} />
            <div className="absolute -bottom-8 -left-8 w-24 h-24 rounded-full" style={{ background: "rgba(255,255,255,0.05)" }} />
            <div className="relative flex items-center justify-between gap-4">
              <div className="min-w-0">
                <h2 id={titleId} className="text-xl font-bold mb-0.5 truncate" style={{ color: "var(--color-on-primary, #ffffff)" }}>{title}</h2>
                {subtitle && (
                  <p className="text-xs truncate" style={{ color: "color-mix(in srgb, var(--color-on-primary, #ffffff) 72%, transparent)" }}>{subtitle}</p>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {headerActions}
                <button
                  type="button"
                  onClick={onClose}
                  aria-label={t("Закрыть", "Yopish")}
                  className="neo-btn-icon"
                  style={{ width: "40px", height: "40px", background: "color-mix(in srgb, var(--color-on-primary, #ffffff) 18%, transparent)", color: "var(--color-on-primary, #ffffff)", borderRadius: "12px" }}
                >
                  <X size={20} />
                </button>
              </div>
            </div>
          </div>

          <div className="p-8 space-y-7 overflow-y-auto grow">
            {children}
          </div>

          {footer && (
            <div
              className="shrink-0 flex gap-3 px-8 py-5"
              style={{ borderTop: "1px solid var(--color-border, #d8d5cd)" }}
            >
              {footer}
            </div>
          )}
        </div>
      </div>
    </>,
    document.body,
  );
}
