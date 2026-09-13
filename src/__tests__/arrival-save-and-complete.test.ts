import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Приход: «Сохранить и завершить» и честная подпись про остаток.
 *
 * «Сохранить» заводит приход ожидающим, и остаток не меняется, пока его не
 * завершат в списке. Нигде это сказано не было — оператор искал, куда делся
 * товар. Теперь под формой подпись, а вторая кнопка делает оба шага теми же
 * двумя ручками, что и руками: arrival.create, затем arrival.update со
 * статусом completed. Новых ручек нет — страж мёртвой поверхности держит ноль.
 */
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
const strip = (code: string) =>
  code.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");

const PAGE = strip(read("src/pages/Arrivals.tsx"));

describe("форма прихода", () => {
  it("две кнопки: сохранить и сохранить-и-завершить, обе двуязычные", () => {
    expect(PAGE).toContain('{ complete: false, label: t("Сохранить", "Saqlash")');
    expect(PAGE).toContain('{ complete: true,  label: t("Сохранить и завершить", "Saqlash va yakunlash")');
    expect(PAGE, "признак завершения не доходит до onSave").toContain("}, b.complete)}");
  });

  it("завершение — тем же update({status: completed}), что и «Завершить» в списке, после create", () => {
    expect(PAGE).toMatch(/createMutation\.mutate\(d, complete \? \{ onSuccess: \(r\) => updateStatus\.mutate\(\{ id: r\.id, status: "completed" \}\) \} : undefined\)/);
  });

  it("под формой сказано, что остаток изменится после завершения", () => {
    expect(PAGE).toContain('t("Остаток на складе изменится после завершения прихода.", "Ombordagi qoldiq kelish yakunlangandan keyin o\'zgaradi.")');
  });
});
