import * as Sentry from "@sentry/react";

Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN || "",
  integrations: [
    // Transactions are named by URL, not by route pattern. Parameterized names
    // need reactRouterBrowserTracingIntegration *and* a Sentry-wrapped <Routes>
    // in App.tsx — that integration turns off its own navigation tracking and
    // relies on the wrapper, so switching here alone would lose navigations.
    Sentry.browserTracingIntegration(),
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
      msg.includes("Loading chunk")
    ) {
      return null;
    }
    // Filter tRPC errors only if they're network-level (no server response)
    // Let server-side 500s and business logic errors through to Sentry
    if (msg.includes("TRPCClientError") && !msg.includes("500") && !msg.includes("INTERNAL_SERVER_ERROR")) {
      return null;
    }
    return event;
  },
});

// Note: window.onerror and unhandledrejection handlers are in main.tsx
// (shows toast notifications to users). Sentry captures via globalHandlers integration.
