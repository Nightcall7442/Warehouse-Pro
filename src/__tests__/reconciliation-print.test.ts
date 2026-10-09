/**
 * Печатный акт сверки — бланк, который бухгалтер магазина сверяет со своей 1С.
 *
 * Проверяется то, без чего он бумагу не примет: две половины таблицы (вторая
 * пустая — её заполняет он), сальдо в столбце своей стороны, обороты, итоговая
 * фраза «в пользу кого и сколько» прописью, и что чужое имя не ломает разметку.
 */
import { describe, it, expect } from "vitest";
import { reconciliationHtml, reconciliationConclusion, reconciliationDocLabel, type ReconciliationPrintInput } from "@/lib/reconciliation-print";

const base: ReconciliationPrintInput = {
  shop: { name: "Mega Do'kon", ownerName: "Азиз Каримов", taxId: "305123456", address: null },
  company: { name: "Fresh MCHJ", inn: "301000001", director: "Бобур Юсупов" },
  period: { from: "2026-10-01", to: "2026-10-09" },
  opening: 100000,
  rows: [
    { date: new Date(2026, 9, 3, 12), kind: "order", doc: "З-15", note: null, debit: 50000, credit: 0 },
    { date: new Date(2026, 9, 5, 12), kind: "payment", doc: null, note: "наличными", debit: 0, credit: 30000 },
  ],
  totals: { debit: 50000, credit: 30000 },
  closing: 120000,
  currency: "сум",
  inWords: true,
  today: new Date(2026, 9, 9, 12),
};

/** Текст ячеек строки таблицы, у которой первая ячейка начинается с `label`. */
function rowCells(html: string, label: string): string[] {
  const row = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map(m => m[1]).find(r => r.includes(`>${label}<`));
  if (!row) throw new Error(`нет строки «${label}»`);
  return [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(m => flat(m[1].replace(/<[^>]+>/g, "")).trim());
}

/** Разряды в русской записи числа разделяет неразрывный пробел — сравниваем по обычному. */
const flat = (s: string) => s.replace(/\s/g, " ");

describe("печатный акт сверки по образцу 1С", () => {
  it("шапка: период и стороны", () => {
    const html = reconciliationHtml(base);
    expect(html).toContain("Акт сверки");
    expect(html).toContain("взаимных расчётов за 01.10.2026 — 09.10.2026");
    expect(html).toContain("между Fresh MCHJ и Mega Do'kon");
    expect(html).toContain("ИНН 301000001");
    expect(html).toContain("ИНН 305123456");
  });

  it("две половины таблицы: наша заполнена, сторона покупателя пустая", () => {
    const html = reconciliationHtml(base);
    expect(html).toContain("По данным Fresh MCHJ, сум");
    expect(html).toContain("По данным Mega Do'kon, сум");
    const order = rowCells(html, "03.10.2026");
    expect(order.slice(0, 4)).toEqual(["03.10.2026", "Отгрузка № З-15", "50 000,00", ""]);
    expect(order.slice(4), "сторону покупателя мы не заполняем").toEqual(["", "", "", ""]);
  });

  it("сальдо стоит в столбце своей стороны: долг — в дебете, переплата — в кредите", () => {
    const debt = rowCells(reconciliationHtml(base), "Сальдо начальное");
    expect(debt.slice(1, 3)).toEqual(["100 000,00", ""]);

    const over = rowCells(reconciliationHtml({ ...base, opening: -20000 }), "Сальдо начальное");
    expect(over.slice(1, 3)).toEqual(["", "20 000,00"]);

    const end = rowCells(reconciliationHtml(base), "Сальдо конечное");
    expect(end.slice(1, 3)).toEqual(["120 000,00", ""]);
  });

  it("обороты — суммы дебета и кредита за период", () => {
    const turn = rowCells(reconciliationHtml(base), "Обороты за период");
    expect(turn.slice(1, 3)).toEqual(["50 000,00", "30 000,00"]);
  });

  it("итог: в чью пользу, на какую дату и сколько прописью", () => {
    expect(flat(reconciliationConclusion(base, "09.10.2026")))
      .toBe("на 09.10.2026 задолженность в пользу Fresh MCHJ составляет 120 000,00 сум (Сто двадцать тысяч сумов 00 тийинов).");
    expect(flat(reconciliationConclusion({ ...base, closing: -5000 }, "09.10.2026")))
      .toBe("на 09.10.2026 задолженность в пользу Mega Do'kon составляет 5 000,00 сум (Пять тысяч сумов 00 тийинов).");
    expect(reconciliationConclusion({ ...base, closing: 0 }, "09.10.2026"))
      .toBe("на 09.10.2026 задолженность отсутствует.");
  });

  it("не сумы — без прописи: склонять доллары этим кодом нельзя", () => {
    const text = reconciliationConclusion({ ...base, currency: "$", inWords: false }, "09.10.2026");
    expect(flat(text)).toBe("на 09.10.2026 задолженность в пользу Fresh MCHJ составляет 120 000,00 $.");
  });

  it("открытый период — «весь период по сегодня»", () => {
    const html = reconciliationHtml({ ...base, period: { from: "", to: "" } });
    expect(html).toContain("взаимных расчётов за весь период по 09.10.2026");
  });

  it("пустой период говорит словами, а не пустой таблицей", () => {
    const html = reconciliationHtml({ ...base, rows: [], totals: { debit: 0, credit: 0 } });
    expect(html).toContain("Движений за период не было.");
  });

  it("подписи: руководитель с именем из реквизитов, места для печатей", () => {
    const html = reconciliationHtml(base);
    expect(html).toContain("Руководитель");
    expect(html).toContain("(Бобур Юсупов)");
    expect(html).toContain("(Азиз Каримов)");
    expect(html.match(/М\.П\./g)).toHaveLength(2);
  });

  it("имя с разметкой не ломает бланк", () => {
    const html = reconciliationHtml({ ...base, shop: { ...base.shop, name: "<script>x</script>" } });
    expect(html).not.toContain("<script>x</script>");
    expect(html).toContain("&lt;script&gt;x&lt;/script&gt;");
  });

  it("документ в строке: вид и номер, у ручной записи — примечание", () => {
    expect(reconciliationDocLabel({ kind: "return", doc: "В-3", note: null })).toBe("Возврат от покупателя № В-3");
    expect(reconciliationDocLabel({ kind: "payment", doc: null, note: "  наличными " })).toBe("Оплата (наличными)");
    expect(reconciliationDocLabel({ kind: "debt", doc: null, note: null })).toBe("Начисление долга");
    expect(reconciliationDocLabel({ kind: "payment", doc: null, note: "x".repeat(80) })).toHaveLength("Оплата ()".length + 58);
  });
});
