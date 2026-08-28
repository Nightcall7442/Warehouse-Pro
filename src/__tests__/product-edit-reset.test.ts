import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Правка карточки товара.
 *
 * Набранное складывалось в editData и не очищалось никогда. Человек правил
 * название, нажимал «Отмена», открывал правку снова — в поле стояло исходное
 * название, потому что само поле сбрасывалось, — а в editData лежало старое
 * исправленное. «Сохранить» отправляло то, чего на экране не было.
 */
const SRC = readFileSync(join(process.cwd(), "src", "pages", "ProductDetail.tsx"), "utf8");

describe("отменённая правка товара не сохраняется позже", () => {
  it("выход из правки очищает набранное", () => {
    expect(SRC, "очистка набранного пропала").toContain("setEditing(false); setEditData({});");
  });

  it("«Отмена» пользуется именно этим выходом", () => {
    const at = SRC.indexOf("Bekor qilish");
    const btn = SRC.slice(SRC.lastIndexOf("<button", at), at);
    expect(btn, "кнопка отмены снова закрывает правку, не очищая набранное").toContain("onClick={stopEditing}");
  });

  it("успешное сохранение тоже очищает", () => {
    // Иначе следующая правка начнётся с полей предыдущей.
    const at = SRC.indexOf("utils.product.getById.invalidate");
    expect(SRC.slice(at, at + 120)).toContain("stopEditing()");
  });

  it("цены в карточке берут значение из состояния, а не только начальное", () => {
    // Поля были неуправляемыми: значение попадало в editData лишь при
    // изменении, и показать набранное обратно было нечем.
    for (const key of ["costPrice", "unitPrice", "unitWeight", "reorderPoint"]) {
      const at = SRC.indexOf(`onValueChange={v=>setEditData((d: Record<string, unknown>)=>({...d,${key}:v}))}`);
      expect(at, `поле «${key}» больше не разбирает десятичный ввод`).toBeGreaterThan(0);
      const field = SRC.slice(SRC.lastIndexOf("<DecimalInput", at), at);
      expect(field, `поле «${key}» снова неуправляемое`).toContain(`value={String(editData.${key} ?? product.${key} ?? "")}`);
    }
  });
});
