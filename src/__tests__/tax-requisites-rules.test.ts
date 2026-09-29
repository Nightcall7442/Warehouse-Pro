/**
 * Правила налоговых реквизитов: форматы номеров, ставки, НДС из цены.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Правил не было: ни формата ИНН/ПИНФЛ и ИКПУ, ни ставок, ни способа выделить
 * налог из цены. Одно правило теперь служит серверу, форме, импорту и
 * накладной (contracts/tax-requisites.ts) — здесь оно проверяется целиком.
 *
 * ── Что проверяется ─────────────────────────────────────────────────────────
 *
 *   • НДС из цены с НДС — в целых сумах, ровно половина — вверх: 14 → 1,5 → 2;
 *     границы 13/14/15 и крупные суммы; возврат (минус) — симметрично;
 *   • ИНН 9 цифр и ПИНФЛ 14 — да, 10 и 13 — нет; в 1С как ИНН идёт только 9;
 *   • ставка из Excel: «12», «12%», 0,12 (ячейка в процентах), «0%»,
 *     «без НДС», «QQSsiz»; пусто — не задана; «15» — нераспознано;
 *   • НДС накладной: без ИНН организации или без 12 % — не печатается.
 *
 * Нарочная поломка: замени Math.round на Math.floor в vatIncluded — упадёт
 * «половина вверх»; убери «0.12» из parseVatRate — упадёт «ячейка в процентах».
 */
import { describe, it, expect } from "vitest";
import { IKPU_RE, TAX_ID_RE, invoiceVat, isCompanyInn, onlyDigitsInput, parseVatRate, vatIncluded } from "@contracts/tax-requisites";

describe("НДС из цены с НДС", () => {
  it("целыми, ровно половина — вверх", () => {
    expect(vatIncluded(14, 12)).toBe(2);      // 1,5 → 2
    expect(vatIncluded(13, 12)).toBe(1);      // 1,39 → 1
    expect(vatIncluded(15, 12)).toBe(2);      // 1,61 → 2
    expect(vatIncluded(42, 12)).toBe(5);      // 4,5 → 5
    expect(vatIncluded(100, 12)).toBe(11);    // 10,71 → 11
    expect(vatIncluded(112_000, 12)).toBe(12_000);
    expect(vatIncluded(1_288_000, 12)).toBe(138_000);
    expect(vatIncluded(-14, 12)).toBe(-2);
    expect(vatIncluded(1000, 0)).toBe(0);
    expect(vatIncluded(0, 12)).toBe(0);
  });

  it("на всех целых суммах до 50 000 — ближайшее целое к точному, половина вверх", () => {
    for (let a = 1; a <= 50_000; a++) {
      const exact2 = (a * 12 * 2) / 112;           // удвоенное точное значение
      const expected = Math.floor((a * 12 * 2 + 112) / 224);
      expect(vatIncluded(a, 12), `сумма ${a}`).toBe(expected);
      expect(Math.abs(vatIncluded(a, 12) * 2 - exact2)).toBeLessThanOrEqual(1);
    }
  });
});

describe("форматы номеров", () => {
  it("ИНН 9 цифр, ПИНФЛ 14; остальное — нет; в 1С как ИНН — только 9", () => {
    for (const ok of ["301111111", "31234567890123"]) expect(TAX_ID_RE.test(ok)).toBe(true);
    for (const bad of ["30111111", "3011111112", "3123456789012", "301 111 111", "30111111a"]) expect(TAX_ID_RE.test(bad)).toBe(false);
    expect(onlyDigitsInput(" 301 111-111 ")).toBe("301111111");
    expect(isCompanyInn("301111111")).toBe(true);
    expect(isCompanyInn("31234567890123")).toBe(false);
    expect(isCompanyInn(null)).toBe(false);
  });

  it("ИКПУ — ровно 17 цифр, ноль в начале — часть кода", () => {
    expect(IKPU_RE.test("02202001001000000")).toBe(true);
    expect(IKPU_RE.test("2202001001000000")).toBe(false);
    expect(IKPU_RE.test("022020010010000001")).toBe(false);
  });
});

describe("ставка из Excel и ввода", () => {
  it("распознаёт принятые написания", () => {
    for (const v of ["12", "12%", "12 %", "НДС 12%", "qqs 12%", 12, 0.12, "0,12", "vat12"]) expect(parseVatRate(v), String(v)).toBe("vat12");
    for (const v of ["0", "0%", "НДС 0%", 0, "vat0"]) expect(parseVatRate(v), String(v)).toBe("vat0");
    for (const v of ["без НДС", "Без ндс", "QQSsiz", "exempt", "—"]) expect(parseVatRate(v), String(v)).toBe("exempt");
  });

  it("пусто — не задана; незнакомое — undefined, а не «какая-нибудь»", () => {
    expect(parseVatRate("")).toBeNull();
    expect(parseVatRate(null)).toBeNull();
    expect(parseVatRate("  ")).toBeNull();
    for (const v of ["15", "20%", "да", "12.5"]) expect(parseVatRate(v), v).toBeUndefined();
  });
});

describe("НДС накладной", () => {
  const items = [{ total: 300, vatRate: "vat12" as const }, { total: 250, vatRate: "exempt" as const }, { total: 100 }];
  it("печатается только при ИНН организации и хотя бы одной строке на 12 %", () => {
    expect(invoiceVat(items, 650, 650, "301234567")).toEqual({ applies: true, lines: [32, 0, null], total: 32 });
    expect(invoiceVat(items, 650, 650, "")).toMatchObject({ applies: false, total: 0 });
    expect(invoiceVat(items, 650, 650, undefined)).toMatchObject({ applies: false });
    expect(invoiceVat([{ total: 250, vatRate: "vat0" }], 250, 250, "301234567")).toMatchObject({ applies: false });
  });
});
