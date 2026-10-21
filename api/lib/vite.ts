import type { Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import fs from "fs";
import path from "path";
import { pageMetaFor, wantsAppShell, withPageMeta } from "./public-pages";
import { createSitePages, isUnknownPage } from "./site-pages";

type App = Hono<{ Bindings: HttpBindings }>;

const ONE_DAY = 60 * 60 * 24;
const ONE_WEEK = ONE_DAY * 7;
const ONE_YEAR = ONE_DAY * 365;
/** Статика без хэша в имени, которая меняется редко, — на неделю (см. onFound). */
const WEEKLY = ["/landing/", "/og/", "/fonts/"];

/**
 * Отдаётся ли оболочка приложения.
 *
 * Смотрим на файл, а не на путь запроса: раздача достраивает «/» до
 * index.html сама, и к моменту вызова путь уже не тот, по которому пришли.
 * Разделители приводятся к «/» — на Windows они обратные.
 */
function servesAppShell(filePath: string, reqPath: string): boolean {
  return filePath.split("\\").join("/").endsWith("/index.html") || reqPath.endsWith(".html");
}

/**
 * root и prerenderRoot — только для проверки (api/__tests__/pitch-video-serving,
 * site-pages-serving): по умолчанию собранный фронт и готовые страницы сайта,
 * как в бою. Проверка, давшая свой root без prerenderRoot, готовых страниц
 * не получает — на временной папке их нет.
 */
export function serveStaticFiles(app: App, opts: { root?: string; prerenderRoot?: string } = {}) {
  const distPath = opts.root ? path.resolve(opts.root) : path.resolve(import.meta.dirname, "../dist/public");
  const prerenderPath = opts.prerenderRoot
    ? path.resolve(opts.prerenderRoot)
    : opts.root ? null : path.resolve(import.meta.dirname, "../dist/prerender");

  /*
    Страницы сайта — раньше статики: «/» лежит в статике как оболочка
    (index.html), а гостю нужна готовая страница. Тут же 301 со старых и
    двойных адресов (/ru/…, /landing, /uz/). См. api/lib/site-pages.ts.
  */
  const site = createSitePages(prerenderPath);
  app.use("*", site.pages);

  /*
    Заголовок кэша — ПОСЛЕ раздачи, а не в onFound.

    @hono/node-server (с 1.19) зовёт onFound, когда ответ уже собран, и
    c.header() там не попадает ни в один ответ. Так и было: правила ниже
    стояли, а в бою ни у пакетов с хэшем не было «immutable», ни у оболочки
    «no-cache» — браузер кэшировал оболочку на глазок, и выкладка доезжала
    до человека не сразу. Проверялся только текст правил (static-cache).
    Теперь onFound лишь решает, а ставит заголовок обёртка, когда ответ
    раздачи уже в руках.
  */
  const decided = new WeakMap<Request, string>();
  app.use("*", async (c, next) => {
    await next();
    const value = decided.get(c.req.raw);
    if (value) c.header("Cache-Control", value);
  });

  app.use("*", serveStatic({
    root: opts.root ?? "./dist/public",
    onFound: (filePath, c) => {
      const cache = (value: string) => decided.set(c.req.raw, value);
      // Matched against the request path, not the on-disk path, which is
      // separator-dependent. Everything under /assets/ carries a content hash in
      // its name, so it can be cached forever; without this header the browser
      // revalidates every bundle on every navigation.
      const reqPath = c.req.path;
      if (reqPath.startsWith("/assets/")) {
        cache(`public, max-age=${ONE_YEAR}, immutable`);
      } else if (servesAppShell(filePath, reqPath) || reqPath.endsWith("sw.js")) {
        /*
          Оболочку кэшировать нельзя.

          Условие проверяло только окончание «.html». Главную открывают как
          «/», и раздача сама достраивает её до index.html — под правило она
          не попадала и уходила в общий случай, на сутки кэша. Оболочка
          ссылается на пакеты с хэшем в имени, поэтому браузер со вчерашней
          оболочкой грузил вчерашние пакеты: выкладка прошла, а человек
          работал со старым кодом.

          Ссылки вглубь (/orders, /catalog) идут через notFound ниже, там
          «no-cache» стоял всегда — беда доставалась ровно тем, кто заходит
          по адресу сайта, то есть почти всем.

          Проверяется отданный ФАЙЛ, а не путь запроса: путь внутри раздачи
          уже не «/», и условие по нему молча не срабатывало.
        */
        cache("no-cache");
      } else if (WEEKLY.some(prefix => reqPath.startsWith(prefix))) {
        /*
          Кадры и снимки лендинга, картинки карточек ссылок, шрифты — имена
          без хэша, но меняются они редко, а весят много (плёнка — сотни
          кадров). Сутки кэша заставляли постоянного гостя перекачивать их
          каждый день. Неделя — и ещё сутки браузер может показывать прежнюю
          копию, пока проверяет новую. Кто меняет такой файл — меняет и имя
          (новая папка плёнки, новое имя шрифта), иначе неделю увидят старый.
        */
        cache(`public, max-age=${ONE_WEEK}, stale-while-revalidate=${ONE_DAY}`);
      } else {
        cache("public, max-age=86400");
      }
    },
  }));

  // index.html is the SPA fallback for every unmatched route — read it once instead
  // of doing a synchronous disk read on each navigation.
  let indexHtml: string | null = null;
  // Оболочка с карточкой /pitch или /demo — собирается один раз на адрес.
  const pageHtml = new Map<string, string>();

  app.notFound((c) => {
    if (!wantsAppShell(c.req.path, c.req.method, c.req.header("accept") ?? "")) {
      return c.json({ error: "Not Found" }, 404);
    }
    c.header("Cache-Control", "no-cache");
    /*
      Адрес не сайта и не приложения (/nonexistent, /uz/xyz) — 404 с
      настоящим кодом и страницей на двух языках. Раньше здесь была оболочка
      с кодом 200, и поиск считал опечатки страницами сайта.
    */
    const unknown = isUnknownPage(c.req.path);
    if (unknown) {
      const missing = site.notFound(c);
      if (missing) return missing;
    }
    if (indexHtml === null) {
      indexHtml = fs.readFileSync(path.resolve(distPath, "index.html"), "utf-8");
    }
    const meta = pageMetaFor(c.req.path);
    // Сборка без готовой страницы 404 — оболочка, но код всё равно 404.
    if (!meta) return c.html(indexHtml, unknown ? 404 : 200);
    let html = pageHtml.get(meta.url);
    if (html === undefined) { html = withPageMeta(indexHtml, meta); pageHtml.set(meta.url, html); }
    return c.html(html);
  });
}
