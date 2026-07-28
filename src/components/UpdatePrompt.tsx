import { useRegisterSW } from "virtual:pwa-register/react";
import { RefreshCw, X } from "lucide-react";
import { useState } from "react";

export function UpdatePrompt() {
  const [dismissed, setDismissed] = useState(false);

  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(swUrl, registration) {
      // Check for updates every 60 minutes
      if (registration) {
        setInterval(() => registration.update(), 60 * 60 * 1000);
      }
    },
  });

  if (!needRefresh || dismissed) return null;

  return (
    <div className="fixed bottom-20 md:bottom-6 left-4 right-4 md:left-auto md:right-6 md:w-80 z-50">
      <div
        className="panel p-4 shadow-2xl"
        style={{
          border: "1px solid var(--color-border)",
          background: "var(--color-surface)",
          borderRadius: "16px",
        }}
      >
        <div className="flex items-start gap-3">
          <div
            style={{
              width: "40px",
              height: "40px",
              borderRadius: "10px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
              background: "rgba(52,196,115,0.12)",
            }}
          >
            <RefreshCw size={18} style={{ color: "#34c473" }} />
          </div>
          <div className="flex-1">
            <p
              style={{
                fontWeight: 600,
                fontSize: "14px",
                color: "var(--color-text-primary)",
                margin: 0,
              }}
            >
              Доступно обновление
            </p>
            <p
              style={{
                fontSize: "12px",
                color: "var(--color-text-secondary)",
                margin: "4px 0 0",
              }}
            >
              Новая версия приложения готова
            </p>
          </div>
          <button
            onClick={() => setDismissed(true)}
            style={{
              color: "var(--color-text-tertiary)",
              background: "none",
              border: "none",
              cursor: "pointer",
              flexShrink: 0,
              padding: 4,
            }}
          >
            <X size={16} />
          </button>
        </div>
        <div className="flex gap-2 mt-3">
          <button
            onClick={() => updateServiceWorker(true)}
            className="flex-1 py-2 text-sm"
            style={{
              borderRadius: "10px",
              border: "none",
              background: "#34c473",
              color: "#fff",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Обновить
          </button>
          <button
            onClick={() => setDismissed(true)}
            className="flex-1 py-2 text-sm"
            style={{
              borderRadius: "10px",
              border: "1px solid var(--color-border)",
              background: "var(--color-surface)",
              color: "var(--color-text-secondary)",
              cursor: "pointer",
            }}
          >
            Позже
          </button>
        </div>
      </div>
    </div>
  );
}
