#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════
   Картинки карточек ссылок (og:image) — 1200×630, своя у каждой страницы
   сайта на каждом языке: public/og/<страница>-<язык>.jpg.

   ── Зачем ──────────────────────────────────────────────────────────────────

   Ссылку на сайт шлют в Telegram и WhatsApp. Раньше карточкой был квадратный
   значок 512×512: мессенджер показывал маленькую иконку сбоку, и по ней не
   понять, что за страница и на каком языке. Большая картинка с заголовком
   страницы — то, по чему в переписке вообще кликают.

   ── Как ────────────────────────────────────────────────────────────────────

   Запускается руками, когда меняется заголовок страницы или страница
   добавляется, — не при сборке: Chromium в образе выкладки не нужен.
   Картинки коммитятся. Проверка (site-pages-plumbing) сверяет, что у каждой
   страницы из contracts/site-pages есть своя картинка ровно 1200×630.

     node scripts/og-images.mjs
     CHROMIUM_PATH=/opt/pw-browsers/chromium node scripts/og-images.mjs

   Второй вид — когда Chromium Playwright другой версии, чем пакет: путь к
   любому Chromium подходит, снимок экрана от версии не зависит.

   Палитра — бумага, чернила и латунь лендинга (landing-tokens LX), образ —
   его же поле ячеек (TallyField). Шрифты — свои, из public/fonts.
   ═══════════════════════════════════════════════════════════════════════════ */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
// Node 24 читает .ts сам (типы просто отбрасываются); модуль без импортов.
import { OG_HEIGHT, OG_WIDTH, SITE_PAGES, ogImagePath, pageLangs } from "../contracts/site-pages.ts";

const ROOT = path.resolve(import.meta.dirname, "..");
const FONTS = path.join(ROOT, "public", "fonts");

const PAPER = "#f4f2ed";
const INK = "#26231e";
const INK_SOFT = "#57534a";
const BRASS = "#a8763e";
const BRASS_TEXT = "#8a5f2e";
const FREE = "rgba(72,66,55,0.18)";
const RULE = "rgba(72,66,55,0.16)";

/** Что написано на карточке. Только то, что говорит сама страница. */
const CARDS = {
  home: {
    ru: { kicker: "Программа для дистрибьюторов", title: "Агенты, долги магазинов и доставка — в одной программе", line: "Заказ с телефона даже без сети · склад · долг каждого магазина" },
    uz: { kicker: "Distribyutorlar uchun dastur", title: "Agentlar, do'kon qarzlari va yetkazish — bitta dasturda", line: "Tarmoqsiz ham telefondan buyurtma · ombor · har bir do'kon qarzi" },
  },
  compare: {
    ru: { kicker: "Сравнение систем", title: "Warehouse Pro, Sales Doctor, Smartup — раздел за разделом", line: "Что работает у нас и что другие говорят публично — со ссылками" },
    uz: { kicker: "Tizimlarni taqqoslash", title: "Warehouse Pro, Sales Doctor, Smartup — bo'limma-bo'lim", line: "Bizda nima ishlaydi, boshqalar ochiq nima deydi — havolalar bilan" },
  },
  privacy: {
    ru: { kicker: "Документ", title: "Политика конфиденциальности", line: "Что собирается, кто это видит, сколько хранится и как удалить" },
  },
};

/** Поле ячеек внизу карточки: та же занятость столбцов, что у TallyField. */
function tally() {
  const COLS = 120, ROWS = 7, CW = 10, CH = 12, MW = 3, MH = 8;
  const occupancy = c => Math.min(0.97, Math.max(0.18, 0.6 + 0.26 * Math.sin(c * 0.098 + 0.6) + 0.1 * Math.sin(c * 0.27 + 2.2)));
  const marks = [];
  for (let c = 0; c < COLS; c++) {
    const filled = Math.round(occupancy(c) * ROWS);
    const held = Math.max(1, Math.round(filled * 0.17));
    for (let r = 0; r < ROWS; r++) {
      const fill = r >= filled ? FREE : r >= filled - held ? BRASS : INK;
      marks.push(`<rect x="${c * CW + (CW - MW) / 2}" y="${(ROWS - 1 - r) * CH + (CH - MH) / 2}" width="${MW}" height="${MH}" fill="${fill}"/>`);
    }
  }
  return `<svg width="${COLS * CW}" height="${ROWS * CH}" viewBox="0 0 ${COLS * CW} ${ROWS * CH}">${marks.join("")}</svg>`;
}

