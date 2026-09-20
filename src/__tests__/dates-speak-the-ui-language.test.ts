/**
 * Даты и валюта на экране — на языке экрана.
 *
 * Узбекский интерфейс 20.09.2026: «воскресенье, 20 сентября» на главной
 * (локаль ru зашита), «20 September» у агента (без локали date-fns говорит
 * по-английски) и «52 000 сум» на каждой странице (символ арендатора — одно
 * русское слово). Три стража:
 *  1. словарь date-fns берётся только через lib/date-locale — одна дверь;
 *  2. каждый format() с названиями месяцев или дней недели получает локаль;
 *  3. символ «сум» по-узбекски — so'm, чужие символы не трогаются.
 *
 * Нарочная поломка: в любом экране убери `{ locale: dateLocale(lang) }` у
 * format(…, "d MMMM") — упадёт «каждый format с названиями»; импортируй
 * `ru` из date-fns/locale в экране — упадёт «одна дверь»; в useCurrency
 * верни `settings?.currencySymbol ?? …` — упадёт «сум → so'm».
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { format } from "date-fns";
import { dateLocale } from "@/lib/date-locale";
import { currencySymbolFor } from "@/hooks/useCurrency";

function* walk(dir: string): Generator<string> {
  for (const e of readdirSync(dir)) {
    const full = join(dir, e);
    if (statSync(full).isDirectory()) { if (e !== "__tests__") yield* walk(full); }
    else if (/\.tsx?$/.test(e)) yield full.split("\\").join("/");
  }
}
// Бумага и служебное остаются русскими (решение владельца): печать, Excel, мониторинг, суперадмин.
const PAPER = /superadmin|Monitoring|invoice-templates|[Pp]rint|[Ee]xport|[Ll]anding|documents\.ts|onec/;
const SCREENS = [...walk("src/pages"), ...walk("src/components"), ...walk("src/hooks")].filter(f => !PAPER.test(f));

describe("даты на языке экрана", () => {
  it("словарь date-fns берётся только через lib/date-locale", () => {
    const doors = [...walk("src")].filter(f => readFileSync(f, "utf-8").includes("date-fns/locale"));
    expect(doors).toEqual(["src/lib/date-locale.ts"]);
  });

  it("каждый format() с названиями месяцев или дней недели получает локаль", () => {
    const bare: string[] = [];
    for (const f of SCREENS) {
      readFileSync(f, "utf-8").split(/\r?\n/).forEach((line, i) => {
        // Токены с названиями: MMM/MMMM (месяц словом), EEE/EEEE (день недели), LLLL (месяц в именительном).
        if (!/\bformat\([^"'`]*["'`][^"'`]*\b(MMM|EEE|LLL)/.test(line)) return;
        if (/dateLocale\(|\bloc\b/.test(line)) return;
        bare.push(`${f}:${i + 1}: ${line.trim().slice(0, 100)}`);
      });
    }
    expect(bare, bare.join("\n")).toEqual([]);
  });

  it("узбекский словарь — латиница, русский — русский", () => {
    const d = new Date(2026, 8, 20);
    expect(format(d, "EEEE, d MMMM", { locale: dateLocale("uz") })).toBe("Yakshanba, 20 Sentabr");
    expect(format(d, "EEEE, d MMMM", { locale: dateLocale("ru") })).toBe("воскресенье, 20 сентября");
  });
});

describe("валюта на языке экрана", () => {
  it("«сум» арендатора по-узбекски — so'm, и обратно", () => {
    expect(currencySymbolFor("сум", "uz")).toBe("so'm");
    expect(currencySymbolFor("сум", "ru")).toBe("сум");
    expect(currencySymbolFor("so'm", "ru")).toBe("сум");
    expect(currencySymbolFor(undefined, "uz")).toBe("so'm");
    expect(currencySymbolFor(undefined, "ru")).toBe("сум");
  });
  it("чужой символ не трогается", () => {
    expect(currencySymbolFor("$", "uz")).toBe("$");
    expect(currencySymbolFor("₽", "ru")).toBe("₽");
  });
});
