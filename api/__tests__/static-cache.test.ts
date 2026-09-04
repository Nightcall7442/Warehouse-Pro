import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

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
