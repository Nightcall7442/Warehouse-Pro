// @vitest-environment jsdom
/**
 * Черновик прихода: клик мимо окна и перезагрузка больше не теряют набранное.
 * Хранится у браузера по владельцу, стирается «Отменой» и успешным сохранением.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { saveArrivalDraft, loadArrivalDraft, clearArrivalDraft, arrivalDraftHasWork, type ArrivalDraft } from "@/pages/Arrivals.draft";

const empty = (): ArrivalDraft => ({
  form: { truckId: "", driverName: "", driverPhone: "", arrivalDate: "2026-09-12", fuelCost: "0", tollCost: "0", otherCost: "0", notes: "" },
  supplierMode: "none", supplierId: 0, newSupplierName: "", supplyAmount: "", supplyCurrency: "UZS", supplyRate: "", supplyDueDate: "",
  items: [{ productId: 0, quantity: "", costPrice: "", sellingPrice: "", condition: "Хорошее", unit: "pcs", unitWeight: 0, batchNumber: "", expiresAt: "", expected: "" }],
});

beforeEach(() => localStorage.clear());

describe("черновик прихода", () => {
  it("пустая форма — не работа; строка с товаром или шапка — работа", () => {
    expect(arrivalDraftHasWork(empty())).toBe(false);
    const d = empty(); d.items[0].productId = 7; d.items[0].quantity = "12";
    expect(arrivalDraftHasWork(d)).toBe(true);
    const h = empty(); h.form.truckId = "01 A 777 AA";
    expect(arrivalDraftHasWork(h)).toBe(true);
  });

  it("сохраняется и читается по владельцу; чужой не видит", () => {
    const d = empty(); d.items[0].productId = 7; d.items[0].quantity = "12"; d.items[0].batchNumber = "L-1"; d.items[0].expiresAt = "2027-01-01";
    saveArrivalDraft(10, d);
    expect(loadArrivalDraft(10)).toEqual(d);
    expect(loadArrivalDraft(11)).toBeNull();
    clearArrivalDraft(10);
    expect(loadArrivalDraft(10)).toBeNull();
  });

  it("мусор в хранилище — не падение, а «черновика нет»", () => {
    localStorage.setItem("warehouse_pro_arrival_draft:10", "{oops");
    expect(loadArrivalDraft(10)).toBeNull();
  });

  it("форма восстанавливает при открытии, пишет на каждое изменение, стирает по «Отмене» и после сохранения", () => {
    const src = readFileSync("src/pages/Arrivals.tsx", "utf-8");
    expect(src).toContain("const d = loadArrivalDraft(user.id);");
    expect(src).toContain("if (arrivalDraftHasWork(d)) saveArrivalDraft(user.id, d); else clearArrivalDraft(user.id);");
    expect(src).toContain("onClick={() => { if (user) clearArrivalDraft(user.id); onClose(); }}");
    expect(src).toContain("onSuccess: () => { if (me) clearArrivalDraft(me.id);");
  });
});

describe("склад: окно строк вместо десяти тысяч разом", () => {
  it("первые 200, дальше по кнопке; новый поиск начинает с начала", () => {
    const src = readFileSync("src/pages/Warehouse.tsx", "utf-8");
    expect(src).toContain("const PAGE = 200;");
    expect(src).toContain("const shown = stock?.slice(0, visibleRows);");
    expect(src).toContain('data-testid="stock-show-more"');
    expect(src).toContain("if (win.key !== windowKey) setWin({ key: windowKey, rows: PAGE });");
    expect(src).not.toMatch(/:\s*stock\?\.map\(\(item\)/);
  });
});
