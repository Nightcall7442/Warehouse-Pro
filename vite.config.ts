import devServer from "@hono/vite-dev-server";
import path from "path";
const __dirname = import.meta.dirname;
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { sentryVitePlugin } from "@sentry/vite-plugin";

let VitePWA: any = () => ({});
try {
  const mod = await import("vite-plugin-pwa");
  VitePWA = mod.VitePWA;
} catch { /* not installed yet */ }

export default defineConfig({
  plugins: [
    devServer({
      entry: "api/boot.ts",
      exclude: [
        /^(?!\/api\/)/,
      ],
    }),
    react(),
    // Sentry source maps upload — only when SENTRY_AUTH_TOKEN is set
    process.env.SENTRY_AUTH_TOKEN && sentryVitePlugin({
      org: process.env.SENTRY_ORG || "nightcall",
      project: process.env.SENTRY_PROJECT || "warehouse-pro",
      authToken: process.env.SENTRY_AUTH_TOKEN,
      sourcemaps: {
        assets: "./dist/**",
        ignore: ["node_modules"],
      },
    }),
    VitePWA({      registerType:  "autoUpdate",
      includeAssets: ["icon-192.png", "icon-512.png", "offline.html"],
      manifest: {
        name:             "Warehouse Pro",
        short_name:       "WH Pro",
        description:      "Multi-tenant warehouse management",
        theme_color:      "#0f1117",
        background_color: "#0f1117",
        display:          "standalone",
        orientation:      "portrait-primary",
        start_url:        "/",
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any maskable" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" },
        ],
        shortcuts: [
          { name: "New Order",  url: "/orders/new",  description: "Create a new order" },
          { name: "My Plans",   url: "/agent/plans", description: "View daily plans"   },
          { name: "GPS",        url: "/agent/gps",   description: "Share location"     },
        ],
      },
      workbox: {
        navigateFallback:         "/index.html",
        navigateFallbackDenylist: [/^\/api\//],
        globPatterns:             ["**/*.{js,css,html,json,png,svg,ico}"],
        runtimeCaching: [
          {
            urlPattern: /^\/api\/trpc\//,
            handler:    "NetworkFirst",
            options: {
              cacheName:             "trpc-cache",
              networkTimeoutSeconds: 3,
              expiration:            { maxEntries: 50, maxAgeSeconds: 300 },
            },
          },
        ],
      },
    }),
  ].filter(Boolean),
  server: {
    port: 3000,
    host: '0.0.0.0',
    allowedHosts: true,
  },
  resolve: {
    alias: {
      "@":          path.resolve(__dirname, "./src"),
      "@contracts": path.resolve(__dirname, "./contracts"),
      "@db":        path.resolve(__dirname, "./db"),
      "db":         path.resolve(__dirname, "./db"),
    },
  },
  envDir: path.resolve(__dirname),
  build: {
    outDir:      path.resolve(__dirname, "dist/public"),
    emptyOutDir: true,
    target:      "es2022",
    cssTarget:   "es2022",
    sourcemap:   true, // Required for Sentry source maps
    rollupOptions: {
      output: {
        manualChunks: {
          "vendor-react":    ["react", "react-dom", "react-router"],
          "vendor-charts":   ["recharts"],
          "vendor-excel":     ["exceljs"],
          "vendor-ui":       ["@radix-ui/react-dialog", "@radix-ui/react-select", "@radix-ui/react-popover", "@radix-ui/react-dropdown-menu"],
          "vendor-utils":    ["date-fns", "clsx", "tailwind-merge"],
        },
      },
    },
  },
});
