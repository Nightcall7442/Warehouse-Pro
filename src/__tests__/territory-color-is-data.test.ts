import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Цвет территории — данные, а не оформление.
 *
 * ── Что случилось ───────────────────────────────────────────────────────────
 *
 * В образцах цветов первым стояло `"var(--color-primary)"`, и его же брало поле
 * по умолчанию. Значение уходит на сервер и ложится в `territories.color` —
 * `varchar(7)`, с проверкой `z.string().max(7)`. Двадцать символов вместо семи:
 * сервер отклонял и создание с цветом по умолчанию, и попытку выбрать первый
 * образец. Территорию было НЕЛЬЗЯ СОЗДАТЬ ВООБЩЕ, и у арендатора Serena Trade
 * не завелось ни одной.
 *
 * Подмена литерала на переменную темы верна везде, где цвет — оформление, и
 * неверна там, где он значение. Отличать просто: уезжает в мутацию или в базу —
 * значит должен быть цветом, а не ссылкой на цвет. Разница не видна глазами
 * (образец красится правильно) и вылезает только отказом сервера.
 */
const SRC = join(process.cwd(), "src");
const PAGE = readFileSync(join(SRC, "components", "shops", "TerritoryManager.tsx"), "utf8");

/** Всё, что перечислено в PRESET_COLORS. */
function presets(): string[] {
  const at = PAGE.indexOf("const PRESET_COLORS");
  expect(at, "образцы цветов не найдены").toBeGreaterThan(0);
  const block = PAGE.slice(at, PAGE.indexOf("];", at));
  return [...block.matchAll(/"([^"]+)"/g)].map(m => m[1]);
}

describe("цвет территории влезает в базу", () => {
  const MAX = 7; // territories.color — varchar(7)

  it("каждый образец — шестизначный хекс", () => {
    for (const c of presets()) {
      expect(c, `образец «${c}» не цвет`).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(c.length, `образец «${c}» длиннее ${MAX} символов`).toBeLessThanOrEqual(MAX);
    }
  });

  it("цвет по умолчанию тоже", () => {
    // Именно он уходит на сервер, если человек ничего не выбирал, — а не
    // выбирают почти никогда.
    const m = PAGE.match(/useState\("(#[0-9a-fA-F]{6})"\);\s*\n\s*const \[newLat/);
    expect(m, "цвет по умолчанию перестал быть хексом").not.toBeNull();
  });

  it("образцов больше одного и они различаются", () => {
    // Территории различают цветом — одинаковые метки не различают ничего.
    const list = presets();
    expect(list.length).toBeGreaterThan(3);
    expect(new Set(list).size).toBe(list.length);
  });

  it("перед отправкой цвет проверяется", () => {
    /*
      Страховка от повторения: иначе человек получит отказ проверки с сервера,
      из которого не понять, при чём тут цвет.
    */
    expect(PAGE).toMatch(/HEX\s*=\s*\/\^#/);
    expect(PAGE).toContain("HEX.test(newColor)");
  });
});
