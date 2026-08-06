import { memo, useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, X } from "lucide-react";

interface Props {
  title:       string;
  message:     string;
  confirmText?: string;
  danger?:     boolean;
  onConfirm:   () => void;
  onCancel:    () => void;
}

export const ConfirmDialog = memo(function ConfirmDialog({ title, message, confirmText = "Confirm", danger = false, onConfirm, onCancel }: Props) {
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // Radix Select/DropdownMenu, закрываясь ровно в тот момент, когда открывается
    // это подтверждение, оставляет на <body> инлайновый pointer-events:none.
    // Диалог — это портал ВНУТРИ body, поэтому он наследует none и перестаёт
    // ловить клики: кнопки не нажимаются, а весь экран мёртв до перезагрузки.
    // Снимаем залипший стиль при открытии и не восстанавливаем его при закрытии —
    // «none» на body после закрытого меню никому не нужен и есть сам баг.
    document.body.style.pointerEvents = "";
    return () => {
      document.body.style.overflow = prevOverflow;
      document.body.style.pointerEvents = "";
    };
  }, []);

  const content = (
    <div style={{
      position: "fixed",
      inset: 0,
      zIndex: 99999,
      // Явный auto перекрывает возможный pointer-events:none, унаследованный от
      // body: диалог остаётся кликабельным, что бы ни оставил после себя Radix.
      pointerEvents: "auto",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "16px",
    }}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "rgba(0,0,0,0.5)",
          backdropFilter: "blur(4px)",
        }}
        onClick={onCancel}
      />
      <div
        style={{
          position: "relative",
          width: "100%",
          maxWidth: "400px",
          background: "var(--color-surface, #efedea)",
          borderRadius: "16px",
          padding: "24px",
          boxShadow: "0 25px 50px -12px rgba(0,0,0,0.25)",
          zIndex: 1,
        }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ display: "flex", alignItems: "flex-start", gap: "12px", marginBottom: "16px" }}>
          {danger && (
            <div style={{ width: "40px", height: "40px", borderRadius: "50%", background: "color-mix(in srgb, var(--color-danger) 10%, transparent)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <AlertTriangle size={20} style={{ color: "var(--color-danger-text)" }}/>
            </div>
          )}
          <div style={{ flex: 1 }}>
            <h2 style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px", fontWeight: 600, color: "var(--color-text-primary, #2b2a28)", margin: 0 }}>{title}</h2>
            <p style={{ fontSize: "13px", color: "var(--color-text-secondary, #5e5b54)", margin: "4px 0 0", lineHeight: "1.5" }}>{message}</p>
          </div>
          <button onClick={onCancel} style={{ padding: "4px", background: "none", border: "none", cursor: "pointer", color: "var(--color-text-tertiary, #6b6760)" }}>
            <X size={18}/>
          </button>
        </div>
        <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
          <button onClick={onCancel} style={{ padding: "8px 16px", borderRadius: "8px", fontSize: "13px", fontWeight: 500, fontFamily: "'DM Sans', sans-serif", color: "var(--color-text-secondary, #5e5b54)", background: "var(--color-surface-light, #f6f4f0)", border: "none", cursor: "pointer" }}>Отмена</button>
          <button onClick={onConfirm}
            style={{
              padding: "8px 16px", borderRadius: "8px", fontSize: "13px", fontWeight: 600,
              fontFamily: "'DM Sans', sans-serif", border: "none", cursor: "pointer",
              background: danger ? "var(--color-danger)" : "var(--color-primary)",
              color: "#fff",
            }}>
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(content, document.body);
});

// Hook for easy use
// eslint-disable-next-line react-refresh/only-export-components
export function useConfirm() {
  const [state, setState] = useState<{
    open: boolean;
    title: string;
    message: string;
    confirmText?: string;
    danger?: boolean;
    resolve?: (confirmed: boolean) => void;
  }>({ open: false, title: "", message: "" });

  const confirm = (opts: { title: string; message: string; confirmText?: string; danger?: boolean }) =>
    new Promise<boolean>(resolve => {
      setState({ open: true, ...opts, resolve });
    });

  const dialog = state.open ? (
    <ConfirmDialog
      title={state.title}
      message={state.message}
      confirmText={state.confirmText}
      danger={state.danger}
      onConfirm={() => { state.resolve?.(true);  setState(s => ({ ...s, open: false })); }}
      onCancel={() =>  { state.resolve?.(false); setState(s => ({ ...s, open: false })); }}
    />
  ) : null;

  return { confirm, dialog };
}
