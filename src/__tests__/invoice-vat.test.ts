/**
 * Накладная выделяет НДС и печатает ИНН покупателя.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Ставки у товара не было, ИНН у магазина — тоже: ни один из трёх шаблонов
 * («Классическая», «Компактная», «Подробная») не мог напечатать «в т.ч. НДС»,
 * а в реквизитах покупателя графа ИНН оставалась пустой всегда.
 *
 * ── Что проверяется ─────────────────────────────────────────────────────────
 *
 *   • у организации есть ИНН, у товара 12 % — «в т.ч. НДС 12%» под суммой
 *     строки и под итогом, в каждом шаблоне; числа — налог из цены с НДС в
 *     целых (300 → 32, 250 → 27), итог — сумма строк;
 *   • скидка заказа уменьшает итоговый налог так же, как сумму к оплате;
 *   • строки «0%» и «без НДС» подписаны своей ставкой, налога в них нет;
 *   • у организации нет ИНН, или ни у одного товара нет 12 %, — накладная
 *     БАЙТ В БАЙТ та же, что без ставок вовсе;
 *   • ИНН магазина — в реквизитах покупателя всех трёх шаблонов; нет ИНН —
 *     ни слова.
 *
 * Нарочная поломка: в invoiceVat убери проверку sellerInn — упадёт «байт в
 * байт без ИНН организации»; в renderDetailed убери строку итога НДС —
 * упадёт «итог в каждом шаблоне».
 */
import { describe, it, expect } from "vitest";
import { INVOICE_TEMPLATES, resolveInvoiceOptions } from "@contracts/invoice-template";
import { renderInvoiceCopy, type InvoiceView } from "@/lib/invoice-templates";
import type { VatRate } from "@contracts/tax-requisites";

const text = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");
const count = (s: string, needle: string) => s.split(needle).length - 1;

function view(opts: { inn?: string; rates?: Array<VatRate | null | undefined>; shopInn?: string; discount?: number } = {}): InvoiceView {
  const rates = opts.rates ?? [undefined, undefined, undefined];
  const items = [
    { code: "0557", name: "Вода «Орол» 1.5 л", unit: "pcs", qty: 3, price: 100, total: 300 },
    { code: "1252", name: "Салфетки «Сабой»", unit: "pack", qty: 1, price: 250, total: 250 },
    { code: "0321", name: "Хлеб", unit: "pcs", qty: 2, price: 50, total: 100 },
  ].map((i, n) => (rates[n] === undefined ? i : { ...i, vatRate: rates[n] }));
  const discount = opts.discount ?? 0;
  return {
    number: "ORD-1", date: "29.09.2026", printedAt: "29.09.2026 12:00", currency: "сум",
    company: { name: "ООО Ромашка", ...(opts.inn !== undefined ? { inn: opts.inn } : {}) },
    shop: { name: "Магазин Альфа", phone: "+998900000001", address: "Навои 1", ...(opts.shopInn ? { inn: opts.shopInn } : {}) },
    items, subtotal: 650, discount, total: 650 - discount, paymentLabel: "Наличные", isPartial: false,
  };
}
const render = (v: InvoiceView, t: (typeof INVOICE_TEMPLATES)[number]) => renderInvoiceCopy(v, t, resolveInvoiceOptions(t, null));

describe("«в т.ч. НДС» на накладной", () => {
  for (const t of INVOICE_TEMPLATES) {
    it(`${t}: по строке и итогом, в целых сумах`, () => {
      const out = text(render(view({ inn: "301234567", rates: ["vat12", "vat12", null] }), t));
      expect(out).toContain("в т.ч. НДС 12%: 32 ");   // 300 × 12 / 112 = 32,14 → 32
      expect(out).toContain("в т.ч. НДС 12%: 27 ");   // 250 × 12 / 112 = 26,79 → 27
      expect(out).toMatch(/в т\.ч\. НДС 12%: 59( сум)? /); // итог — сумма строк
      expect(count(out, "в т.ч. НДС 12%")).toBe(3);
    });

    it(`${t}: БАЙТ В БАЙТ как без ставок — без ИНН организации или без единого товара на 12 %`, () => {
      const plain = render(view({ inn: "301234567" }), t);
      expect(render(view({ inn: "301234567", rates: ["vat0", "exempt", null] }), t)).toBe(plain);
      const noInn = render(view(), t);
      expect(render(view({ rates: ["vat12", "vat12", "exempt"] }), t)).toBe(noInn);
      expect(render(view({ inn: "  ", rates: ["vat12", null, null] }), t)).toBe(render(view({ inn: "  " }), t));
      expect(noInn).not.toContain("НДС");
    });

    it(`${t}: ИНН магазина — в реквизитах покупателя; нет — ни слова`, () => {
      expect(text(render(view({ shopInn: "302222222" }), t))).toContain("302222222");
      const v = view();
      expect(render({ ...v, shop: { ...v.shop, inn: "" } }, t)).toBe(render(v, t));
    });
  }

  it("«0%» и «без НДС» подписаны своей ставкой, налога в них нет", () => {
    const out = text(render(view({ inn: "301234567", rates: ["vat12", "vat0", "exempt"] }), "detailed"));
    expect(out).toContain("НДС 0%");
    expect(out).toContain("без НДС");
    expect(out).toMatch(/ИТОГО: 650 сум в т\.ч\. НДС 12%: 32 сум/);
  });

  it("скидка заказа уменьшает итоговый налог, как и сумму к оплате", () => {
    // 650 − 65 = 585; строки ×0,9: 270 → 29, 225 → 24; итог 53, а не 59.
    const out = text(render(view({ inn: "301234567", rates: ["vat12", "vat12", null], discount: 65 }), "detailed"));
    expect(out).toMatch(/ИТОГО: 585 сум в т\.ч\. НДС 12%: 53 сум/);
  });
});
