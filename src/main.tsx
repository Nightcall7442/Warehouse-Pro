import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import './index.css'
import { TRPCProvider } from "@/providers/trpc"
import { Toaster } from "@/components/ui/sonner"
import { LangProvider } from "@/i18n"
import { InstallPrompt } from "@/components/InstallPrompt"
import { notify } from "@/lib/toast"
import App from './App.tsx'

// Глобальный обработчик необработанных ошибок JS — показывает toast
window.onerror = (message) => {
  const msg = typeof message === "string" ? message : "Неизвестная ошибка";
  if (msg.includes("workbox") || msg.includes("non-precached-url") || msg.includes("createHandlerBoundToURL") || msg.includes("Loading chunk")) return;
  notify.error(`Ошибка: ${msg}`);
};

// Необработанные промисы (fetch, async/await без catch)
window.addEventListener("unhandledrejection", (event) => {
  const msg = event.reason?.message || String(event.reason) || "Необработанная ошибка";
  if (msg.includes("workbox") || msg.includes("non-precached-url") || msg.includes("net::ERR") || msg.includes("createHandlerBoundToURL")) return;
  if (msg.includes("TRPCClientError")) return; // tRPC ошибки уже показываются в компонентах
  notify.error(`Ошибка: ${msg}`);
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <TRPCProvider>
        <LangProvider>
          <App />
          <Toaster richColors position="top-right" />
        <InstallPrompt />
        </LangProvider>
      </TRPCProvider>
    </BrowserRouter>
  </StrictMode>,
)
