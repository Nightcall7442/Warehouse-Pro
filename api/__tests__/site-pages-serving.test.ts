import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Hono } from "hono";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { serveStaticFiles } from "../lib/vite";
import { isUnknownPage, siteRedirect } from "../lib/site-pages";
import { APP_ROOTS, SITE_PAGES, pageLangs, prerenderFile } from "../../contracts/site-pages";

/**
 * Сервер отдаёт страницы сайта: готовый HTML гостю, оболочку вошедшему,
 * 301 со старых и двойных адресов, настоящий 404.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * На любой адрес — одна оболочка с кодом 200: /, /compare, /uz и
 * /kakaya-to-opechatka выглядели для поиска одинаковыми пустыми страницами,
 * /landing и «/» — двумя копиями одной, /uz/ и /uz — двумя адресами.
 *
 * ── Что проверяется ─────────────────────────────────────────────────────────
 *
 * Настоящий serveStaticFiles на временных папках (оболочка и готовые
 * страницы), как в static-cache, и — если сборка есть — на настоящем dist:
 * те же проверки, что руками через curl после `npm run build`.
 *
 * Нарочная поломка: убрать проверку куки в site-pages — падает «вошедший
 * получает оболочку»; убрать isUnknownPage из notFound — «404 с настоящим
 * кодом»; сравнивать If-None-Match без W/ — «304».
 */

const SHELL = '<!doctype html><html lang="ru"><head><!--seo--><meta name="robots" content="noindex" /><!--/seo--></head><body><div id="root"><!--root-fallback-->оболочка<!--/root-fallback--></div></body></html>';
const page = (lang: string, text: string) => `<!doctype html><html lang="${lang}"><head><meta name="wp-site" content="x" /></head><body><div id="root">${text} $& $1</div></body></html>`;

let publicDir = "";
let prerenderDir = "";
let app: Hono;
const html = { "Accept": "text/html,application/xhtml+xml" };

beforeAll(() => {
  publicDir = fs.mkdtempSync(path.join(os.tmpdir(), "site-public-"));
  prerenderDir = fs.mkdtempSync(path.join(os.tmpdir(), "site-prerender-"));
  fs.writeFileSync(path.join(publicDir, "index.html"), SHELL);
  fs.mkdirSync(path.join(publicDir, "landing", "film"), { recursive: true });
  fs.writeFileSync(path.join(publicDir, "landing", "film", "0001.webp"), "кадр");
  const files: Record<string, string> = {
    "index.html": page("ru", "Главная по-русски"),
    "uz.html": page("uz", "Bosh sahifa"),
    "compare.html": page("ru", "Сравнение"),
    "uz/compare.html": page("uz", "Taqqoslash"),
    "privacy.html": page("ru", "Политика"),
    "shop-debts.html": page("ru", "Учёт долгов магазинов"),
    "uz/shop-debts.html": page("uz", "Do'kon qarzlari hisobi"),
    "404.html": '<!doctype html><html lang="ru"><head><meta name="robots" content="noindex" /></head><body>Такой страницы нет · Bunday sahifa yo\'q</body></html>',
  };
  for (const [file, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(prerenderDir, file)), { recursive: true });
    fs.writeFileSync(path.join(prerenderDir, file), body);
  }
  app = new Hono();
  serveStaticFiles(app as never, { root: publicDir, prerenderRoot: prerenderDir });
});
afterAll(() => {
  fs.rmSync(publicDir, { recursive: true, force: true });
  fs.rmSync(prerenderDir, { recursive: true, force: true });
});

