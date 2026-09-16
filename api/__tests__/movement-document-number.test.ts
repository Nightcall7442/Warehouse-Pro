/**
 * Номер документа в истории движений — с бумаги, а не из таблицы.
 *
 * ── Что случилось ───────────────────────────────────────────────────────────
 *
 * Карточка товара показывала «Доставка заказа №1484». Владелец: «у этого
 * арендатора нет заказа №1484». И правда: 1484 — сквозной id строки orders по
 * всем организациям, а заказ у арендатора зовётся ORD-01001. На экране и в
 * Excel стояло число, которое ничего не значит и выглядит как чужой заказ.
 *
 * ── Что стережётся ──────────────────────────────────────────────────────────
 *
 *   · выражение movementReferenceNumber берёт номер из своей таблицы для
 *     каждого типа ссылки, у которого номер есть;
 *   · каждая выборка истории движений отдаёт referenceNumber;
 *   · экран, Excel и отчёт подставляют в movementDocument номер, а не id;
 *   · без номера документ называется без «№»: внутренний id не всплывает.
 *
 * Сам SQL против живой базы проверяет real-db/courier-flow.test.ts.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NUMBERED_REFERENCES } from "../lib/movement-reference";
import { movementDocument } from "../../contracts/stock-movement-text";

const ROOT = join(__dirname, "..", "..");
const code = (p: string) => readFileSync(join(ROOT, p), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

describe("номер документа за движением", () => {
  it("для каждого типа ссылки с номером есть ветка с подзапросом", () => {
    const src = code("api/lib/movement-reference.ts");
    for (const type of NUMBERED_REFERENCES) {
      expect(src, `нет ветки для «${type}»`).toMatch(new RegExp(`WHEN '${type}'\\s+THEN \\(SELECT`));
    }
    // Ссылка на заказ — order_number, на приход — arrival_number: имена с бумаги.
    expect(src).toContain("o.order_number FROM orders o");
    expect(src).toContain("a.arrival_number FROM arrivals a");
    expect(src).toContain("r.return_number FROM returns r");
    expect(src).toContain("c.number FROM stock_counts c");
  });

  it("каждая выборка истории движений отдаёт referenceNumber", () => {
    for (const p of ["api/warehouse-router.ts", "api/product-router.ts", "api/reports-router.ts", "api/services/ProductService.ts"]) {
      const src = code(p);
      // Выборок с reference_id ровно столько же, сколько с номером: ни одна не осталась без него.
      const ids = (src.match(/referenceId: stockMovements\.referenceId/g) ?? []).length;
      const nums = (src.match(/referenceNumber: movementReferenceNumber/g) ?? []).length;
      expect(ids, p).toBeGreaterThan(0);
      expect(nums, `${p}: выборка истории без referenceNumber`).toBe(ids);
    }
  });

  it("экран, Excel и отчёт подставляют номер, а не внутренний id", () => {
    for (const p of ["src/components/warehouse/MovementHistory.tsx", "src/pages/ProductDetail.tsx", "src/lib/excel.ts", "src/components/reports/report-registry.ts"]) {
      const src = code(p);
      expect(src, p).toContain("movementDocument(");
      expect(src, `${p}: movementDocument получает referenceId`).not.toMatch(/movementDocument\([^)]*referenceId/s);
      expect(src, p).toMatch(/movementDocument\([^)]*referenceNumber/s);
    }
  });

  it("текст: номер с бумаги печатается, без номера — без «№»", () => {
    expect(movementDocument("order_delivery", "ORD-01001")).toBe("Доставка заказа №ORD-01001");
    expect(movementDocument("arrival", "ARR-0007", "uz")).toBe("Kirim №ARR-0007");
    expect(movementDocument("order_delivery", null)).toBe("Доставка заказа");
    expect(movementDocument("supplier_return", null)).not.toContain("№");
  });
});
