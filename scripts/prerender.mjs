#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════
   Готовые HTML-страницы сайта — шаг `npm run build` после двух сборок vite.

     vite build                                   → dist/public (браузер)
     vite build --ssr src/site/entry-server.tsx   → dist/ssr    (Node)
     node scripts/prerender.mjs                   → dist/prerender

   ── Зачем ──────────────────────────────────────────────────────────────────

   Гость и робот должны получать текст страницы сразу, а не после сотен
   килобайт скрипта. Страницы рисует тот же код сайта (src/site/entry-server
   → renderSite), что и браузер, — без браузера: Chromium в образе не нужен.

   ── Что делается с оболочкой (dist/public/index.html) ──────────────────────

   · <html lang> — язык страницы;
   · блок между <!--seo--> и <!--/seo--> — <head> страницы (site-head:
     заголовок, описание, canonical, hreflang, карточка, schema.org);
   · заглушка между <!--root-fallback--> — разметка страницы;
   · в <head> — предзагрузка куска сайта (site-main) и куска самой страницы
     со всеми их статическими импортами: без неё браузер узнал бы о них только
     после выполнения входа, и куски ехали бы друг за другом, а не разом;
   · комментарии оболочки — пояснения для разработчика — не едут к гостю.

   Страница 404 — без скриптов вовсе: оживлять в ней нечего.

   Встроенных скриптов (inline) нет нигде: CSP их не пропускает. JSON-LD —
   данные, а не скрипт, его CSP не трогает.

   ── Куда ───────────────────────────────────────────────────────────────────

   dist/prerender, а не dist/public: раздача статики отдала бы
   dist/public/compare.html по адресу /compare.html, и у страницы стало бы два
   адреса. Отдаёт их api/lib/site-pages. Карта сборки (manifest) уезжает
   туда же: из dist/public её раздавали бы всем, а проверке light-start-entry
   она нужна и после сборки.

   Любое расхождение — метки нет в оболочке, страница пустая, куска нет в
   карте — роняет сборку: молча выложить страницу без текста хуже, чем
   не выложить.
   ═══════════════════════════════════════════════════════════════════════════ */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = path.resolve(import.meta.dirname, "..");
const PUBLIC = path.join(ROOT, "dist", "public");
const OUT = path.join(ROOT, "dist", "prerender");
const SSR_DIR = path.join(ROOT, "dist", "ssr");
const MANIFEST = path.join(PUBLIC, ".vite", "manifest.json");

/** Кусок каждой страницы — тот же, что грузит site-main (LOADERS). */
const PAGE_SOURCES = {
  home: "src/pages/Landing.tsx",
  compare: "src/pages/Compare.tsx",
  privacy: "src/pages/Privacy.tsx",
  agents: "src/site/articles/AgentsArticle.tsx",
  debts: "src/site/articles/DebtsArticle.tsx",
  reconciliation: "src/site/articles/ReconciliationArticle.tsx",
  delivery: "src/site/articles/DeliveryArticle.tsx",
  warehouse: "src/site/articles/WarehouseArticle.tsx",
};
const SITE_MAIN = "src/site/site-main.tsx";
const ENTRY = "index.html";

const fail = (message) => { throw new Error(`prerender: ${message}`); };

/** Заменить ровно одно место; нет его — сборка падает. Функция-замена: «$» в тексте страницы — просто знак. */
function replaceOnce(html, pattern, value, what) {
  if (!pattern.test(html)) fail(`в оболочке нет ${what}`);
  return html.replace(pattern, () => value);
}

/** Файлы куска и всех его статических импортов (без входа — он уже в оболочке). */
function closure(manifest, keys) {
  const js = [];
  const css = [];
  const seen = new Set([ENTRY]);
  const visit = (key) => {
    if (seen.has(key)) return;
    seen.add(key);
    const chunk = manifest[key] ?? fail(`в карте сборки нет ${key}`);
    js.push(chunk.file);
    for (const c of chunk.css ?? []) css.push(c);
    for (const i of chunk.imports ?? []) visit(i);
  };
  for (const k of keys) visit(k);
  return { js, css };
}

