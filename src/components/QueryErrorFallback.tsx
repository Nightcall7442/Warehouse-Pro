import { AlertTriangle, RefreshCw } from "lucide-react";

interface QueryErrorFallbackProps {
  onRetry: () => void;
  message?: string;
}

export function QueryErrorFallback({ onRetry, message }: QueryErrorFallbackProps) {
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      minHeight: "30vh", padding: "40px 20px", textAlign: "center", gap: "16px",
    }}>
      <div style={{
        width: "56px", height: "56px", borderRadius: "16px",
        background: "rgba(232,80,80,0.1)", display: "flex",
        alignItems: "center", justifyContent: "center",
      }}>
        <AlertTriangle size={24} color="var(--color-danger-text)" />
      </div>
      <p style={{
        fontSize: "14px", color: "var(--color-text-secondary, #6a7290)",
        margin: 0, maxWidth: "360px",
      }}>
        {message ?? "Не удалось загрузить данные. Проверьте подключение к интернету."}
      </p>
      <button
        onClick={onRetry}
        style={{
          display: "inline-flex", alignItems: "center", gap: "6px",
          padding: "10px 20px", fontSize: "13px", fontWeight: 600,
          fontFamily: "'DM Sans', sans-serif", borderRadius: "12px",
          border: "none", cursor: "pointer",
          background: "var(--color-primary)", color: "var(--color-on-primary, #fff)",
          boxShadow: "0 2px 8px color-mix(in srgb, var(--color-primary) 25%, transparent)",
        }}
      >
        <RefreshCw size={14} /> Повторить
      </button>
    </div>
  );
}