describe("готовые страницы — гостю", () => {
  it.each([
    ["/", "ru", "Главная по-русски"],
    ["/uz", "uz", "Bosh sahifa"],
    ["/compare", "ru", "Сравнение"],
    ["/uz/compare", "uz", "Taqqoslash"],
    ["/privacy", "ru", "Политика"],
    ["/shop-debts", "ru", "Учёт долгов магазинов"],
    ["/uz/shop-debts", "uz", "Do'kon qarzlari hisobi"],
  ])("%s → готовая страница (%s), без кэша, со своим языком", async (p, lang, text) => {
    // Робот превью шлёт «*/*» — страница сайта всё равно отдаётся.
    for (const accept of ["text/html", "*/*", ""]) {
      const res = await app.request(p, { headers: { Accept: accept } });
      expect(res.status, `${p} ${accept}`).toBe(200);
      const body = await res.text();
      expect(body).toContain(text);
      // «$&» в тексте страницы — просто знаки (не шаблон замены).
      expect(body).toContain("$& $1");
      expect(res.headers.get("content-type")).toMatch(/^text\/html/);
      expect(res.headers.get("cache-control")).toBe("no-cache");
      expect(res.headers.get("content-language")).toBe(lang);
      expect(res.headers.get("etag")).toMatch(/^W\/"[A-Za-z0-9_-]{10,}"$/);
    }
  });

  it("/privacy — индексируется: без noindex", async () => {
    expect(await (await app.request("/privacy")).text()).not.toMatch(/noindex/);
  });

  it("HEAD — те же заголовки, без тела", async () => {
    const res = await app.request("/uz", { method: "HEAD" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-language")).toBe("uz");
    expect(await res.text()).toBe("");
  });

  it("304 на совпавший ETag — и в списке, и без W/, и «*»; чужой — полная страница", async () => {
    const etag = (await app.request("/compare")).headers.get("etag")!;
    for (const inm of [etag, `"x", ${etag}`, etag.replace(/^W\//, ""), "*"]) {
      const res = await app.request("/compare", { headers: { "If-None-Match": inm } });
      expect(res.status, inm).toBe(304);
      expect(await res.text()).toBe("");
      expect(res.headers.get("etag")).toBe(etag);
      expect(res.headers.get("cache-control")).toBe("no-cache");
    }
    expect((await app.request("/compare", { headers: { "If-None-Match": 'W/"other"' } })).status).toBe(200);
    // Разные страницы — разные метки.
    expect((await app.request("/uz/compare")).headers.get("etag")).not.toBe(etag);
  });

  it("не GET — мимо готовых страниц", async () => {
    const res = await app.request("/compare", { method: "POST", headers: { Accept: "*/*" } });
    expect(res.status).toBe(404);
  });
});

describe("«/» вошедшему — оболочка приложения", () => {
  it("с кукой сессии — оболочка, без неё — готовая страница; у обоих Vary: Cookie", async () => {
    const shell = await app.request("/", { headers: { Cookie: "app_sid=abc; other=1" } });
    expect(shell.status).toBe(200);
    expect(await shell.text()).toContain("оболочка");
    expect(shell.headers.get("cache-control")).toBe("no-cache");
    expect(shell.headers.get("vary")).toMatch(/Cookie/);
    const guest = await app.request("/", { headers: { Cookie: "other=1" } });
    expect(await guest.text()).toContain("Главная по-русски");
    expect(guest.headers.get("vary")).toMatch(/Cookie/);
  });

  it("на других страницах сайта кука ничего не меняет", async () => {
    const res = await app.request("/compare", { headers: { Cookie: "app_sid=abc" } });
    expect(await res.text()).toContain("Сравнение");
  });
});

describe("один адрес у страницы: 301", () => {
  it.each([
    ["/ru", "/"],
    ["/ru/", "/"],
    ["/ru/compare", "/compare"],
    ["/ru/compare/", "/compare"],
    ["/ru/privacy?utm_source=tg", "/privacy?utm_source=tg"],
    ["/ru/orders", "/orders"],
    ["/landing", "/"],
    ["/landing/", "/"],
    ["/landing?utm_source=ig", "/?utm_source=ig"],
    ["/uz/", "/uz"],
    ["/uz/compare/", "/uz/compare"],
    ["/compare/", "/compare"],
    ["/compare//", "/compare"],
    ["/privacy/", "/privacy"],
    ["/pitch/", "/pitch"],
    ["/demo/?lang=ru", "/demo?lang=ru"],
    ["/shop-debts/", "/shop-debts"],
    ["/uz/shop-debts/", "/uz/shop-debts"],
    ["/ru/shop-debts", "/shop-debts"],
    ["/sales-agents/?utm_source=tg", "/sales-agents?utm_source=tg"],
  ])("%s → %s", async (from, to) => {
    const res = await app.request(from);
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe(to);
  });

  it("«/ru//evil.com» не уводит на чужой сайт", async () => {
    const res = await app.request("/ru//evil.com");
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe("/evil.com");
    expect(siteRedirect("//evil.com/")).toBeNull();
  });

  it("кадры под /landing/ — статика, не переезд", async () => {
    const res = await app.request("/landing/film/0001.webp");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("кадр");
  });

  it("разделы приложения и похожие адреса не трогаются", () => {
    for (const p of ["/orders/", "/rules", "/rus", "/uzum", "/landingx", "/", "/uz", "/compare"]) expect(siteRedirect(p), p).toBeNull();
  });
});

describe("404 с настоящим кодом", () => {
  it.each(["/nonexistent", "/uz/xyz", "/compare/old", "/privacy/x", "/landing/nope", "/api-docs", "/shop-debts/x", "/uz/shop-debts/x", "/shop-debtsx"])("%s → страница 404 на двух языках", async p => {
    const res = await app.request(p, { headers: html });
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toMatch(/^text\/html/);
    expect(res.headers.get("content-language")).toBe("ru, uz");
    expect(res.headers.get("cache-control")).toBe("no-cache");
    const body = await res.text();
    expect(body).toContain("Такой страницы нет");
    expect(body).toContain("Bunday sahifa yo'q");
  });

  it("не HTML (робот, опечатка в адресе API) — по-прежнему JSON 404", async () => {
    for (const p of ["/nonexistent", "/api/v1/nope", "/orders"]) {
      const res = await app.request(p, { headers: { Accept: "*/*" } });
      expect(res.status, p).toBe(404);
      expect(await res.json()).toEqual({ error: "Not Found" });
    }
  });

  it.each(["/orders", "/orders/123", "/login", "/agent/plans", "/super-admin/orgs/5", "/invite/abc"])("%s — раздел приложения: оболочка, 200", async p => {
    const res = await app.request(p, { headers: html });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("оболочка");
  });

  it("/pitch и /demo — оболочка со своим canonical вместо noindex", async () => {
    for (const p of ["/pitch", "/demo"]) {
      const body = await (await app.request(p, { headers: { Accept: "*/*" } })).text();
      expect(body).toContain(`<link rel="canonical" href="https://www.warehouse-pro.uz${p}" />`);
      expect(body).not.toMatch(/noindex/);
    }
  });

  it("решает первая часть адреса: сайт, приложение или ничего", () => {
    expect(isUnknownPage("/")).toBe(false);
    for (const root of APP_ROOTS) expect(isUnknownPage(`/${root}`), root).toBe(false);
    for (const p of SITE_PAGES.flatMap(s => pageLangs(s).map(l => s.paths[l]!))) expect(isUnknownPage(p), p).toBe(false);
    for (const p of ["/x", "/uz/x", "/compare/x", "/ordersx", "/index.php", "/wp-admin"]) expect(isUnknownPage(p), p).toBe(true);
  });
});

describe("без готовых страниц (сборка без пререндера) — как раньше", () => {
  it("«/» — оболочка; неизвестный адрес — оболочка, но с кодом 404", async () => {
    const bare = new Hono();
    serveStaticFiles(bare as never, { root: publicDir });
    const root = await bare.request("/");
    expect(await root.text()).toContain("оболочка");
    const missing = await bare.request("/nonexistent", { headers: html });
    expect(missing.status).toBe(404);
    expect(await missing.text()).toContain("оболочка");
  });
});

/*
  То же на настоящей сборке — если она есть (после `npm run build`). Это те
  проверки, что делались руками через curl.
*/
const DIST = path.resolve(process.cwd(), "dist");
const built = fs.existsSync(path.join(DIST, "prerender", "index.html")) && fs.existsSync(path.join(DIST, "public", "index.html"));

describe.skipIf(!built)("настоящая сборка: dist/public и dist/prerender", () => {
  let real: Hono;
  beforeAll(() => {
    real = new Hono();
    serveStaticFiles(real as never, { root: path.join(DIST, "public"), prerenderRoot: path.join(DIST, "prerender") });
  });

  it("/ без куки — готовая русская страница с текстом и своим <head>", async () => {
    const res = await real.request("/");
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toMatch(/<html lang="ru"/);
    expect(body).toMatch(/Агенты,/);
    expect(body).toContain('<link rel="canonical" href="https://www.warehouse-pro.uz/" />');
    expect(body).toContain('<meta name="wp-site" content="home" />');
    expect(body).not.toMatch(/noindex/);
  });

  it("/uz — узбекская", async () => {
    const body = await (await real.request("/uz")).text();
    expect(body).toMatch(/<html lang="uz"/);
    expect(body).toMatch(/Agentlar,/);
    expect(body).toContain('<link rel="canonical" href="https://www.warehouse-pro.uz/uz" />');
  });

  it("/ru/compare — 301; /nonexistent — 404; /orders — оболочка; /privacy — 200 и индексируется", async () => {
    const moved = await real.request("/ru/compare");
    expect(moved.status).toBe(301);
    expect(moved.headers.get("location")).toBe("/compare");
    const missing = await real.request("/nonexistent", { headers: html });
    expect(missing.status).toBe(404);
    expect(await missing.text()).toMatch(/Такой страницы нет/);
    const shell = await real.request("/orders", { headers: html });
    expect(shell.status).toBe(200);
    expect(await shell.text()).toContain('<meta name="robots" content="noindex" />');
    const privacy = await real.request("/privacy");
    expect(privacy.status).toBe(200);
    expect(await privacy.text()).not.toMatch(/noindex/);
  });

  it("статьи — готовые страницы со своим текстом, языком и разметкой", async () => {
    for (const s of SITE_PAGES.filter(x => x.kind === "article")) {
      for (const l of pageLangs(s)) {
        const p = s.paths[l]!;
        const res = await real.request(p);
        expect(res.status, p).toBe(200);
        expect(res.headers.get("content-language"), p).toBe(l);
        const body = await res.text();
        expect(body, p).toMatch(new RegExp(`<html lang="${l}"`));
        expect(body, p).toContain(`<link rel="canonical" href="https://www.warehouse-pro.uz${p}" />`);
        expect(body, p).toContain(`<meta name="wp-site" content="${s.key}" />`);
        expect(body, p).toContain('"@type":"Article"');
        expect(body, p).toMatch(/<article[^>]*>[\s\S]{3000,}<\/article>/);
      }
    }
    const ru = await (await real.request("/shop-debts")).text();
    expect(ru).toContain("Учёт долгов магазинов");
    const uz = await (await real.request("/uz/shop-debts")).text();
    expect(uz).toContain("Do&#x27;kon qarzlari hisobi");
    expect((await real.request("/shop-debts/x", { headers: html })).status).toBe(404);
  });

  it("ETag и 304", async () => {
    const first = await real.request("/compare");
    const etag = first.headers.get("etag")!;
    expect(etag).toMatch(/^W\//);
    expect((await real.request("/compare", { headers: { "If-None-Match": etag } })).status).toBe(304);
  });

  it("в готовых страницах нет встроенных скриптов (CSP), а предзагрузки ведут на настоящие файлы", () => {
    for (const s of SITE_PAGES) for (const l of pageLangs(s)) {
      const file = prerenderFile(s.paths[l]!);
      const body = fs.readFileSync(path.join(DIST, "prerender", file), "utf8");
      const scripts = [...body.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
      for (const [, attrs, inner] of scripts) {
        if (/type="application\/ld\+json"/.test(attrs)) continue;
        expect(attrs, file).toMatch(/\bsrc="/);
        expect(inner.trim(), file).toBe("");
      }
      const preloads = [...body.matchAll(/<link rel="modulepreload" crossorigin href="\/([^"]+)">/g)].map(m => m[1]);
      expect(preloads.length, file).toBeGreaterThan(1);
      for (const p of preloads) expect(fs.existsSync(path.join(DIST, "public", p)), `${file}: ${p}`).toBe(true);
    }
    const notFound = fs.readFileSync(path.join(DIST, "prerender", "404.html"), "utf8");
    expect(notFound).not.toMatch(/<script(?![^>]*application\/ld\+json)/);
    expect(notFound).not.toMatch(/modulepreload/);
    // Готовые страницы — не в раздаче статики: у страницы один адрес.
    expect(fs.existsSync(path.join(DIST, "public", "compare.html"))).toBe(false);
    expect(fs.existsSync(path.join(DIST, "public", ".vite"))).toBe(false);
  });
});
