import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PAGE_META, siteHead, structuredData } from "@/site/site-head";
import { SITE_PAGES, pageLangs } from "@contracts/site-pages";

/**
 * Город на сайте — Ургенч, Хорезм.
 *
 * В описании для поиска и в разметке schema.org стоял Ташкент — адреса там у
 * компании нет. Описание читают в выдаче, адрес из разметки берёт поиск по
 * региону: оба должны говорить правду.
 *
 * Разметка schema.org и описания страниц сайта переехали из оболочки
 * (index.html) в <head> готовых страниц (src/site/site-head.ts) — у каждой
 * страницы и языка свои; проверка смотрит туда. В оболочке остались описание
 * и карточка — для ссылок на экраны приложения.
 *
 * Нарочная поломка: вернуть «Ташкент» в addressLocality — падает «разметка»;
 * убрать город из описания главной — «описание».
 */
const shell = readFileSync(path.join(process.cwd(), "index.html"), "utf8");
const home = SITE_PAGES.find(p => p.key === "home")!;

describe("город на сайте — Ургенч", () => {
  it("описание главной для поиска называет Ургенч на обоих языках и не называет Ташкент", () => {
    expect(PAGE_META.home.description.ru).toMatch(/Ургенч/);
    expect(PAGE_META.home.description.uz).toMatch(/Urganch/);
    const shellDesc = /<meta name="description" content="([^"]*)"/.exec(shell)?.[1] ?? "";
    expect(shellDesc).toMatch(/Ургенч/);
  });

  it("разметка schema.org: адрес — Ургенч, Хорезм — на каждой странице сайта", () => {
    for (const page of SITE_PAGES) {
      for (const lang of pageLangs(page)) {
        const graph = (structuredData(page, lang) as { "@graph": Array<{ "@type": string; address?: Record<string, string> }> })["@graph"];
        const org = graph.find(n => n["@type"] === "Organization")!;
        expect(org.address!.addressLocality).toBe(lang === "ru" ? "Ургенч" : "Urganch");
        expect(org.address!.addressRegion).toMatch(lang === "ru" ? /Хорезм/ : /Xorazm/);
        expect(org.address!.addressCountry).toBe("UZ");
      }
    }
  });

  it("Ташкент нигде в заголовке оболочки и страниц сайта", () => {
    const heads = [
      shell.slice(0, shell.indexOf("</head>")).replace(/<!--[\s\S]*?-->/g, ""),
      ...SITE_PAGES.flatMap(p => pageLangs(p).map(l => siteHead(p, l))),
    ];
    for (const h of heads) expect(h).not.toMatch(/Ташкент|Toshkent|Tashkent/);
    expect(siteHead(home, "ru")).toMatch(/Ургенч/);
  });
});
