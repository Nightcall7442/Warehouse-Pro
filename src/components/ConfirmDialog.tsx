import { memo, useState } from "react";
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
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" }}>
      <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.4)", backdropFilter: "blur(4px)" }} onClick={onCancel}/>
      <div style={{ position: "relative", width: "100%", maxWidth: "400px", background: "#ffffff", borderRadius: "16px", padding: "24px", boxShadow: "0 25px 50px -12px rgba(0,0,0,0.15)" }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: "12px", marginBottom: "16px" }}>
          {danger && (
            <div style={{ width: "40px", height: "40px", borderRadius: "50%", background: "rgba(248,113,113,0.1)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <AlertTriangle size={20} style={{ color: "#f87171" }}/>
            </div>
          )}
          <div style={{ flex: 1 }}>
            <h2 style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px", fontWeight: 600, color: "#111827", margin: 0 }}>{title}</h2>
            <p style={{ fontSize: "13px", color: "#6b7280", margin: "4px 0 0" }}>{message}</p>
          </div>
          <button onClick={onCancel} style={{ padding: "4px", background: "none", border: "none", cursor: "pointer", color: "#9ca3af" }}>
            <X size={18}/>
          </button>
        </div>
        <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
          <button onClick={onCancel} style={{ padding: "8px 16px", borderRadius: "8px", fontSize: "13px", fontWeight: 500, fontFamily: "'DM Sans', sans-serif", color: "#6b7280", background: "#f8f9fb", border: "none", cursor: "pointer" }}>Cancel</button>
          <button onClick={onConfirm}
            style={{
              padding: "8px 16px", borderRadius: "8px", fontSize: "13px", fontWeight: 600,
              fontFamily: "'DM Sans', sans-serif", border: "none", cursor: "pointer",
              background: danger ? "#f87171" : "linear-gradient(135deg, #818cf8, #6366f1)",
              color: "#fff",
            }}>
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
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
