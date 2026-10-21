import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Город на сайте — Ургенч, Хорезм.
 *
 * В описании для поиска и в разметке schema.org стоял Ташкент — адреса там у
 * компании нет. Описание читают в выдаче, адрес из разметки берёт поиск по
 * региону: оба должны говорить правду.
 *
 * Нарочная поломка: вернуть «Ташкент» в addressLocality — падает «разметка»;
 * убрать город из meta description — «описание».
 */
const html = readFileSync(path.join(process.cwd(), "index.html"), "utf8");

describe("город на сайте — Ургенч", () => {
  it("описание для поиска называет Ургенч и не называет Ташкент", () => {
    const desc = /<meta name="description" content="([^"]*)"/.exec(html)?.[1] ?? "";
    expect(desc).toMatch(/Ургенч/);
    expect(desc).not.toMatch(/Ташкент/);
  });

  it("разметка schema.org: адрес — Ургенч, Хорезм", () => {
    const raw = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)?.[1];
    expect(raw, "в index.html нет разметки schema.org").toBeTruthy();
    const ld = JSON.parse(raw!);
    expect(ld.publisher.address.addressLocality).toBe("Ургенч");
    expect(ld.publisher.address.addressRegion).toMatch(/Хорезм/);
    expect(ld.publisher.address.addressCountry).toBe("UZ");
  });

  it("Ташкент нигде в заголовке страницы", () => {
    const head = html.slice(0, html.indexOf("</head>"));
    expect(head.replace(/<!--[\s\S]*?-->/g, "")).not.toMatch(/Ташкент|Toshkent|Tashkent/);
  });
});
