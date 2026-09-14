import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { ru } from "@/i18n/ru";
import { uz } from "@/i18n/uz";

/**
 * Ряд из трёх кнопок внизу бокового меню: уведомления · руководство · поддержка.
 *
 * Каждая кнопка ~70 px. Узбекские «Bildirishnomalar» и «Qo'llab-quvvatlash»
 * в неё не входили, а `truncate` не срабатывал: в колонке flex подпись не
 * сжимается ниже своего текста, пока ей не сказано max-w-full, — и текст
 * вылезал за кнопку с обеих сторон. Снимок владельца, 14.09.2026.
 *
 * Два правила, оба нужны: короткая подпись — чтобы читалось целиком,
 * ограничение ширины — чтобы длинная подпись, если её когда-нибудь вернут,
 * обрезалась многоточием, а не вылезала.
 */
const ROW = ["notifications", "manual", "support"] as const;

/* Три кнопки по ~70 px при 10.5 px шрифта — это около 11 знаков; «Уведомления»
   ровно столько и проходит. */
const MAX = 11;

describe("подписи ряда помещаются в кнопку", () => {
  for (const key of ROW) {
    it(`ru: ${key}`, () => {
      expect(ru.nav[key].length, `«${ru.nav[key]}» длиннее ${MAX}`).toBeLessThanOrEqual(MAX);
    });
    it(`uz: ${key}`, () => {
      expect(uz.nav[key].length, `«${uz.nav[key]}» длиннее ${MAX}`).toBeLessThanOrEqual(MAX);
    });
  }
});

describe("подпись не вылезает за кнопку", () => {
  it("каждая из трёх подписей ограничена шириной кнопки", () => {
    const src = readFileSync(path.resolve(process.cwd(), "src/components/Layout.tsx"), "utf8")
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, " ");
    for (const key of ROW) {
      const m = src.match(new RegExp(`<span className="([^"]*)">\\{t\\("nav\\.${key}"\\)\\}</span>`));
      expect(m, `подписи nav.${key} в ряду нет`).not.toBeNull();
      const cls = m![1].split(/\s+/);
      expect(cls, `nav.${key}: без truncate длинная подпись не обрежется`).toContain("truncate");
      expect(cls, `nav.${key}: без max-w-full truncate не срабатывает в колонке flex`).toContain("max-w-full");
    }
  });
});
