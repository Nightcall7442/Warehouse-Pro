/**
 * Касса: коды не выходят к человеку.
 *
 * Директор увидел в настройках «advance», «fuel», «household» и поле «Код
 * (латиницей)» — служебные ключи статей. Коды счетов (cash.office) и статей
 * (fuel) живут в проводках; на экране, в Excel и на бумаге — слова.
 *
 *   · код статьи выводится из названия сам, латиницей, без повторов;
 *   · счёт и статья подписываются словами, бумага — по-русски всегда;
 *   · в настройках нет ни колонки с кодом, ни поля «код»;
 *   · выгрузка журнала и печать ордера идут через русские подписи.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { accountLabel, categoryCode } from "../lib/cash-labels";

const ROOT = join(__dirname, "..", "..");
const strip = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[^\S\r\n]*\/\/.*$/gm, "");
const read = (p: string) => strip(readFileSync(join(ROOT, p), "utf8"));

describe("код статьи из названия", () => {
  it("кириллица → латиница, пробелы и знаки → подчёркивание, занятый код получает номер", () => {
    expect(categoryCode("Ремонт машин")).toBe("remont_mashin");
    expect(categoryCode("  Связь / интернет  ")).toBe("svyaz_internet");
    expect(categoryCode("Ta'mirlash")).toBe("ta_mirlash");
    expect(categoryCode("Бензин", ["benzin"])).toBe("benzin_2");
    expect(categoryCode("Бензин", ["benzin", "benzin_2"])).toBe("benzin_3");
    expect(categoryCode("!!!")).toBe("other");
    expect(categoryCode("Ремонт машин")).toMatch(/^[a-z0-9_]{2,64}$/); // формат, который принимает saveCategory
  });
});

describe("счета словами", () => {
  const cat = (code: string) => ({ fuel: "Бензин и транспорт" }[code] ?? code);
  it("сейф, на руках, долг, статья по имени; узбекский на экране, русский на бумаге", () => {
    expect(accountLabel("cash.office", "ru", cat)).toBe("сейф");
    expect(accountLabel("cash.employee.7", "uz", cat)).toBe("qo'lda");
    expect(accountLabel("receivable.employee.7", "ru", cat)).toBe("долг сотрудника");
    expect(accountLabel("expense.fuel", "ru", cat)).toBe("расход · Бензин и транспорт");
    expect(accountLabel("expense.fuel", "uz", cat)).toBe("xarajat · Бензин и транспорт");
    expect(accountLabel("income.unexplained", "ru", cat)).toBe("до выяснения");
  });
});

describe("экран кассы", () => {
  const page = read("src/pages/Cash.tsx");
  it("в настройках нет колонки с кодом и поля «код»", () => {
    expect(page).not.toMatch(/<code[^>]*>\{c\.code\}/);
    expect(page).not.toContain("Код (латиницей)");
    expect(page).toContain("categoryCode(newCat.name, (cats.data ?? []).map(c => c.code))");
  });
  it("журнал: Excel и печать — через русские подписи, статья по имени", () => {
    expect(page).toContain("debit: ACC_RU(r.debit), credit: ACC_RU(r.credit)");
    expect(page).toContain("category: r.category ? catName(r.category) : \"\"");
    expect(page).toContain("basis: `${ACC_RU(r.debit)} ← ${ACC_RU(r.credit)}`");
    expect(page).not.toMatch(/basis: `[^`]*r\.category/);
  });
});
