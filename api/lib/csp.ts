import type { Context } from "hono";

/**
 * Политика безопасности содержимого (Content-Security-Policy) — один раз,
 * отдельно от boot.ts, чтобы её можно было проверить на живом запросе.
 *
 * ── Google Fonts — только справочнику ───────────────────────────────────────
 *
 * Приложение и сайт берут шрифты со своего сервера (public/fonts,
 * src/index.css), и чужой домен им больше не нужен: разрешение лишнего
 * источника стилей и шрифтов — это лишняя дверь. Но справочник дистрибьютора
 * (/manual, docs/manual — собирается scripts/build_manual.py) по-прежнему
 * подключает Manrope и IBM Plex Sans с Google Fonts. Убрать разрешение для
 * всех значило бы молча сломать его вид, поэтому оно осталось — только на
 * адресах /manual. *.gstatic.com в стилях — не шрифты, а встроенный
 * переводчик Chrome: он подкладывает свои стили оттуда.
 */
const forManual = (source: string) => (c: Context) =>
  c.req.path === "/manual" || c.req.path.startsWith("/manual/") ? source : "'self'";

export const CSP_DIRECTIVES = {
  defaultSrc: ["'self'"],
  scriptSrc:  ["'self'", "https://api-maps.yandex.ru", "https://core.apimaps.yandex.ru", "https://yastatic.net", "https://*.maps.yandex.net", "https://*.yandex.ru"],
  styleSrc:   ["'self'", "'unsafe-inline'", "https://*.gstatic.com", forManual("https://fonts.googleapis.com")],  // Tailwind + переводчик Chrome; Google Fonts — справочнику
  imgSrc:     ["'self'", "data:", "blob:", "https:"],  // product photos, S3, base64 avatars, blob previews
  connectSrc: ["'self'", "https://api-maps.yandex.ru", "https://*.ingest.de.sentry.io", "https://*.sentry.io"],
  workerSrc:  ["'self'", "blob:"],                      // tRPC, SSE, WebSocket, Yandex Maps
  fontSrc:    ["'self'", "data:", forManual("https://fonts.gstatic.com")],  // свои файлы; Google — справочнику
  frameAncestors: ["'none'"],
  objectSrc:  ["'none'"],
  baseUri:    ["'self'"],
  formAction: ["'self'"],
};
