import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Hono } from "hono";
import { serveStaticFiles } from "../lib/vite";

/**
 * Оболочка приложения не должна кэшироваться.
 *
 * index.html ссылается на пакеты с хэшем в имени. Пока браузер держит
 * вчерашнюю оболочку, он грузит вчерашние пакеты — выкладка прошла, а человек
 * работает со старым кодом.
 *
 * Так и было: условие проверяло окончание «.html», но главную открывают как
 * «/». Она под правило не попадала и уходила в общий случай — сутки кэша.
 * Ссылки вглубь (/orders, /catalog) идут через notFound, там «no-cache» стоял
 * всегда, поэтому беда доставалась ровно тем, кто заходит по адресу сайта.
 *
 * Проверка читает исходник, а не поднимает сервер: правило — это несколько
 * условий в одной ветке, и стеречь надо именно их.
 */
const SRC = fs.readFileSync(path.resolve(process.cwd(), "api/lib/vite.ts"), "utf8");

describe("кэширование статики", () => {
  it("оболочка узнаётся по отданному файлу, а не по пути запроса", () => {
    /*
      Первая попытка чинила это условием `reqPath === "/"` — и не сработала:
      внутри раздачи путь уже не «/», она сама достраивает его до index.html.
      Проверять надо файл, который реально отдан.

      Условие берётся от «else if» до открывающей фигурной скобки, а не
      регуляркой по скобкам: внутри самого условия есть свои.
    */
    const at = SRC.indexOf("else if (");
    expect(at, "ветка no-cache не найдена — правило переписали").toBeGreaterThan(0);
    expect(SRC.slice(at, SRC.indexOf("{", at))).toContain("servesAppShell(filePath");
    expect(SRC.slice(at, at + 1400)).toContain('"no-cache"');

    // Сама проверка смотрит на имя файла и приводит разделители Windows.
    const helper = SRC.slice(SRC.indexOf("function servesAppShell"), SRC.indexOf("export function serveStaticFiles"));
    expect(helper).toContain('endsWith("/index.html")');
    expect(helper).toContain('.split("\\\\")');
  });

  it("служебный работник тоже без кэша", () => {
    // sw.js решает, что показывать офлайн. Закэшированный работник продолжает
    // отдавать старую оболочку даже после того, как её перестали кэшировать.
    expect(SRC).toMatch(/reqPath\.endsWith\("sw\.js"\)/);
  });

  it("пакеты с хэшем кэшируются надолго", () => {
    // Обратная сторона: без этого браузер перепроверяет каждый пакет на каждом
    // переходе, а у агента в поле мобильный интернет.
    expect(SRC).toMatch(/startsWith\("\/assets\/"\)/);
    expect(SRC).toMatch(/immutable/);
  });

  it("запасной путь для ссылок вглубь остался без кэша", () => {
    const at = SRC.indexOf("app.notFound");
    expect(at).toBeGreaterThan(0);
    expect(SRC.slice(at, at + 700)).toContain('"no-cache"');
  });
});

/*
  Те же правила — на деле, настоящим serveStaticFiles на временной папке, как
  в pitch-video-serving. Текст правил выше был верным, а заголовков в ответе
  не было вовсе: @hono/node-server зовёт onFound, когда ответ уже собран, и
  c.header() там терялся. Ни «immutable» у пакетов, ни «no-cache» у оболочки
  в бою не стояло.

  Статика без хэша в имени, которая меняется редко: кадры и снимки лендинга,
  картинки карточек ссылок, шрифты. Сутки кэша заставляли постоянного гостя
  перекачивать плёнку каждый день; теперь — неделя и сутки «показывать
  прежнее, пока проверяешь новое».

  Нарочная поломка: вернуть c.header() в onFound — падает весь блок;
  убрать "/fonts/" из WEEKLY в vite.ts — падает «неделя».
*/
describe("заголовки кэша в ответе", () => {
  let root = "";
  let app: Hono;
  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "static-cache-"));
    for (const f of ["index.html", "sw.js", "fonts/manrope-cyrillic-wght-normal.woff2", "landing/film/w960/0001.webp", "og/home-ru.jpg", "icon-192.png", "assets/index-abc123.js"]) {
      fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true });
      fs.writeFileSync(path.join(root, f), "x");
    }
    app = new Hono();
    serveStaticFiles(app as never, { root });
  });
  afterAll(() => { fs.rmSync(root, { recursive: true, force: true }); });

  const cache = async (p: string) => (await app.request(p)).headers.get("cache-control");

  it.each(["/fonts/manrope-cyrillic-wght-normal.woff2", "/landing/film/w960/0001.webp", "/og/home-ru.jpg"])("%s — неделя и сутки stale-while-revalidate", async p => {
    expect(await cache(p)).toBe("public, max-age=604800, stale-while-revalidate=86400");
  });

  it("шрифт уходит как font/woff2", async () => {
    expect((await app.request("/fonts/manrope-cyrillic-wght-normal.woff2")).headers.get("content-type")).toBe("font/woff2");
  });

  it("оболочка «/» и service worker — без кэша", async () => {
    expect(await cache("/")).toBe("no-cache");
    expect(await cache("/index.html")).toBe("no-cache");
    expect(await cache("/sw.js")).toBe("no-cache");
  });

  it("прочая статика — сутки, пакеты с хэшем — навсегда", async () => {
    expect(await cache("/icon-192.png")).toBe("public, max-age=86400");
    expect(await cache("/assets/index-abc123.js")).toBe("public, max-age=31536000, immutable");
  });
});
