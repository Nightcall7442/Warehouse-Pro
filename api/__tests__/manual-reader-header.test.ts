import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Шапка читалки руководства — /manual/.
 *
 * Два дефекта, которые владелец увидел на экране:
 *
 *   · фишки ролей показывались НА ОБОИХ языках сразу — двенадцать вместо
 *     шести, и ряд уезжал под поиск. Причина: обёртка языка несла
 *     display:contents инлайном, а инлайновый стиль перебивает общее правило
 *     [data-lang]{display:none};
 *   · из руководства некуда было вернуться в программу — только адресной
 *     строкой;
 *   · «справка только на русском»: кнопки RU/UZ несли тот же data-lang, что и
 *     текст, и общее правило прятало кнопку чужого языка — переключиться
 *     было некуда. У кнопок свой атрибут data-pick, правило их не касается.
 *
 * Проверяются оба файла: собранный docs/manual/index.html (его и отдаёт
 * сервер) и сборщик scripts/build_manual.py (иначе следующая сборка со
 * снимками вернула бы всё назад).
 */
const read = (p: string) => readFileSync(path.resolve(process.cwd(), p), "utf8");
const FILES = { "docs/manual/index.html": read("docs/manual/index.html"), "scripts/build_manual.py": read("scripts/build_manual.py") };
const READER = { "docs/manual/reader.js": read("docs/manual/reader.js"), "scripts/build_manual.py": FILES["scripts/build_manual.py"] };

describe("фишки ролей — на одном языке", () => {
  for (const [name, src] of Object.entries(FILES)) {
    it(`${name}: обёртка языка без инлайнового display:contents`, () => {
      expect(src, "инлайновый стиль снова перебивает скрытие чужого языка")
        .not.toMatch(/data-lang=['"](ru|uz|\{l\})['"]\s+style=['"]display:contents/);
    });

    it(`${name}: текущий язык растворяется в ряду, чужой скрыт`, () => {
      expect(src).toContain('html[data-ui="ru"] .chips > [data-lang="ru"], html[data-ui="uz"] .chips > [data-lang="uz"] { display:contents; }');
      expect(src).toContain(".chips > [data-lang] { display:none; }");
    });
  }

  it("в собранной читалке ровно по шесть фишек на язык", () => {
    const html = FILES["docs/manual/index.html"];
    const chips = html.match(/<nav class='chips'>[\s\S]*?<\/nav>/)?.[0] ?? "";
    expect(chips, "ряда фишек нет").not.toBe("");
    const ru = chips.match(/<span data-lang='ru'>((?:<button[^>]*>[^<]*<\/button>)+)<\/span>/)?.[1] ?? "";
    const uz = chips.match(/<span data-lang='uz'>((?:<button[^>]*>[^<]*<\/button>)+)<\/span>/)?.[1] ?? "";
    expect((ru.match(/<button/g) ?? []).length, "русских фишек не шесть").toBe(6);
    expect((uz.match(/<button/g) ?? []).length, "узбекских фишек не шесть").toBe(6);
  });
});

describe("кнопка «В программу»", () => {
  for (const [name, src] of Object.entries(FILES)) {
    it(`${name}: ссылка в корень приложения, первой в шапке, на обоих языках`, () => {
      const head = src.match(/<header class='top'>([\s\S]*?)<\/header>/)?.[1] ?? "";
      expect(head, "шапки нет").not.toBe("");
      const back = head.match(/<a class='back' href='\/'>[\s\S]*?<\/a>/)?.[0] ?? "";
      expect(back, "кнопки назад нет или она ведёт не в корень").not.toBe("");
      expect(back).toContain("<span data-lang='ru'>В программу</span>");
      expect(back).toContain("<span data-lang='uz'>Dasturga</span>");
      // Первой: слева, где её ищет рука. Меню и логотип — после.
      expect(head.indexOf("<a class='back'"), "кнопка назад не первая в шапке").toBeLessThan(head.indexOf("<button class='menu-btn'"));
    });
  }

  it("на телефоне остаётся стрелка — текст прячется вместе с подписью логотипа", () => {
    for (const src of Object.values(FILES)) {
      const mobile = src.match(/@media \(max-width: 900px\) \{([\s\S]*?)\n\}/)?.[1] ?? "";
      expect(mobile).toContain(".back span { display:none; }");
    }
  });
});

describe("ряд помещается", () => {
  it("полоса прокрутки у фишек не скрыта — уехавшая фишка не выглядит обрезанной", () => {
    for (const src of Object.values(FILES)) {
      expect(src).not.toMatch(/\.chips \{[^}]*scrollbar-width:none/);
      expect(src).not.toContain(".chips::-webkit-scrollbar { display:none; }");
    }
  });

  it("на ноутбуке фишки ужимаются, а подпись логотипа прячется", () => {
    for (const src of Object.values(FILES)) {
      const laptop = src.match(/@media \(max-width: 1500px\) \{([\s\S]*?)\n\}/)?.[1] ?? "";
      expect(laptop, "правила для ноутбука нет").not.toBe("");
      expect(laptop).toContain(".top .brand span { display:none; }");
      expect(laptop).toContain(".chips .lbl { display:none; }");
      expect(laptop).toMatch(/\.chips button \{ font-size:12px/);
    }
  });
});

describe("переключатель RU/UZ виден на любом языке", () => {
  for (const [name, src] of Object.entries(FILES)) {
    it(`${name}: две кнопки, и ни одна не помечена data-lang`, () => {
      const toggle = src.match(/<div class='lang'>([\s\S]*?)<\/div>/)?.[1] ?? "";
      expect(toggle, "переключателя языка нет").not.toBe("");
      expect(toggle.match(/<button/g) ?? [], "кнопок должно быть две").toHaveLength(2);
      // data-lang на кнопке = её спрячет [data-lang]{display:none} в чужом языке.
      expect(toggle, "кнопка языка снова несёт data-lang").not.toMatch(/data-lang=/);
      expect(toggle).toContain("data-pick='ru'");
      expect(toggle).toContain("data-pick='uz'");
    });
  }

  for (const [name, src] of Object.entries(READER)) {
    it(`${name}: читалка подсвечивает и переключает по data-pick`, () => {
      const handlers = src.match(/querySelectorAll\("\.lang button"\)[^\n]*/g) ?? [];
      expect(handlers.length, "обработчиков кнопок языка должно быть два: подсветка и клик").toBe(2);
      for (const h of handlers) {
        expect(h).toContain("dataset.pick");
        expect(h).not.toContain("dataset.lang");
      }
    });
  }
});
