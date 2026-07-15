import { useState, useEffect } from "react";
import { Download, X } from "lucide-react";

const DISMISS_KEY = "pwa_prompt_dismissed_until";

export function InstallPrompt() {
  const [prompt, setPrompt]     = useState<Event | null>(null);
  const [visible, setVisible]   = useState(false);

  useEffect(() => {
    // Don't show if dismissed within last 7 days
    const until = localStorage.getItem(DISMISS_KEY);
    if (until && new Date(until) > new Date()) return;

    const handler = (e: Event) => {
      e.preventDefault();
      setPrompt(e);
      setVisible(true);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  if (!visible || !prompt) return null;

  const install = async () => {
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
    const week = new Date(Date.now() + 7 * 86_400_000).toISOString();
    localStorage.setItem(DISMISS_KEY, week);
  };

  return (
    <div className="fixed bottom-20 md:bottom-6 left-4 right-4 md:left-auto md:right-6 md:w-80 z-50">
      <div className="panel p-4 shadow-2xl border border-primary/30 bg-surface">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 bg-primary/15 rounded-lg flex items-center justify-center flex-shrink-0">
            <Download size={18} className="text-primary"/>
          </div>
          <div className="flex-1">
            <p className="font-medium text-text-primary text-sm">Установить Warehouse Pro</p>
            <p className="text-xs text-text-secondary mt-0.5">
              Работает офлайн, быстрый доступ с экрана
            </p>
          </div>
          <button onClick={dismiss} className="text-text-secondary hover:text-text-primary flex-shrink-0">
            <X size={16}/>
          </button>
        </div>
        <div className="flex gap-2 mt-3">
          <button onClick={install}  className="btn-primary flex-1 py-2 text-sm">Установить</button>
          <button onClick={dismiss}  className="btn-secondary flex-1 py-2 text-sm">Не сейчас</button>
        </div>
      </div>
    </div>
  );
}
