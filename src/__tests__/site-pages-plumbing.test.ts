import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { OG_HEIGHT, OG_WIDTH, SITE_PAGES, ogImagePath, pageLangs } from "@contracts/site-pages";

/**
 * Один список страниц сайта (contracts/site-pages) — и всё, что от него
 * зависит, с ним сходится.
 *
 * Адрес страницы записан в нескольких местах: сборка готовых страниц,
 * картинки карточек, вход сайта. Когда одно из них отстаёт, это видно только
 * в Search Console или в переписке через недели: карточка без картинки,
 * страница, собранная без своего куска.
 *
 *   · у каждой страницы на каждом языке — своя картинка JPEG ровно
 *     1200×630; лишних нет;
 *   · сборка готовых страниц грузит те же куски, что вход сайта, и стоит в
 *     npm run build между vite и сборкой сервера.
 *
 * Нарочная поломка: пересохранить картинку 1200×600 — «картинки»; добавить
 * страницу в LOADERS без PAGE_SOURCES — «одно и то же».
 */

const ROOT = process.cwd();
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");

/** Размер JPEG из маркера SOF — без библиотек. */
function jpegSize(buf: Buffer): { width: number; height: number } {
  expect(buf[0] === 0xff && buf[1] === 0xd8, "не JPEG").toBe(true);
  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xff) { i++; continue; }
    const marker = buf[i + 1];
    const length = buf.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    }
    i += 2 + length;
  }
  throw new Error("в JPEG нет маркера SOF");
}

describe("картинки карточек ссылок", () => {
  it("у каждой страницы на каждом языке — своя, JPEG ровно 1200×630", () => {
    const expected: string[] = [];
    for (const page of SITE_PAGES) for (const lang of pageLangs(page)) {
      const rel = ogImagePath(page.key, lang);
      expected.push(path.basename(rel));
      const file = path.join(ROOT, "public", rel);
      expect(existsSync(file), rel).toBe(true);
      const buf = readFileSync(file);
      expect(jpegSize(buf), rel).toEqual({ width: OG_WIDTH, height: OG_HEIGHT });
      // Не пустая картинка и не тяжёлая: мессенджеры режут превью больше 300 КБ.
      expect(buf.length, rel).toBeGreaterThan(20_000);
      expect(buf.length, rel).toBeLessThan(300_000);
    }
    expect(readdirSync(path.join(ROOT, "public", "og")).sort()).toEqual(expected.sort());
  });
});

describe("сборка готовых страниц и вход сайта грузят одно и то же", () => {
  it("PAGE_SOURCES в scripts/prerender.mjs — те же модули, что LOADERS в site-main", () => {
    const script = read("scripts/prerender.mjs");
    const block = /const PAGE_SOURCES = \{([\s\S]*?)\};/.exec(script)?.[1] ?? "";
    const sources = Object.fromEntries([...block.matchAll(/(\w+):\s*"src\/([^"]+)\.tsx"/g)].map(m => [m[1], `@/${m[2]}`]));
    const main = read("src/site/site-main.tsx");
    const loaders = Object.fromEntries([...main.matchAll(/(\w+):\s*\(\)\s*=>\s*import\("([^"]+)"\)/g)].map(m => [m[1], m[2]]));
    expect(Object.keys(sources).sort()).toEqual(SITE_PAGES.map(p => p.key).sort());
    expect(sources).toEqual(loaders);
  });

  it("сборка зовёт пререндер между vite и сборкой сервера", () => {
    const build = JSON.parse(read("package.json")).scripts.build as string;
    expect(build).toMatch(/^vite build && vite build --ssr src\/site\/entry-server\.tsx --outDir dist\/ssr && node scripts\/prerender\.mjs && esbuild /);
  });
});

