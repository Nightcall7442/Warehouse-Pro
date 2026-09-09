import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { PLANS, EXTRA_PRICES_UZS, type PlanKey } from "@contracts/constants";

/**
 * Числа тарифов нигде не переписаны словами.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * На экране оплаты (src/pages/BillingSettings.tsx) список возможностей тарифа
 * был набран строками: «5 пользователей», «50 товаров», а у Exclusive —
 * «Безлимит пользователей» и «Безлимит товаров». Пока числа совпадали с PLANS,
 * это выглядело безобидно. Потом безлимит отменили — и экран оплаты продолжил
 * обещать то, чего сервер уже не давал.
 *
 * Беда была не в опечатке, а в том, что число живёт в двух местах, и о втором
 * никто не вспоминает, правя первое. Лендинг эту болезнь уже пережил и лечится
 * тем же способом: он читает PLANS.
 *
 * ── Что проверяется здесь ───────────────────────────────────────────────────
 *
 * Что оба экрана, показывающие тарифы человеку, читают источник, а не свою
 * копию, и что слова про безлимит не вернулись туда, где предел уже есть.
 */
const read = (p: string) => fs.readFileSync(path.resolve(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
const BILLING = read("src/pages/BillingSettings.tsx");
const LANDING = read("src/components/landing/PricingSection.tsx");

describe("экраны тарифов читают источник", () => {
  it("экран оплаты берёт пределы из PLANS", () => {
    expect(BILLING).toContain("function limitLines(key: PlanKey)");
    expect(BILLING).toContain("PLANS[key]");
    for (const key of Object.keys(PLANS) as PlanKey[]) {
      expect(BILLING, `тариф ${key} не собирает пределы из источника`).toContain(`limitLines("${key}")`);
    }
  });

  it("лендинг берёт пределы из PLANS", () => {
    expect(LANDING).toContain("PLANS.basic.maxUsers");
    expect(LANDING).toContain("PLANS.pro.maxProducts");
    expect(LANDING).toContain("PLANS.exclusive.maxUsers");
  });

  it("слова про безлимит не стоят там, где предел есть", () => {
    /*
      Отдельная проверка, потому что «Безлимит» пережил отмену безлимита именно
      как текст: числа рядом уже пришли из PLANS, а строка списка осталась.
    */
    const limited = (Object.keys(PLANS) as PlanKey[])
      .every(k => PLANS[k].maxUsers !== null && PLANS[k].maxProducts !== null);
    expect(limited, "у какого-то тарифа снова нет предела — проверку ниже надо пересмотреть").toBe(true);

    for (const [file, src] of [["экран оплаты", BILLING], ["лендинг", LANDING]] as const) {
      const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      for (const word of ["Безлимит пользователей", "Безлимит товаров", "Cheksiz foydalanuvchi", "Cheksiz mahsulot"]) {
        expect(code, `${file}: обещание «${word}» вернулось`).not.toContain(word);
      }
    }
  });

  it("лендинг называет надбавку — иначе предел читается как стена", () => {
    /*
      Предел без слова о надбавке отсекает оптовика: «не хватает пятидесяти
      позиций — значит не наш продукт». Надбавка существует ровно для этого
      случая, но узнать о ней можно было, только уже став клиентом.
    */
    expect(LANDING).toContain("EXTRA_PRICES_UZS.user");
    expect(LANDING).toContain("EXTRA_PRICES_UZS.product");
    // Цены не переписаны числом рядом с надписью.
    const code = LANDING.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(code).not.toContain(String(EXTRA_PRICES_UZS.user));
    expect(code).not.toContain(String(EXTRA_PRICES_UZS.product));
  });
});
