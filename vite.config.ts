import devServer from "@hono/vite-dev-server";
import path from "path";
const __dirname = import.meta.dirname;
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

let VitePWA: any = () => ({});
try {
  const mod = await import("vite-plugin-pwa");
  VitePWA = mod.VitePWA;
} catch { /* not installed yet */ }

export default defineConfig({
  plugins: [
    devServer({
      entry: "api/boot.ts",
      // Только /api/* идёт на Hono. Всё остальное — Vite (фронт).
      exclude: [
        /^(?!\/api\/)/,
      ],
    }),
    react(),
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
        navigateFallback:         "/",
        navigateFallbackDenylist: [/^\/api\//],
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
    target:      "es2022",           // Smaller output than default es2015
    cssTarget:   "es2022",
    rollupOptions: {
      output: {
        manualChunks: {
          "vendor-react":    ["react", "react-dom", "react-router"],
          "vendor-charts":   ["recharts"],
          "vendor-xlsx":     ["xlsx"],
          "vendor-ui":       ["@radix-ui/react-dialog", "@radix-ui/react-select", "@radix-ui/react-popover", "@radix-ui/react-dropdown-menu"],
          "vendor-utils":    ["date-fns", "clsx", "tailwind-merge"],
        },
      },
    },
  },
});
