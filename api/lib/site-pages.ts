import type { Context, MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Session } from "../../contracts/constants";
import {
  APP_ROOTS, NOT_FOUND_FILE, SITE_ROOTS, prerenderFile, siteRoute,
} from "../../contracts/site-pages";

/* ═══════════════════════════════════════════════════════════════════════════
   Страницы сайта на сервере: готовый HTML, переезды адресов и честный 404.

   ── Что было ───────────────────────────────────────────────────────────────

   На любой адрес сервер отдавал одну оболочку приложения с кодом 200: и на
   «/», и на /compare, и на /uz, и на /kakaya-to-opechatka. Поиск видел
   пустой <div id="root"> с одной русской карточкой на всех, считал опечатки
   страницами сайта, а /landing и «/» — двумя копиями одной страницы.

   ── Что теперь ─────────────────────────────────────────────────────────────

   · Гость на странице сайта получает готовый HTML из dist/prerender
     (scripts/prerender.mjs) — с текстом, своим заголовком, canonical и
     hreflang на каждом языке.
   · На «/» с кукой сессии — оболочка приложения, как раньше: вошедшему «/» —
     это его рабочий стол, а не лендинг. Поэтому у «/» Vary: Cookie.
   · У каждой страницы один адрес, остальные отвечают 301: /ru/… (русский —
     язык по умолчанию, без приставки), /landing (прежний адрес лендинга),
     /uz/ и /compare/ (без косой в конце; так же /pitch/ и /demo/).
   · Адрес, которого нет ни у сайта, ни у приложения, — страница 404 с
     настоящим кодом (notFoundPage). Разделы приложения (APP_ROOTS) по-
     прежнему получают оболочку: их адреса разбирает React Router.

   ── Кэш ───────────────────────────────────────────────────────────────────

   Готовая страница ссылается на пакеты с хэшем в имени — значит, как и
   оболочку, её нельзя держать в кэше без проверки (no-cache). Проверка
   дешёвая: слабый ETag по содержимому, на совпадение — 304 без тела.
   Слабый — потому что сжатие (compress в api/boot.ts) меняет байты, но не
   смысл ответа.
   ═══════════════════════════════════════════════════════════════════════════ */

/** Адреса конкурса: косая в конце у них тоже отвечает 301. */
const PITCH_PAGES = new Set(["/pitch", "/demo"]);

/** Без косой в конце, кроме самого «/». */
const trimSlash = (p: string) => (p.length > 1 ? p.replace(/\/+$/, "") || "/" : p);

/**
 * Символы адреса раздела приложения. Ни «\», ни управляющих: Hono отдаёт
 * путь уже раскодированным (%5C → «\», %09 → табуляция), а браузер читает
 * «/\evil.com» и «/<табуляция>/evil.com» как «//evil.com» — чужой сайт.
 */
const PLAIN_PATH = /^\/[A-Za-z0-9\-._~%/]*$/;

/**
 * /ru/… → тот же адрес без приставки — но только на свой известный адрес.
 *
 * Переезд — ответ на любой адрес под /ru, его может подсунуть кто угодно
 * («warehouse-pro.uz/ru/%5Cevil.com» в письме). Поэтому цель — не «что
 * осталось после /ru», а страница сайта, конкурса или раздел приложения с
 * простыми символами в адресе. Всё прочее под /ru — не переезд, а честный
 * 404 (isUnknownPage: «ru» не раздел приложения).
 */
function movedFromRu(reqPath: string): string | null {
  const target = trimSlash("/" + reqPath.slice(3).replace(/^\/+/, ""));
  if (siteRoute(target) || PITCH_PAGES.has(target)) return target;
  const first = target.split("/")[1] ?? "";
  return APP_ROOTS.includes(first) && PLAIN_PATH.test(target) ? target : null;
}

/**
 * Куда переехал адрес — или null, если он на месте.
 *
 * Цель — всегда свой адрес: страница сайта, конкурса или раздел приложения.
 * «/ru//evil.com», «/ru/%5Cevil.com», «/ru/%09/evil.com» не уводят на чужой
 * сайт — браузер понял бы «//», «/\» и «/<табуляция>/» как другой домен.
 */
