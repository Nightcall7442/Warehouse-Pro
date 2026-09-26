import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Приход: «Сохранить и завершить» и честная подпись про остаток.
 *
 * «Сохранить» заводит приход ожидающим, и остаток не меняется, пока его не
 * завершат. Вторая кнопка делает оба шага теми же двумя ручками, что и
 * руками: arrival.create, затем arrival.update со статусом completed.
 * Сохранённый приход открывается документом (/arrivals/:id), а не окном.
 */
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
const strip = (code: string) =>
  code.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");

const PAGE = strip(read("src/pages/ArrivalEditor.tsx"));

describe("новый приход", () => {
  it("две кнопки: сохранить и сохранить-и-завершить, обе двуязычные", () => {
    expect(PAGE).toContain('onClick={() => void saveNew(false)}');
    expect(PAGE).toContain('onClick={() => void saveNew(true)}');
    expect(PAGE).toContain('t("Сохранить", "Saqlash")');
    expect(PAGE).toContain('t("Сохранить и завершить", "Saqlash va yakunlash")');
  });

  it("завершение — тем же update({status: completed}) после create, затем в документ", () => {
    const at = PAGE.indexOf("const saveNew = async");
    const body = PAGE.slice(at, PAGE.indexOf("const saveDoc = async"));
    expect(body).toContain("await createMutation.mutateAsync(");
    expect(body).toContain('if (complete) await updateStatus.mutateAsync({ id: r.id, status: "completed" });');
    expect(body.indexOf("createMutation.mutateAsync")).toBeLessThan(body.indexOf('status: "completed"'));
    expect(body).toContain("navigate(`/arrivals/${r.id}`, { replace: true });");
  });

  it("под кнопками сказано, что остаток изменится после завершения", () => {
    expect(PAGE).toContain('t("Остаток на складе изменится после завершения прихода.", "Ombordagi qoldiq kelish yakunlangandan keyin o\'zgaradi.")');
  });

  it("список ведёт на страницу, а не в окно", () => {
    const list = strip(read("src/pages/Arrivals.tsx"));
    expect(list).toContain('onClick={() => navigate("/arrivals/new")}');
    expect(list).toContain("onClick={() => navigate(`/arrivals/${a.id}`)}");
    expect(list).not.toContain("ArrivalForm");
    expect(list).not.toContain("createPortal");
    expect(read("src/App.tsx")).toContain('<Route path="/arrivals/:id"   element={<RoleGuard roles={["ceo","operator"]}><ArrivalEditor /></RoleGuard>} />');
  });
});

describe("документ: «Завершить» без посчитанного", () => {
  it("ничего не посчитано — сразу говорит, до подтверждения «поступит 0 ед.»", () => {
    const at = PAGE.indexOf("const complete = async");
    const body = PAGE.slice(at, PAGE.indexOf("await confirm(", at));
    expect(at, "нет complete()").toBeGreaterThan(0);
    expect(body).toContain("if (sum.units === 0) { notify.error(t(\"Ничего не посчитано: впишите «Пришло» хотя бы в одну строку\", \"Hech narsa sanalmagan: kamida bitta qatorga «Keldi» ni yozing\")); return; }");
  });
});
