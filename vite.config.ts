import devServer from "@hono/vite-dev-server";
import path from "path";
const __dirname = import.meta.dirname;
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { sentryVitePlugin } from "@sentry/vite-plugin";

let VitePWA: typeof import("vite-plugin-pwa").VitePWA = () => [];
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
    !!process.env.SENTRY_AUTH_TOKEN && sentryVitePlugin({
      org: process.env.SENTRY_ORG || "nightcall",
      project: process.env.SENTRY_PROJECT || "warehouse-pro",
      authToken: process.env.SENTRY_AUTH_TOKEN,
      // Версия задаётся ЯВНО и той же, что уходит в браузер (VITE_APP_VERSION
      // в src/sentry.ts). Сам плагин пытается угадать её из git, а внутри
      // образа Docker каталога .git нет — карты загрузились бы под чужой
      // версией и к ошибке не подошли бы. Молча: стек остаётся
      // минифицированным, и понять почему — неоткуда.
      release: { name: process.env.VITE_APP_VERSION || process.env.SENTRY_RELEASE || "dev" },
      sourcemaps: {
        assets: "./dist/**",
        ignore: ["node_modules"],
      },
    }),
    VitePWA({
      registerType:         "autoUpdate",
      includeAssets:        ["icon-192.png", "icon-512.png", "icon-maskable-512.png", "favicon.ico", "offline.html"],
      manifest: {
        name:             "Warehouse Pro",
        short_name:       "WH Pro",
        description:      "Multi-tenant warehouse management",
        /* Цвет строки состояния и заставки при запуске с домашнего экрана.
            Были #0f1117 — тёмно-синий, которого нет ни в приложении, ни в
            знаке. Взяты цвета самого значка: заставка и иконка совпадают. */
        theme_color:      "#0d9488",
        background_color: "#0f5e57",
        display:          "standalone",
        orientation:      "portrait-primary",
        start_url:        "/",
        /*
         * «any» и «maskable» — разные картинки, а не одна с двумя ярлыками.
         *
         * Раньше оба значка объявлялись как "any maskable". Маскируемый значок
         * Android обрезает по своей форме — кругом, скруглённым квадратом,
         * каплей, — и рисунок обязан помещаться в 80% поля. У обычного знака
         * лента идёт почти к краям, поэтому при обрезке у него срезало углы
         * буквы. Для маски теперь свой файл, где знак уменьшен и отступ есть.
         */
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
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
        cleanupOutdatedCaches:    true,
        clientsClaim:             true,
        skipWaiting:              true,
        runtimeCaching: [
          // P0-12 FIX: Do not cache tRPC responses — sensitive tenant/user data must not persist in Cache Storage
          {
            urlPattern: /^\/api\/trpc\//,
            handler:    "NetworkOnly",
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
    // "hidden" — maps are generated for Sentry upload but not referenced from the
    // bundles, and they are stripped from the runtime image (see Dockerfile).
    sourcemap:   "hidden",
    // NOTE: no manualChunks here on purpose. The previous hand-written grouping
    // pulled react-dom into "vendor-charts" (recharts + lodash + d3), which made
    // that 448 KB chunk a static dependency of the entry — recharts was downloaded
    // on the login screen. Rollup's automatic splitting keeps chart code inside the
    // lazy page chunks that actually import it.
  },
});
