import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import './index.css'
import { TRPCProvider } from "@/providers/trpc"
import { Toaster } from "@/components/ui/sonner"
import { LangProvider } from "@/i18n"
import { InstallPrompt } from "@/components/InstallPrompt"
import App from './App.tsx'

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
