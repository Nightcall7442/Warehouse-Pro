import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

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
  open, onClose, title, subtitle, maxWidth = 720, footer, headerActions, children,
}: AppModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useRef(`modal-title-${Math.random().toString(36).slice(2)}`).current;

  // Escape to close, and hold the page still behind the overlay. Without the
  // scroll lock the page underneath scrolls when the cursor leaves the panel,
  // which makes the modal feel detached from the app.
  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      previouslyFocused?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <>
      <div
        style={{ position: "fixed", inset: 0, zIndex: 9999, backgroundColor: "rgba(0,0,0,0.75)" }}
        onClick={onClose}
      />
      <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4">
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          tabIndex={-1}
          className="relative w-full neo-card animate-scale-in flex flex-col outline-none"
          style={{
            maxWidth: typeof maxWidth === "number" ? `${maxWidth}px` : maxWidth,
            maxHeight: "90vh",
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
                <h2 id={titleId} className="text-xl font-bold mb-0.5 truncate" style={{ color: "var(--color-on-primary, #fff)" }}>{title}</h2>
                {subtitle && (
                  <p className="text-xs truncate" style={{ color: "color-mix(in srgb, var(--color-on-primary, #fff) 72%, transparent)" }}>{subtitle}</p>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {headerActions}
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Закрыть"
                  className="neo-btn-icon"
                  style={{ width: "40px", height: "40px", background: "color-mix(in srgb, var(--color-on-primary, #fff) 18%, transparent)", color: "var(--color-on-primary, #fff)", borderRadius: "12px" }}
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
              style={{ borderTop: "1px solid var(--color-border, #f0f3f8)" }}
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
