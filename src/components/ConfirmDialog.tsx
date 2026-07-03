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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onCancel}/>
      <div className="relative panel p-6 w-full max-w-sm shadow-2xl">
        <div className="flex items-start gap-3 mb-4">
          {danger && (
            <div className="w-10 h-10 rounded-full bg-danger/10 flex items-center justify-center flex-shrink-0">
              <AlertTriangle size={20} className="text-danger"/>
            </div>
          )}
          <div className="flex-1">
            <h2 className="font-display text-base font-semibold text-text-primary">{title}</h2>
            <p className="text-sm text-text-secondary mt-1">{message}</p>
          </div>
          <button onClick={onCancel} className="text-text-secondary hover:text-text-primary">
            <X size={18}/>
          </button>
        </div>
        <div className="flex gap-2 justify-end">
          <button onClick={onCancel} className="btn-secondary py-2 px-4 text-sm">Cancel</button>
          <button onClick={onConfirm}
            className={`py-2 px-4 text-sm rounded font-label tracking-wider ${
              danger ? "bg-danger text-white hover:bg-danger/90" : "btn-primary"
            }`}>
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
