/**
 * Снимки настоящей программы для лендинга.
 *
 * Их делает конвейер снимков (scripts/screenshots.mjs, ветки docs/landing-*),
 * а не дизайнер: веб — 1440×1000 в двойной плотности, телефон — iPhone 13.
 * Кадры лежат в public/landing/<язык>/… и обрезаются/оправляются один раз
 * скриптом; здесь — их адреса и пропорции, чтобы раскладка не зависела от
 * загрузки картинки (aspect-ratio ставится ДО того, как кадр приедет).
 *
 * Язык подставляется вызовом shot(key, lang): снимки на русском и узбекском —
 * разные файлы, как и всё остальное на странице.
 */
export type Lang = "ru" | "uz";

/** Веб-кадры: полное окно приложения, 1440×1000. */
export const WEB_SHOTS = {
  dashboard:     "web-ceo-dashboard",
  pnl:           "web-ceo-pnl",
  reports:       "web-ceo-reports",
  salaries:      "web-ceo-salaries",
  orders:        "web-operator-orders",
  picking:       "web-operator-picking",
  warehouse:     "web-operator-warehouse",
  quickOrder:    "web-operator-quick-order",
  products:      "web-operator-products",
  map:           "web-supervisor-map",
  plansMonth:    "web-supervisor-plans-month",
  supervisorKpi: "web-supervisor-kpi",
} as const;

/** Кадры телефона: 390×664 (iPhone 13 в Expo web, без системных полос), в тройной плотности. */
export const MOBILE_SHOTS = {
  home:        "mobile-agent-home",
  catalog:     "mobile-agent-catalog",
  orderStep2:  "mobile-agent-order-step2",
  orders:      "mobile-agent-orders",
  shops:       "mobile-agent-shops",
  plan:        "mobile-agent-plan",
  debts:       "mobile-agent-debts",
  salary:      "mobile-agent-salary",
  gps:         "mobile-agent-gps",
  deliveries:  "mobile-courier-deliveries",
  deliver:     "mobile-courier-deliver",
  visitReport: "mobile-merchandiser-visit-report",
  supMap:      "mobile-supervisor-map",
  targets:     "mobile-supervisor-targets",
} as const;

export type WebShotKey = keyof typeof WEB_SHOTS;
export type MobileShotKey = keyof typeof MOBILE_SHOTS;

/** Пропорции кадров — задаются раскладке заранее. */
export const WEB_ASPECT = "1440 / 1000";
export const MOBILE_ASPECT = "390 / 664";

export const webShot = (key: WebShotKey, lang: Lang) => `/landing/${lang}/${WEB_SHOTS[key]}.webp`;
/** Только карта из кадра «Слежение» — вырезка делается scripts/landing_shots.py. */
export const mapCrop = (lang: Lang) => `/landing/${lang}/map-crop.webp`;
export const MAP_CROP_ASPECT = "868 / 755";
export const mobileShot = (key: MobileShotKey, lang: Lang) => `/landing/${lang}/${MOBILE_SHOTS[key]}.webp`;

/**
 * Страницы руководства — с выносками: это и есть то, что рекламируется.
 * Копии из docs/manual/img в public/landing/manual/<язык>/.
 */
export const MANUAL_PAGES = {
  ordersWeb:     "web-operator-orders",
  dashboardWeb:  "web-ceo-dashboard",
  orderMobile:   "mobile-agent-order-step2",
  deliverMobile: "mobile-courier-deliver",
  mapWeb:        "web-supervisor-map",
  salaryMobile:  "mobile-agent-salary",
} as const;
export type ManualPageKey = keyof typeof MANUAL_PAGES;
export const manualPage = (key: ManualPageKey, lang: Lang) => `/landing/manual/${lang}/${MANUAL_PAGES[key]}.webp`;