export function siteRedirect(reqPath: string): string | null {
  if (reqPath === "/ru" || reqPath.startsWith("/ru/")) return movedFromRu(reqPath);
  if (reqPath === "/landing" || reqPath === "/landing/") return "/";
  if (reqPath.length > 1 && reqPath.endsWith("/")) {
    const bare = trimSlash(reqPath);
    if (!bare.startsWith("//") && (siteRoute(bare) || PITCH_PAGES.has(bare))) return bare;
  }
  return null;
}

/**
 * Адрес страницы, которой нет: ни страницы сайта, ни раздела приложения.
 *
 * Решает первая часть адреса. Под частями сайта (/uz, /compare, /privacy,
 * /landing) есть только страницы из SITE_PAGES — /uz/xyz тоже 404. Части
 * приложения (APP_ROOTS) — его забота. Всё прочее — 404.
 */
export function isUnknownPage(reqPath: string): boolean {
  if (reqPath === "/" || siteRoute(reqPath)) return false;
  const first = reqPath.split("/")[1] ?? "";
  if (SITE_ROOTS.includes(first)) return true;
  return !APP_ROOTS.includes(first);
}

interface Prerendered { body: string; etag: string; lang: string }

/** Слабый ETag по содержимому: сжатие меняет байты, но не страницу. */
const weakEtag = (body: string) => `W/"${createHash("sha1").update(body).digest("base64url").slice(0, 22)}"`;

/** Совпал ли ETag с If-None-Match (там может быть список или «*»). */
function fresh(c: Context, etag: string): boolean {
  const header = c.req.header("if-none-match");
  if (!header) return false;
  if (header.trim() === "*") return true;
  const bare = (t: string) => t.trim().replace(/^W\//, "");
  return header.split(",").some(t => bare(t) === bare(etag));
}

/**
 * Готовые страницы сайта из каталога сборки.
 *
 * root — dist/prerender; null — готовых страниц нет (проверки статики на
 * временной папке, сборка без scripts/prerender.mjs): тогда всё идёт мимо, к
 * оболочке, как раньше. Файлы читаются один раз — они меняются только с
 * выкладкой, а выкладка перезапускает процесс.
 */
export function createSitePages(root: string | null) {
  const cache = new Map<string, Prerendered | null>();

  const load = (file: string, lang: string): Prerendered | null => {
    if (!root) return null;
    if (!cache.has(file)) {
      let page: Prerendered | null = null;
      try {
        const body = fs.readFileSync(path.join(root, file), "utf-8");
        page = { body, etag: weakEtag(body), lang };
      } catch { /* страницы нет в сборке — отдаст оболочка */ }
      cache.set(file, page);
    }
    return cache.get(file) ?? null;
  };

  const respond = (c: Context, page: Prerendered, status: 200 | 404) => {
    c.header("Cache-Control", "no-cache");
    c.header("Content-Language", page.lang);
    c.header("ETag", page.etag);
    if (status === 200 && fresh(c, page.etag)) return c.body(null, 304);
    return c.html(page.body, status);
  };

  /** Переезды и готовые страницы — до раздачи статики. */
  const pages: MiddlewareHandler = async (c, next) => {
    if (c.req.method !== "GET" && c.req.method !== "HEAD") return next();
    const reqPath = c.req.path;
    const moved = siteRedirect(reqPath);
    if (moved) {
      const query = new URL(c.req.url).search;
      return c.redirect(moved + query, 301);
    }
    const route = siteRoute(reqPath);
    if (!route) return next();
    if (reqPath === "/") {
      // Один адрес — два ответа: кэш между нами и человеком должен это знать.
      c.header("Vary", "Cookie");
      if (getCookie(c, Session.cookieName)) return next();
    }
    const page = load(prerenderFile(reqPath), route.lang);
    if (!page) return next();
    return respond(c, page, 200);
  };

  /** Страница 404 — или null, если сборка её не положила. */
  const notFound = (c: Context): Response | null => {
    // Двуязычная: русский и узбекский текст на одной странице.
    const page = load(NOT_FOUND_FILE, "ru, uz");
    return page ? respond(c, page, 404) : null;
  };

  return { pages, notFound };
}
