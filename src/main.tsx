import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import './sentry' // Must be first — initializes Sentry before anything else
import './index.css'
import { TRPCProvider } from "@/providers/trpc"
import { WarehouseProvider } from "@/providers/WarehouseContext"
import { Toaster } from "@/components/ui/sonner"
import { LangProvider } from "@/i18n"
import { InstallPrompt } from "@/components/InstallPrompt"
import { notify } from "@/lib/toast"
import App from './App.tsx'
import { RadixPointerEventsGuard } from "@/components/RadixPointerEventsGuard"

// Sentry captures errors via globalHandlers integration
// These handlers show toast notifications to the user
window.onerror = (message) => {
  const msg = typeof message === "string" ? message : "Неизвестная ошибка";
  if (msg.includes("workbox") || msg.includes("non-precached-url") || msg.includes("createHandlerBoundToURL") || msg.includes("Loading chunk")) return;
  notify.error(`Ошибка: ${msg}`);
};

window.addEventListener("unhandledrejection", (event) => {
  const msg = event.reason?.message || String(event.reason) || "Необработанная ошибка";
  if (msg.includes("workbox") || msg.includes("non-precached-url") || msg.includes("net::ERR") || msg.includes("createHandlerBoundToURL")) return;
  // Only filter network-level tRPC errors; let server errors through
  if (msg.includes("TRPCClientError") && !msg.includes("500") && !msg.includes("INTERNAL_SERVER_ERROR")) return;
  notify.error(`Ошибка: ${msg}`);
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <TRPCProvider>
        <WarehouseProvider>
        <LangProvider>
          <App />
          {/* Возвращает клики, если Radix оставил pointer-events:none на body */}
          <RadixPointerEventsGuard />
          <Toaster richColors position="top-right" />
        <InstallPrompt />
        </LangProvider>
        </WarehouseProvider>
      </TRPCProvider>
    </BrowserRouter>
  </StrictMode>,
)
