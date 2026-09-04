import type { Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import fs from "fs";
import path from "path";

type App = Hono<{ Bindings: HttpBindings }>;

const ONE_YEAR = 60 * 60 * 24 * 365;

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

export function serveStaticFiles(app: App) {
  const distPath = path.resolve(import.meta.dirname, "../dist/public");

  app.use("*", serveStatic({
    root: "./dist/public",
    onFound: (filePath, c) => {
      // Matched against the request path, not the on-disk path, which is
      // separator-dependent. Everything under /assets/ carries a content hash in
      // its name, so it can be cached forever; without this header the browser
      // revalidates every bundle on every navigation.
      const reqPath = c.req.path;
      if (reqPath.startsWith("/assets/")) {
        c.header("Cache-Control", `public, max-age=${ONE_YEAR}, immutable`);
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
        c.header("Cache-Control", "no-cache");
      } else {
        c.header("Cache-Control", "public, max-age=86400");
      }
    },
  }));

  // index.html is the SPA fallback for every unmatched route — read it once instead
  // of doing a synchronous disk read on each navigation.
  let indexHtml: string | null = null;

  app.notFound((c) => {
    const accept = c.req.header("accept") ?? "";
    if (!accept.includes("text/html")) {
      return c.json({ error: "Not Found" }, 404);
    }
    if (indexHtml === null) {
      indexHtml = fs.readFileSync(path.resolve(distPath, "index.html"), "utf-8");
    }
    c.header("Cache-Control", "no-cache");
    return c.html(indexHtml);
  });
}
