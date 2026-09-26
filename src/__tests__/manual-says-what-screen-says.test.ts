import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Справка называет то, что на экране, — слово в слово.
 *
 * Разбор 26.09.2026 нашёл два расхождения:
 *   · совет о черновике прихода звал нажать «Отменить набранное», а такой
 *     кнопки нет: внизу «Отмена», а «Отменить набранное?» — заголовок окна;
 *   · рисунок «Нормы» супервайзера описывал пустой экран с подсказкой
 *     «создайте нормы», а засев с f0d713ca ставит нормы — подсказки на снимке
 *     нет, выноска молча пропала, подпись врала.
 *
 * Нарочная поломка: верни в совет «Отменить набранное» — падает первый;
 * верни рисунку подпись «пока норм нет» или метку emptyHint — второй.
 */
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
const lines = read("scripts/manual_content.py").split("\n");

describe("справка и экраны", () => {
  it("черновик прихода: каждая кнопка и окно из совета есть в редакторе", () => {
    const tip = lines.find(l => l.includes("держится черновиком"));
    expect(tip, "совет о черновике прихода пропал").toBeTruthy();
    const [, ru, uz] = /T\("([^"]*)", "([^"]*)"\)/.exec(tip!)!;
    const quoted = (s: string) => [...s.matchAll(/«([^»]+)»/g)].map(m => m[1]);
    // Подписи после «…вернётся.» — то, что человек ищет, чтобы стереть черновик.
    const ruLabels = quoted(ru.slice(ru.indexOf("вернётся.")));
    const uzLabels = quoted(uz.slice(uz.indexOf("qaytadi.")));
    expect(ruLabels.length).toBeGreaterThanOrEqual(2);
    expect(uzLabels.length).toBe(ruLabels.length);

    const editor = read("src/pages/ArrivalEditor.tsx");
    for (const l of ruLabels) expect(editor, `в редакторе нет подписи «${l}»`).toContain(`t("${l}", "`);
    for (const l of uzLabels) expect(editor, `в редакторе нет подписи «${l}»`).toContain(`, "${l}")`);
  });

  it("«Нормы» супервайзера сняты с нормами — и описаны с нормами", () => {
    // Засев ставит нормы каждому агенту с выручкой — пустого экрана на снимке нет.
    expect(read("db/seed.ts")).toMatch(/db\.insert\(schema\.salesTargets\)/);

    const at = lines.findIndex(l => l.includes('"fig": ("mobile", "supervisor", "targets")'));
    expect(at, "рисунок «Нормы» супервайзера пропал").toBeGreaterThan(-1);
    const fig = lines[at] + lines[at + 1];
    expect(fig, "подпись описывает пустой экран").not.toMatch(/норм нет|yo'q ekan|Создайте нормы/);

    const marks = (JSON.parse(read("scripts/screenshot-marks.json")) as Record<string, Record<string, Record<string, [string, string][]>>>)
      .mobile.supervisor.targets;
    expect(marks.map(m => m[1]).join("\n"), "метка ищет подсказку пустого экрана").not.toMatch(/Создайте нормы/);
    // Карточка агента — строка «План: <сумма>»; плитка итогов «План» без двоеточия не подходит.
    expect(marks).toContainEqual(["normCard", "text=/^(План|Reja): / >> nth=0"]);
    expect(fig).toContain('"callouts": [["normCard", T(');
  });
});
