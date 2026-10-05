import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { pageMetaFor, withPageMeta, PUBLIC_PAGES } from "../lib/public-pages";

/**
 * Карточка ссылки /pitch и /demo — то, что видит Telegram до всякого скрипта.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Сервер отдаёт на любой адрес один index.html с русской карточкой лендинга.
 * Ссылка на сайт конкурса, отправленная жюри, показала бы «склад, заказы и
 * торговые агенты» по-русски и квадратный значок вместо картинки.
 *
 * ── Что проверяется ─────────────────────────────────────────────────────────
 *
 * На НАСТОЯЩЕМ index.html (а не на выдуманном образце): у /pitch и /demo
 * подменены язык документа, заголовок, описание, canonical, og:* и twitter:*,
 * картинка большая; заглушка #root — своя. Ничего от лендинга в карточке не
 * осталось. Прочие адреса не трогаются. Сервер действительно зовёт подмену.
 */

const shell = readFileSync("index.html", "utf8");

describe("карточка ссылки /pitch и /demo", () => {
  it("адреса узнаются, хвостовая косая не мешает; прочие — нет", () => {
    expect(pageMetaFor("/pitch")).toBe(PUBLIC_PAGES["/pitch"]);
    expect(pageMetaFor("/pitch/")).toBe(PUBLIC_PAGES["/pitch"]);
    expect(pageMetaFor("/demo")).toBe(PUBLIC_PAGES["/demo"]);
    for (const p of ["/", "/landing", "/pitchx", "/demo/x", "/orders"]) expect(pageMetaFor(p), p).toBeNull();
  });

  it("в оболочке есть всё, что подменяется — иначе подмена молча ничего не делает", () => {
    for (const marker of [
      '<html lang="ru"', "<title>", '<meta name="description"', '<link rel="canonical"',
      '<meta property="og:url"', '<meta property="og:title"', '<meta property="og:description"', '<meta property="og:image"',
      '<meta property="og:locale"', '<meta name="twitter:card"', '<meta name="twitter:title"', '<meta name="twitter:image"',
      "<!--root-fallback-->", "<!--/root-fallback-->",
    ]) expect(shell, marker).toContain(marker);
  });

  it.each(["/pitch", "/demo"] as const)("%s: язык, заголовок, описание, og и twitter — свои", (path) => {
    const m = PUBLIC_PAGES[path];
    const html = withPageMeta(shell, m);
    expect(html).toContain('<html lang="uz"');
    expect(html).toContain(`<title>${m.title}</title>`);
    expect(html).toContain(`<link rel="canonical" href="${m.url}"`);
    expect(html).toContain(`<meta property="og:url" content="${m.url}"`);
    expect(html).toContain(`<meta property="og:title" content="${m.title}"`);
    expect(html).toContain(`<meta property="og:image" content="${m.image}"`);
    expect(html).toContain('<meta property="og:locale" content="uz_UZ"');
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image"');
    expect(html).toContain(m.fallbackHtml);
    // От лендинга в карточке и заглушке ничего не осталось.
    expect(html).not.toContain("склад, заказы и торговые агенты в одной системе");
    expect(html).not.toContain("Начать бесплатно");
    expect(html).not.toContain("icon-512.png\" />\n    <meta name=\"twitter:card\"");
    expect(m.image).toMatch(/^https:\/\/www\.warehouse-pro\.uz\/pitch\/og\.(jpg|png)$/);
  });

  it("картинка карточки лежит в public — ссылка не мёртвая", () => {
    const file = PUBLIC_PAGES["/pitch"].image.replace("https://www.warehouse-pro.uz/", "public/");
    expect(readFileSync(file).length).toBeGreaterThan(10_000);
  });

  it("кавычки и угловые скобки в тексте не ломают разметку", () => {
    const html = withPageMeta(shell, { ...PUBLIC_PAGES["/pitch"], title: 'A "b" <c>' });
    expect(html).toContain("<title>A &quot;b&quot; &lt;c&gt;</title>");
  });

  it("сервер действительно подменяет: notFound зовёт pageMetaFor/withPageMeta", () => {
    const vite = readFileSync("api/lib/vite.ts", "utf8");
    expect(vite).toMatch(/pageMetaFor\(c\.req\.path\)/);
    expect(vite).toMatch(/withPageMeta\(indexHtml, meta\)/);
  });
});
