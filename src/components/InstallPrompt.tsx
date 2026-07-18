import { useState, useEffect } from "react";
import { Download, X, Share } from "lucide-react";

const DISMISS_KEY = "pwa_prompt_dismissed_until";
const iOSDismissKey = "pwa_ios_prompt_dismissed";

function isIOS(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function isStandalone(): boolean {
  return window.matchMedia("(display-mode: standalone)").matches || (window.navigator as any).standalone === true;
}

export function InstallPrompt() {
  const [prompt, setPrompt]     = useState<Event | null>(null);
  const [visible, setVisible]   = useState(false);
  const [isIos, setIsIos]       = useState(false);

  useEffect(() => {
    // Don't show if already standalone
    if (isStandalone()) return;

    // Don't show if dismissed within last 7 days
    const until = localStorage.getItem(DISMISS_KEY);
    if (until && new Date(until) > new Date()) return;

    // iOS: show manual instructions
    if (isIOS()) {
      const iosDismissed = localStorage.getItem(iOSDismissKey);
      if (iosDismissed === "true") return;
      setIsIos(true);
      setVisible(true);
      return;
    }

    // Android/Chrome: use beforeinstallprompt
    const handler = (e: Event) => {
      e.preventDefault();
      setPrompt(e);
      setVisible(true);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  if (!visible) return null;

  const install = async () => {
    if (!prompt) return;
    prompt.prompt();
    const { outcome } = await prompt.userChoice;
    setVisible(false);
    if (outcome === "dismissed") {
      const week = new Date(Date.now() + 7 * 86_400_000).toISOString();
      localStorage.setItem(DISMISS_KEY, week);
    }
  };

  const dismiss = () => {
    setVisible(false);
    if (isIos) {
      localStorage.setItem(iOSDismissKey, "true");
    } else {
      const week = new Date(Date.now() + 7 * 86_400_000).toISOString();
      localStorage.setItem(DISMISS_KEY, week);
    }
  };

  return (
    <div className="fixed bottom-20 md:bottom-6 left-4 right-4 md:left-auto md:right-6 md:w-80 z-50">
      <div className="panel p-4 shadow-2xl" style={{ border: "1px solid var(--color-border)", background: "var(--color-surface)", borderRadius: "16px" }}>
        <div className="flex items-start gap-3">
          <div style={{ width: "40px", height: "40px", borderRadius: "10px", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, background: "var(--color-primary-subtle)" }}>
            {isIos ? <Share size={18} style={{ color: "var(--color-primary)" }} /> : <Download size={18} style={{ color: "var(--color-primary)" }} />}
          </div>
          <div className="flex-1">
            <p style={{ fontWeight: 600, fontSize: "14px", color: "var(--color-text-primary)", margin: 0 }}>
              {isIos ? "Добавить на экран" : "Установить Warehouse Pro"}
            </p>
            {isIos ? (
              <div style={{ fontSize: "12px", color: "var(--color-text-secondary)", marginTop: "6px", lineHeight: 1.5 }}>
                <p style={{ margin: "0 0 4px" }}>1. Нажмите <strong>Поделиться</strong> ↗ внизу</p>
                <p style={{ margin: "0 0 4px" }}>2. Выберите <strong>На экран Домой</strong></p>
                <p style={{ margin: 0 }}>3. Нажмите <strong>Добавить</strong></p>
              </div>
            ) : (
              <p style={{ fontSize: "12px", color: "var(--color-text-secondary)", margin: "4px 0 0" }}>
                Работает офлайн, быстрый доступ с экрана
              </p>
            )}
          </div>
          <button onClick={dismiss} style={{ color: "var(--color-text-tertiary)", background: "none", border: "none", cursor: "pointer", flexShrink: 0, padding: 4 }}>
            <X size={16} />
          </button>
        </div>
        {!isIos && (
          <div className="flex gap-2 mt-3">
            <button onClick={install} className="flex-1 py-2 text-sm" style={{ borderRadius: "10px", border: "none", background: "var(--color-primary)", color: "#fff", fontWeight: 600, cursor: "pointer" }}>Установить</button>
            <button onClick={dismiss} className="flex-1 py-2 text-sm" style={{ borderRadius: "10px", border: "1px solid var(--color-border)", background: "var(--color-surface)", color: "var(--color-text-secondary)", cursor: "pointer" }}>Не сейчас</button>
          </div>
        )}
        {isIos && (
          <button onClick={dismiss} className="w-full mt-3 py-2 text-sm" style={{ borderRadius: "10px", border: "1px solid var(--color-border)", background: "var(--color-surface)", color: "var(--color-text-secondary)", cursor: "pointer" }}>Понятно</button>
        )}
      </div>
    </div>
  );
}