const esc = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

function card({ kicker, title, line }, lang, pagePath) {
  const font = name => pathToFileURL(path.join(FONTS, name)).href;
  const mark = fs.readFileSync(path.join(ROOT, "src", "components", "brand", "mark.svg"), "utf8");
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><style>
@font-face { font-family: Manrope; font-weight: 200 800; src: url('${font("manrope-cyrillic-wght-normal.woff2")}') format('woff2'); unicode-range: U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116; }
@font-face { font-family: Manrope; font-weight: 200 800; src: url('${font("manrope-latin-wght-normal.woff2")}') format('woff2'); unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD; }
@font-face { font-family: Mono; font-weight: 100 800; src: url('${font("jetbrains-mono-latin-wght-normal.woff2")}') format('woff2'); unicode-range: U+0000-00FF, U+2000-206F; }
@font-face { font-family: Mono; font-weight: 100 800; src: url('${font("jetbrains-mono-cyrillic-wght-normal.woff2")}') format('woff2'); unicode-range: U+0400-045F; }
* { margin: 0; box-sizing: border-box; }
html, body { width: ${OG_WIDTH}px; height: ${OG_HEIGHT}px; background: ${PAPER}; color: ${INK}; font-family: Manrope, sans-serif; overflow: hidden; }
.frame { position: absolute; inset: 0; padding: 64px 72px 0; display: flex; flex-direction: column; }
.brand { display: flex; align-items: center; gap: 16px; font-weight: 800; font-size: 30px; letter-spacing: -0.02em; }
.brand svg { width: 52px; height: 52px; }
.kicker { margin-top: 56px; font-family: Mono, monospace; font-weight: 500; font-size: 20px; letter-spacing: 0.1em; text-transform: uppercase; color: ${BRASS_TEXT}; }
h1 { margin-top: 18px; font-weight: 800; font-size: 64px; line-height: 1.04; letter-spacing: -0.035em; max-width: 1020px; }
.line { margin-top: 22px; font-size: 26px; line-height: 1.4; color: ${INK_SOFT}; font-weight: 500; max-width: 1020px; }
.foot { position: absolute; left: 0; right: 0; bottom: 0; border-top: 1px solid ${RULE}; padding: 20px 0 22px; display: flex; flex-direction: column; align-items: center; gap: 14px; }
.url { position: absolute; right: 72px; top: 70px; font-family: Mono, monospace; font-size: 20px; color: ${INK_SOFT}; }
</style></head><body><div class="frame">
<div class="brand">${mark.replace(/<\?xml[^>]*>/, "")}<span>Warehouse Pro</span></div>
<div class="url">warehouse-pro.uz${pagePath === "/" ? "" : esc(pagePath)}</div>
<div class="kicker">${esc(kicker)}</div>
<h1>${esc(title)}</h1>
<div class="line">${esc(line)}</div>
</div><div class="foot">${tally()}</div></body></html>`;
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
try {
  const page = await browser.newPage({ viewport: { width: OG_WIDTH, height: OG_HEIGHT }, deviceScaleFactor: 1 });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "og-"));
  for (const sitePage of SITE_PAGES) {
    for (const lang of pageLangs(sitePage)) {
      const text = CARDS[sitePage.key]?.[lang];
      if (!text) throw new Error(`og-images: нет текста карточки для ${sitePage.key}/${lang}`);
      const file = path.join(tmp, `${sitePage.key}-${lang}.html`);
      fs.writeFileSync(file, card(text, lang, sitePage.paths[lang]));
      await page.goto(pathToFileURL(file).href);
      await page.evaluate(() => document.fonts.ready);
      const out = path.join(ROOT, "public", ogImagePath(sitePage.key, lang).slice(1));
      fs.mkdirSync(path.dirname(out), { recursive: true });
      await page.screenshot({ path: out, type: "jpeg", quality: 86 });
      console.log(`og-images: ${path.relative(ROOT, out)} ${(fs.statSync(out).size / 1024).toFixed(0)} КБ`);
    }
  }
  fs.rmSync(tmp, { recursive: true, force: true });
} finally {
  await browser.close();
}
