// @vitest-environment jsdom
/**
 * Черновик прихода: переход по ссылке и перезагрузка не теряют набранное.
 * Хранится у браузера по владельцу, стирается «Отменой» и успешным сохранением.
 * Черновик прежней формы (карточка на товар) не теряется при смене экрана.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { saveArrivalDraft, loadArrivalDraft, clearArrivalDraft, arrivalDraftHasWork, type ArrivalDraft } from "@/pages/Arrivals.draft";
import { rowFromProduct } from "@/lib/arrival-sheet";

const empty = (): ArrivalDraft => ({
  form: { truckId: "", driverName: "", driverPhone: "", arrivalDate: "2026-09-12", fuelCost: "0", tollCost: "0", otherCost: "0", notes: "" },
  supplierMode: "none", supplierId: 0, newSupplierName: "", supplyAmount: "", supplyCurrency: "UZS", supplyRate: "", supplyDueDate: "",
  rows: [],
});

beforeEach(() => localStorage.clear());

describe("черновик прихода", () => {
  it("пустой — не работа; строка или шапка — работа", () => {
    expect(arrivalDraftHasWork(empty())).toBe(false);
    const d = empty(); d.rows = [rowFromProduct({ id: 7, name: "Сок" })];
    expect(arrivalDraftHasWork(d)).toBe(true);
    const h = empty(); h.form.truckId = "01 A 777 AA";
    expect(arrivalDraftHasWork(h)).toBe(true);
  });

  it("сохраняется и читается по владельцу; чужой не видит", () => {
    const d = empty(); d.rows = [{ ...rowFromProduct({ id: 7, name: "Сок" }), quantity: "12", batchNumber: "L-1", expiresAt: "2027-01-01" }];
    saveArrivalDraft(10, d);
    expect(loadArrivalDraft(10)).toEqual(d);
    expect(loadArrivalDraft(11)).toBeNull();
    clearArrivalDraft(10);
    expect(loadArrivalDraft(10)).toBeNull();
  });

  it("черновик прежней формы переносится в строки; пустые строки отброшены", () => {
    localStorage.setItem("warehouse_pro_arrival_draft:10", JSON.stringify({
      ...empty(), rows: undefined,
      items: [
        { productId: 0, quantity: "", costPrice: "", sellingPrice: "", condition: "", unit: "pcs", unitWeight: 0, batchNumber: "", expiresAt: "", expected: "" },
        { productId: 5, quantity: "3", costPrice: "100", sellingPrice: "130", condition: "", unit: "box", unitWeight: 2, batchNumber: "B", expiresAt: "", expected: "4" },
      ],
    }));
    const d = loadArrivalDraft(10)!;
    expect(d.rows).toHaveLength(1);
    expect(d.rows[0]).toMatchObject({ productId: 5, name: "", quantity: "3", expected: "4", costPrice: "100", unit: "box", batchNumber: "B" });
  });

  it("мусор в хранилище — не падение, а «черновика нет»", () => {
    localStorage.setItem("warehouse_pro_arrival_draft:10", "{oops");
    expect(loadArrivalDraft(10)).toBeNull();
  });

  it("страница восстанавливает при открытии, пишет на каждое изменение, стирает по «Отмене» и после сохранения", () => {
    const src = readFileSync("src/pages/ArrivalEditor.tsx", "utf-8");
    expect(src).toContain("useState<ArrivalDraft>(() => (isNew && user ? loadArrivalDraft(user.id) : null) ?? emptyDraft())");
    expect(src).toContain("if (arrivalDraftHasWork(draft)) saveArrivalDraft(user.id, draft); else clearArrivalDraft(user.id);");
    expect(src).toContain("if (isNew) { if (user) clearArrivalDraft(user.id); setDraft(emptyDraft()); }");
    expect(src).toContain("if (user) clearArrivalDraft(user.id);\n      setDraft(emptyDraft());");
  });
});
