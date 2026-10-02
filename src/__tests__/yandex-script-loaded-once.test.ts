/**
 * Скрипт Яндекс.Карт грузится один раз на страницу.
 *
 * Второй <script> с тем же API — «api is already enabled on this page with
 * same namespace» в консоли на карте супервайзера (прогон 20.09.2026):
 * повторное монтирование, пока первый тег ещё грузится, добавляло второй.
 * Загрузчик обязан сперва искать уже добавленный тег и ждать его, а свой —
 * помечать, чтобы следующий монтаж его нашёл.
 *
 * Загрузчик один на все экраны (src/lib/yandex-maps.ts): карта супервайзера
 * и карта продаж в «Отчётах» зовут его, а не добавляют тег сами — иначе на
 * переходе «Отчёты» → «Слежение» тегов стало бы два.
 *
 * Нарочная поломка: убери `script.dataset.ymaps = "1"` или проверку
 * `script[data-ymaps]` в загрузчике — упадёт первая проверка; добавь
 * `document.createElement("script")` в карту продаж — вторая.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf-8");

describe("Яндекс.Карты: один тег скрипта", () => {
  it("загрузчик ищет уже добавленный тег до того, как добавить свой, и помечает свой", () => {
    const src = read("src/lib/yandex-maps.ts");
    const lookup = src.indexOf('querySelector<HTMLScriptElement>("script[data-ymaps]")');
    const mark = src.indexOf('script.dataset.ymaps = "1"');
    const append = src.indexOf("document.head.appendChild(script)");
    expect(lookup, "нет поиска уже добавленного тега").toBeGreaterThan(0);
    expect(mark, "свой тег не помечен").toBeGreaterThan(0);
    expect(append).toBeGreaterThan(0);
    expect(lookup, "поиск стоит после добавления").toBeLessThan(append);
    expect(mark, "пометка стоит после добавления").toBeLessThan(append);
    // Между поиском и добавлением — выход, если тег уже есть.
    expect(src.slice(lookup, append)).toMatch(/if \(existing\) \{[\s\S]*return/);
    // Одновременные вызовы делят одно обещание.
    expect(src).toMatch(/if \(loading\) return loading;/);
  });

  it("экраны с картой зовут общий загрузчик и не добавляют тег сами", () => {
    for (const file of ["src/pages/SupervisorTracking.tsx", "src/components/reports/SalesMapView.tsx"]) {
      const src = read(file);
      expect(src, file).toContain("loadYandexMaps()");
      expect(src, file).not.toContain('document.createElement("script")');
      expect(src, file).not.toContain("api-maps.yandex.ru/2.1");
    }
  });
});
