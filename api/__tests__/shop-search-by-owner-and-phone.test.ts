import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Магазин ищется по владельцу и телефону, а не только по вывеске.
 *
 * Оператор на звонке знает номер или имя хозяина; строка поиска отвечала
 * только на название, и список листали руками. Проверяется по исходнику:
 * условие — одна строка внутри процедуры, и поддельная база, не понимающая
 * like/or, доказала бы здесь ничего. Подсказка в поле — тем же тестом: без
 * неё человек не узнает, что телефон вообще можно набрать.
 */
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");

describe("поиск магазина", () => {
  it("сервер ищет по name, ownerName и phone одним OR", () => {
    const src = read("api/shop-router.ts");
    const list = src.slice(src.indexOf("  list: "), src.indexOf("\n  getById:"));
    expect(list, "условие поиска снова только по названию")
      .toMatch(/or\(like\(shops\.name, term\), like\(shops\.ownerName, term\), like\(shops\.phone, term\)\)/);
  });

  it("подсказка в поле называет все три поля, на двух языках", () => {
    const src = read("src/components/shops/ShopFilters.tsx");
    expect(src).toContain('t("Название, владелец, телефон…", "Nomi, egasi, telefon…")');
  });
});
