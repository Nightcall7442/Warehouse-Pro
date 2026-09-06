/**
 * На бумаге арендатора нет имени поставщика системы.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Расходная накладная, ТОРГ-12 и счёт на оплату подписывались строкой
 * «Документ сформирован автоматически в системе Warehouse Pro». Печать отчёта
 * в PDF шла с подзаголовком «Warehouse Pro — дата». Выгрузка в Excel уходила с
 * автором «Warehouse Pro» в свойствах файла и именем warehouse-report.xlsx.
 *
 * Это те самые бумаги, которые арендатор отдаёт СВОЕМУ покупателю. Название
 * системы, которой он пользуется, на них — то же, что штамп чужой компании.
 *
 * Отдельной строкой — шапка. Три экрана собирали реквизиты продавца сами, и
 * все три подставляли `settings?.companyName ?? "Warehouse Pro"`. Печать
 * доступна сразу, настройки приезжают запросом: накладная, распечатанная в
 * первую секунду после открытия заказа, уходила покупателю с чужим именем в
 * шапке.
 *
 * ── Почему проверка именно такая ────────────────────────────────────────────
 *
 * Перечислять исправленные строки бессмысленно — шестую напишут завтра.
 * Правило простое: файлы, которые ЛЕПЯТ документ или выгрузку, не имеют права
 * называть систему. Кабинет — сколько угодно: там арендатор и так знает, чем
 * пользуется.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const read = (p: string) => fs.readFileSync(path.resolve(process.cwd(), p), "utf8");

/** Что уходит наружу: печатные формы, выгрузки, печать отчётов. */
const DOCUMENT_MAKERS = [
  "src/lib/documents.ts",
  "src/lib/export.ts",
  "src/lib/excel.ts",
  "src/lib/print.ts",
];

/** Экраны, которые собирают документ и зовут печать. */
const DOCUMENT_CALLERS = [
  "src/components/orders/InvoicePrintModal.tsx",
  "src/components/orders/OrderSlideOver.tsx",
  "src/components/orders/LoadingListModal.tsx",
  "src/pages/OrderDetail.tsx",
  "src/pages/PnL.tsx",
  "src/pages/Salaries.tsx",
];

/** Комментарий вправе рассказывать о прошлом — падать на объяснении глупо. */
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

describe("документы не подписаны именем системы", () => {
  for (const file of [...DOCUMENT_MAKERS, ...DOCUMENT_CALLERS]) {
    it(`${file} не называет систему`, () => {
      const code = stripComments(read(file));
      const hits = [...code.matchAll(/.{0,60}Warehouse Pro.{0,60}/g)].map(m => m[0].trim());
      expect(
        hits,
        `здесь печатается имя поставщика системы:\n${hits.join("\n")}\n` +
        "На бумаге арендатора должно стоять ЕГО имя — из настроек «Компания» " +
        "(hooks/useSellerCompany), а если его ещё не прочитали, не должно стоять ничего.",
      ).toEqual([]);
    });
  }

  it("реквизиты продавца собираются в одном месте", () => {
    /*
      Три экрана собирали CompanyInfo сами, слово в слово. Достаточно было
      поправить один — и два остались бы с прежней подстановкой.
    */
    for (const file of ["src/components/orders/OrderSlideOver.tsx", "src/pages/OrderDetail.tsx", "src/components/orders/InvoicePrintModal.tsx"]) {
      const src = read(file);
      expect(src, `${file} должен брать продавца из useSellerCompany`).toContain("useSellerCompany");
      expect(
        stripComments(src),
        `${file} снова собирает реквизиты сам`,
      ).not.toMatch(/companyBankAccount/);
    }
  });

  it("без прочитанных реквизитов документ не строится", () => {
    // Печать до ответа сервера — это и есть тот случай, когда в шапку
    // подставлялось чужое имя.
    for (const file of ["src/components/orders/OrderSlideOver.tsx", "src/pages/OrderDetail.tsx"]) {
      expect(stripComments(read(file)), `${file}: нет отказа печатать без имени`)
        .toMatch(/if \(!seller\.name\) return null;/);
    }
  });
});
