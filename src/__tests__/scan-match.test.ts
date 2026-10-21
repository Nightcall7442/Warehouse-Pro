/**
 * Скан → товар: одно правило на все экраны со сканером (src/lib/scan-match.ts).
 *
 * Было семь копий сравнения «штрих-код или код», и они уже разошлись:
 * «Штрих-коды» сравнивала с учётом регистра, остальные без; дополнительных
 * штрих-кодов не знала ни одна. Здесь — поведение правила, а ниже — что
 * копий по экранам больше нет.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { findScanned, matchesBarcode, normScan } from "@/lib/scan-match";

const catalog = [
  { id: 1, code: "A-1", barcode: "4870001234567", barcodes: ["4870000000024"] },
  { id: 2, code: "B-2", barcode: null, barcodes: ["ab-77"] },
  // Старый ответ сервера и копия каталога без поля barcodes.
  { id: 3, code: "4870000000024", barcode: "X-3" },
];

describe("findScanned", () => {
  it("находит по основному, по дополнительному штрих-коду и по коду — целиком, без регистра и пробелов", () => {
    expect(findScanned(catalog, "4870001234567")?.id).toBe(1);
    expect(findScanned(catalog, " AB-77 ")?.id).toBe(2);
    expect(findScanned(catalog, "b-2")?.id).toBe(2);
    expect(findScanned(catalog, "x-3")?.id).toBe(3);
    expect(findScanned(catalog, "487000123456")).toBeUndefined();
    expect(findScanned(catalog, "   ")).toBeUndefined();
    expect(findScanned(undefined, "A-1")).toBeUndefined();
  });

  it("порядок как у сервера: основной штрих-код, затем дополнительный, затем код товара", () => {
    // «4870000000024» — дополнительный у первого и код у третьего: штрих-код выше кода.
    expect(findScanned(catalog, "4870000000024")?.id).toBe(1);
    // Основной у позднего выше дополнительного у раннего.
    const twins = [{ id: 1, barcodes: ["777"] }, { id: 2, barcode: "777" }];
    expect(findScanned(twins, "777")?.id).toBe(2);
  });

  it("строка с другими именами полей — через view (строка инвентаризации: productCode)", () => {
    const items = [{ productId: 5, productCode: "C-5", barcode: null, barcodes: ["9990"] }];
    const view = (i: (typeof items)[number]) => ({ code: i.productCode, barcode: i.barcode, barcodes: i.barcodes });
    expect(findScanned(items, "9990", view)?.productId).toBe(5);
    expect(findScanned(items, "c-5", view)?.productId).toBe(5);
  });
});

describe("matchesBarcode", () => {
  it("совпадение по любому штрих-коду, но не по коду товара; пустой скан не совпадает ни с чем", () => {
    expect(matchesBarcode(catalog[1], normScan("AB-77"))).toBe(true);
    expect(matchesBarcode(catalog[1], normScan("B-2"))).toBe(false);
    expect(matchesBarcode({ code: "", barcode: "" }, normScan(""))).toBe(false);
  });
});

describe("копий правила по экранам больше нет", () => {
  const SITES = [
    "src/pages/ArrivalEditor.tsx",
    "src/components/warehouse/StockCounts.tsx",
    "src/components/orders/QuickOrderModal.tsx",
    "src/components/orders/ProductSelector.tsx",
    "src/pages/Barcode.tsx",
    "src/components/arrivals/ProductMultiPicker.tsx",
  ];
  it.each(SITES)("%s сравнивает скан через scan-match, а не своей копией", (file) => {
    const src = readFileSync(file, "utf-8");
    expect(src).toContain('from "@/lib/scan-match"');
    // Прежняя копия: (x.barcode ?? "").toLowerCase() === norm и её вариант без регистра.
    expect(src).not.toMatch(/\.barcode \?\? ""\)\.toLowerCase\(\) ===/);
    expect(src).not.toMatch(/p\.barcode === scanned/);
  });
});