function preloadTags(manifest, pageSource) {
  const { js, css } = closure(manifest, [SITE_MAIN, pageSource]);
  return [
    ...css.map(f => `<link rel="stylesheet" crossorigin href="/${f}">`),
    ...js.map(f => `<link rel="modulepreload" crossorigin href="/${f}">`),
  ].join("\n    ");
}

function main() {
  const template = fs.readFileSync(path.join(PUBLIC, "index.html"), "utf8")
    // Пояснения оболочки — для разработчика; метки остаются.
    .replace(/[ \t]*<!--(?!\/?seo-->|\/?root-fallback-->)[\s\S]*?-->[ \t]*\n?/g, "");
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));

  const siteMain = manifest[SITE_MAIN] ?? fail(`в карте сборки нет ${SITE_MAIN}`);
  for (const [key, source] of Object.entries(PAGE_SOURCES)) {
    if (!(siteMain.dynamicImports ?? []).includes(source)) fail(`site-main не грузит ${source} (${key}) — сверить PAGE_SOURCES с LOADERS`);
  }

  return import(pathToFileURL(path.join(SSR_DIR, "entry-server.js")).href).then(({ renderSite, renderNotFound }) => {
    fs.rmSync(OUT, { recursive: true, force: true });
    const written = [];
    const write = (file, html) => {
      const target = path.join(OUT, file);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, html);
      written.push(`${file} ${(Buffer.byteLength(html) / 1024).toFixed(1)} КБ`);
    };

    for (const page of renderSite()) {
      if (page.html.length < 1000) fail(`${page.path}: страница почти пустая (${page.html.length} знаков)`);
      if (!page.head.includes('<meta name="wp-site"')) fail(`${page.path}: в <head> нет метки wp-site — браузер не узнает страницу сайта`);
      let html = template;
      html = replaceOnce(html, /<html lang="[^"]*"/, `<html lang="${page.lang}"`, "<html lang>");
      html = replaceOnce(html, /<!--seo-->[\s\S]*?<!--\/seo-->/, page.head, "блока <!--seo-->");
      html = replaceOnce(html, /<!--root-fallback-->[\s\S]*?<!--\/root-fallback-->/, page.html, "заглушки <!--root-fallback-->");
      html = replaceOnce(html, /\s*<\/head>/, `\n    ${preloadTags(manifest, PAGE_SOURCES[page.key])}\n  </head>`, "</head>");
      write(page.file, html);
    }

    const missing = renderNotFound();
    let html = template;
    html = replaceOnce(html, /<!--seo-->[\s\S]*?<!--\/seo-->/, missing.head, "блока <!--seo-->");
    html = replaceOnce(html, /<!--root-fallback-->[\s\S]*?<!--\/root-fallback-->/, missing.html, "заглушки <!--root-fallback-->");
    html = replaceOnce(html, /[ \t]*<script type="module"[^>]*><\/script>\n?/, "", "<script type=module>");
    html = html.replace(/[ \t]*<link rel="modulepreload"[^>]*>\n?/g, "");
    if (/<script(?![^>]*application\/ld\+json)/.test(html)) fail("в странице 404 остался скрипт");
    write(missing.file, html);

    // Карта сборки — из раздачи в dist/prerender (см. шапку).
    fs.writeFileSync(path.join(OUT, "build-manifest.json"), JSON.stringify(manifest, null, 2));
    fs.rmSync(path.join(PUBLIC, ".vite"), { recursive: true, force: true });
    fs.rmSync(SSR_DIR, { recursive: true, force: true });

    console.log(`prerender: ${written.length} страниц в dist/prerender\n  ${written.join("\n  ")}`);
  });
}

await main();
