import * as Sentry from "@sentry/react";
import { useEffect } from "react";
import {
  useLocation,
  useRoutes,
  createRoutesFromChildren,
  matchRoutes,
} from "react-router";
import { router } from "./trpc.client";

Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN || "",
  integrations: [
    Sentry.browserTracingIntegration({
      useEffect,
      useLocation,
      useRoutes,
      createRoutesFromChildren,
      matchRoutes,
      router,
    }),
    Sentry.replayIntegration(),
  ],

  // Performance Monitoring
  tracesSampleRate: import.meta.env.PROD ? 0.2 : 1.0,

  // Session Replay — captures 100% of errors and 50% of normal sessions
  replaysSessionSampleRate: 0.5,
  replaysOnErrorSampleRate: 1.0,

  // Environment
  environment: import.meta.env.PROD ? "production" : "development",
  release: import.meta.env.VITE_APP_VERSION || "dev",

  // Don't send PII
  sendDefaultPii: false,

  // beforeSend — filter out noisy errors
  beforeSend(event) {
    // Ignore network errors and workbox noise
    const msg = event.exception?.values?.[0]?.value || "";
    if (
      msg.includes("workbox") ||
      msg.includes("non-precached-url") ||
      msg.includes("net::ERR") ||
      msg.includes("Loading chunk") ||
      msg.includes("TRPCClientError")
    ) {
      return null;
    }
    return event;
  },
});

// Global error handler — Sentry captures, toast shows to user
window.onerror = (message) => {
  const msg = typeof message === "string" ? message : "Неизвестная ошибка";
  if (
    msg.includes("workbox") ||
    msg.includes("non-precached-url") ||
    msg.includes("createHandlerBoundToURL") ||
    msg.includes("Loading chunk")
  )
    return;
  // Sentry already captures via globalHandlers integration
};

window.addEventListener("unhandledrejection", (event) => {
  const msg = event.reason?.message || String(event.reason) || "Необработанная ошибка";
  if (
    msg.includes("workbox") ||
    msg.includes("non-precached-url") ||
    msg.includes("net::ERR") ||
    msg.includes("createHandlerBoundToURL") ||
    msg.includes("TRPCClientError")
  )
    return;
  // Sentry already captures via globalHandlers integration
});
