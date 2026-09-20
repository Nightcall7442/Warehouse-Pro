/**
 * Скрипт Яндекс.Карт грузится один раз на страницу.
 *
 * Второй <script> с тем же API — «api is already enabled on this page with
 * same namespace» в консоли на карте супервайзера (прогон 20.09.2026):
 * повторное монтирование, пока первый тег ещё грузится, добавляло второй.
 * Загрузчик обязан сперва искать уже добавленный тег и ждать его, а свой —
 * помечать, чтобы следующий монтаж его нашёл.
 *
 * Нарочная поломка: убери `script.dataset.ymaps = "1"` или проверку
 * `script[data-ymaps]` — упадёт.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

describe("Яндекс.Карты: один тег скрипта", () => {
  it("загрузчик ищет уже добавленный тег до того, как добавить свой, и помечает свой", () => {
    const src = readFileSync("src/pages/SupervisorTracking.tsx", "utf-8");
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
  });
});
