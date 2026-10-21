import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Книга в docs/manual собрана из того содержания, что лежит рядом с ней.
 *
 * Читают не scripts/manual_content.py, а собранные docs/manual/*.html: их
 * отдаёт /manual, их же везёт в образ Dockerfile. Пересобирает книгу CI на
 * ветке docs/manual-* (scripts/build_manual.py), и правка содержания без
 * пересборки уходила в main молча: 21.10.2026 книга ещё писала «Продажа
 * всегда идёт с основного склада», «Заказ поставщику оформляется приходом»
 * и «десять галочек», хотя содержание это уже сняло, а о курьерах и доске
 * развоза в ней не было ни слова. Соседний страж (manual-figs-have-scenarios)
 * следит за картинками; этот — за текстом.
 *
 * Каждый текст содержания — абзац, шаг, ячейка, заголовок, подпись к
 * рисунку — обязан стоять в книге на своём языке так, как его экранирует
 * сборщик (html.escape). Выноски не проверяются: в книгу попадают только
 * те, что нашлись на снимке.
 *
 * Нарочная поломка: на ветке до пересборки книги страж падал — 78 текстов
 * содержания на каждом языке в HTML не было.
 */
const ROOT = process.cwd();
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8").replace(/\r\n/g, "\n");
const content = read("scripts/manual_content.py");

/** Тексты T("ru", "uz") вне выносок; пустой uz сборщик заменяет русским. */
const texts: Array<{ ru: string; uz: string; line: number }> = [];
for (const m of content.matchAll(/(\["\w+",\s*)?T\("([^"]*)"(?:,\s*"([^"]*)")?\)/g)) {
  if (m[1]) continue;
  texts.push({ ru: m[2], uz: m[3] || m[2], line: content.slice(0, m.index).split("\n").length });
}

/** Как html.escape в Python: кавычки тоже. */
const esc = (s: string) => s
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#x27;");

describe("книга собрана из текущего содержания", () => {
  it("содержание разобрано", () => {
    // В книге больше тысячи текстов; меньше — разбор сломался, а не книга сошлась.
    expect(texts.length).toBeGreaterThan(1000);
    expect(content).not.toMatch(/\bT\('/);
  });

  for (const lang of ["ru", "uz"] as const) {
    it(`${lang}: каждый текст содержания есть в docs/manual/manual.${lang}.html`, () => {
      const html = read(`docs/manual/manual.${lang}.html`);
      const missing = texts.filter(t => !html.includes(esc(t[lang])))
        .map(t => `manual_content.py:${t.line} ${t[lang].slice(0, 90)}`);
      expect(missing, "книга не пересобрана после правки содержания — запустите сборку руководства (CI на ветке docs/manual-*):\n" + missing.slice(0, 20).join("\n")).toEqual([]);
    });
  }
});
