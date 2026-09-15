/**
 * Снимки для лендинга: из артефакта screenshots/ — в docs/landing/shots/.
 *
 * Лендинг показывает настоящую программу, а не нарисованные окна. Снимки
 * делает тот же конвейер, что и для руководства (scripts/screenshots.mjs),
 * но без выносок: здесь берутся чистые кадры, только нужные лендингу, и
 * кладутся в ветку docs/landing-* — CI коммитит их сам, потому что артефакт
 * из закрытого репозитория без входа не скачать.
 *
 * Формат — webp q92: для интерфейса неотличим от PNG, а весит впятеро меньше.
 * Дальше кадры обрезаются и оправляются руками (public/landing/).
 *
 * Запуск: node scripts/landing-shots-collect.mjs [screenshots] [docs/landing/shots]
 * Пересъёмка после смены засева — тем же прогоном: db/seed.ts стоит в триггерах.
 * Нужен cwebp (пакет webp).
 */
import { readFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const SRC = process.argv[2] ?? "screenshots";
const OUT = process.argv[3] ?? join("docs", "landing", "shots");

/** Что лендингу нужно. Ключ — kind/role/screen как в index.json. */
export const WANTED = [
  "web/ceo/dashboard", "web/ceo/pnl", "web/ceo/reports", "web/ceo/salaries",
  "web/operator/orders", "web/operator/picking", "web/operator/warehouse", "web/operator/quick-order", "web/operator/products", "web/operator/product-detail",
  "web/supervisor/map", "web/supervisor/plans-month", "web/supervisor/kpi",
  "mobile/agent/home", "mobile/agent/catalog", "mobile/agent/order-step2", "mobile/agent/orders", "mobile/agent/shops",
  "mobile/agent/plan", "mobile/agent/debts", "mobile/agent/salary", "mobile/agent/gps",
  "mobile/courier/deliveries", "mobile/courier/deliver",
  "mobile/merchandiser/visit-report",
  "mobile/supervisor/map", "mobile/supervisor/targets",
];

const index = JSON.parse(readFileSync(join(SRC, "index.json"), "utf-8"));
const got = [];
const missing = [];

for (const kind of ["web", "mobile"]) {
  for (const e of index[kind] ?? []) {
    const key = `${kind}/${e.role}/${e.screen}`;
    if (!WANTED.includes(key)) continue;
    const src = join(SRC, e.file);
    if (!existsSync(src)) { missing.push({ key, lang: e.lang, why: "файла нет" }); continue; }
    const dir = join(OUT, e.lang); mkdirSync(dir, { recursive: true });
    const out = join(dir, `${kind}-${e.role}-${e.screen}.webp`);
    try {
      execFileSync("cwebp", ["-quiet", "-q", "92", "-m", "6", src, "-o", out]);
      got.push({ key, lang: e.lang, file: `${e.lang}/${kind}-${e.role}-${e.screen}.webp` });
    } catch (err) {
      missing.push({ key, lang: e.lang, why: String(err).slice(0, 200) });
    }
  }
}

for (const key of WANTED) {
  for (const lang of ["ru", "uz"]) {
    if (!got.some(g => g.key === key && g.lang === lang) && !missing.some(m => m.key === key && m.lang === lang)) {
      missing.push({ key, lang, why: "сценарий не снят (см. failures в index.json артефакта)" });
    }
  }
}

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "index.json"), JSON.stringify({ got, missing, failures: index.failures ?? [] }, null, 2));
console.log(`снимков для лендинга: ${got.length}, не хватает: ${missing.length}`);
for (const m of missing) console.log(`  — ${m.lang} ${m.key}: ${m.why}`);
