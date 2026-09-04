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
import { notify, shouldTellUser } from "@/lib/toast"
import App from './App.tsx'
import { RadixPointerEventsGuard } from "@/components/RadixPointerEventsGuard"

/*
  Необработанные ошибки: человеку — одна фраза, подробности — в журнал.

  Здесь в тост уходил САМ текст ошибки: notify.error(`Ошибка: ${msg}`). Агент
  в магазине видел английский текст уровня стека — например «Failed to
  register a ServiceWorker for scope ('...') with script ('...'): An unknown
  error occurred when fetching the script». Понять по нему нечего, сделать —
  тем более, а занимает он половину экрана.

  Теперь наружу идёт одна человеческая фраза, а текст уходит в консоль и в
  Sentry — он ловит эти же события своей интеграцией globalHandlers.
  Решение, говорить ли вообще, живёт в shouldTellUser (lib/toast.ts).
*/
function report(msg: string) {
  console.error("[необработанная ошибка]", msg);
  if (shouldTellUser(msg)) notify.error("Что-то пошло не так. Попробуйте ещё раз.");
}

window.onerror = (message) => {
  report(typeof message === "string" ? message : String(message));
};

window.addEventListener("unhandledrejection", (event) => {
  report(event.reason?.message || String(event.reason));
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
