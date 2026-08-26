import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Статические стражи страницы настроек.
 *
 * Проверять глазами вёрстку каждого из семи разделов никто не будет, а
 * расходится она незаметно: где-то подпись 10px капсом, где-то эмодзи вместо
 * иконки, где-то кнопка на 26 пикселей. Именно из таких мелочей и складывалось
 * ощущение дешёвой страницы — ни одна по отдельности не выглядит поломкой.
 *
 * Проверки статические, потому что ловят они не поведение, а привычку.
 */

const SETTINGS_DIR = join(__dirname, "..", "components", "settings");
const PAGE = join(__dirname, "..", "pages", "Settings.tsx");

/**
 * Комментарии вырезаются, а нумерация строк сохраняется.
 *
 * Иначе страж ловит сам себя: в этих файлах прошлые ошибки описаны словами, и
 * «☀️» или «ЛОГОТИП КОМПАНИИ» встречаются в объяснении, почему так больше не
 * делают.
 */
const BLOCK_COMMENT = /\/\*[\s\S]*?\*\//g;
const LINE_COMMENT = /(^|[^:])\/\/.*$/gm;

function stripComments(text: string): string {
  return text
    // Блок заменяется пробелами, а переводы строк сохраняются — иначе съедут
    // номера строк, а они и есть половина пользы от сообщения об ошибке.
    .replace(BLOCK_COMMENT, m => m.replace(/[^\n]/g, " "))
    .replace(LINE_COMMENT, (_m, before) => before);
}

function settingsSources(): Array<{ name: string; text: string }> {
  const files = readdirSync(SETTINGS_DIR)
    .filter(f => f.endsWith(".tsx"))
    .map(f => ({ name: `components/settings/${f}`, text: stripComments(readFileSync(join(SETTINGS_DIR, f), "utf8")) }));
  files.push({ name: "pages/Settings.tsx", text: stripComments(readFileSync(PAGE, "utf8")) });
  return files;
}

/** Эмодзи-пиктограммы: солнце, луна, флаги, галочки — всё, что подменяет иконку. */
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F1E6}-\u{1F1FF}]/u;

describe("настройки: иконография", () => {
  it("иконки — только lucide, без эмодзи и текстовых галочек", () => {
    const offenders: string[] = [];

    for (const { name, text } of settingsSources()) {
      text.split("\n").forEach((line, i) => {
        // Комментарии описывают прошлые ошибки и сами эмодзи упоминают.
        const code = line.replace(/\/\/.*$/, "").replace(/\/\*.*?\*\//g, "");
        if (code.trimStart().startsWith("*")) return;
        if (EMOJI.test(code)) offenders.push(`${name}:${i + 1} — ${line.trim().slice(0, 80)}`);
        if (/["'>]\s*[✓✗✔✘×]\s*["'<]/.test(code)) offenders.push(`${name}:${i + 1} — галочка текстом: ${line.trim().slice(0, 80)}`);
      });
    }

    expect(offenders, offenders.length === 0 ? "" :
      "Эмодзи и текстовые символы вместо иконок:\n" + offenders.map(o => "  - " + o).join("\n") +
      "\n\nОни рисуются системным шрифтом: другой кегль, другой вес, на Windows флаги вовсе " +
      "показываются двумя буквами. Берите иконку из lucide-react.").toEqual([]);
  });
});

describe("настройки: подписи полей", () => {
  it("нет подписей в 10 пикселей с разрядкой", () => {
    // 10px + tracking-wider + верхний регистр на тёмном фоне — контраст ниже
    // нормы и вид служебного шума. Общий стиль подписи — в components/settings/ui.tsx.
    const offenders: string[] = [];
    for (const { name, text } of settingsSources()) {
      if (name.endsWith("ui.tsx")) continue;
      text.split("\n").forEach((line, i) => {
        if (/text-\[10px\][^"]*tracking-wider|tracking-wider[^"]*text-\[10px\]/.test(line)) {
          offenders.push(`${name}:${i + 1}`);
        }
      });
    }
    expect(offenders, offenders.length === 0 ? "" :
      "Подписи 10px с разрядкой:\n" + offenders.map(o => "  - " + o).join("\n") +
      "\n\nИспользуйте Field из components/settings/ui.tsx.").toEqual([]);
  });

  it("верхний регистр не зашит в строковые литералы", () => {
    // «ЛОГОТИП КОМПАНИИ» в тексте нельзя ни перевести аккуратно, ни озвучить
    // скринридером — тот читает капс по буквам.
    const offenders: string[] = [];
    const shouty = /["'`]([А-ЯЁ]{4,}(?:\s+[А-ЯЁ]{2,})*)["'`]/;
    for (const { name, text } of settingsSources()) {
      text.split("\n").forEach((line, i) => {
        const code = line.replace(/\/\/.*$/, "");
        if (code.trimStart().startsWith("*")) return;
        const m = shouty.exec(code);
        if (m) offenders.push(`${name}:${i + 1} — ${m[1]}`);
      });
    }
    expect(offenders, offenders.length === 0 ? "" :
      "Текст набран капсом в коде:\n" + offenders.map(o => "  - " + o).join("\n")).toEqual([]);
  });
});

describe("настройки: поверхности", () => {
  it("разделы не вкладывают карточку в карточку", () => {
    // Страница сама лежит в .neo-card. Ещё одна внутри давала четыре уровня
    // поверхности, из которых четвёртый по фону совпадал с первым.
    const offenders: string[] = [];
    for (const { name, text } of settingsSources()) {
      if (name === "pages/Settings.tsx") continue;
      text.split("\n").forEach((line, i) => {
        const code = line.replace(/\/\/.*$/, "");
        if (code.trimStart().startsWith("*")) return;
        if (/className="[^"]*\bneo-card\b/.test(code)) offenders.push(`${name}:${i + 1}`);
      });
    }
    expect(offenders, offenders.length === 0 ? "" :
      "Карточка внутри карточки:\n" + offenders.map(o => "  - " + o).join("\n") +
      "\n\nРазделяйте группы через FieldGroup из components/settings/ui.tsx.").toEqual([]);
  });

  it("сетки полей не считают перелом от ширины окна", () => {
    // sm:grid-cols-2 внутри узкой колонки: на окне 768 поле выходило 96px.
    const offenders: string[] = [];
    for (const { name, text } of settingsSources()) {
      if (name.endsWith("ui.tsx")) continue;
      text.split("\n").forEach((line, i) => {
        if (/\bsm:grid-cols-[23]\b|\blg:grid-cols-2\b/.test(line)) offenders.push(`${name}:${i + 1}`);
      });
    }
    expect(offenders, offenders.length === 0 ? "" :
      "Сетка от ширины окна внутри узкого контейнера:\n" + offenders.map(o => "  - " + o).join("\n") +
      "\n\nFieldRow или grid-cols-[repeat(auto-fit,minmax(...,1fr))].").toEqual([]);
  });
});

describe("настройки: доступность и размеры", () => {
  it("иконочные кнопки имеют доступное имя", () => {
    const offenders: string[] = [];
    for (const { name, text } of settingsSources()) {
      // Кнопка, у которой между тегами только иконка, без текста и без aria-label.
      const re = /<button([^>]*)>\s*\n?\s*<[A-Z]\w+ size=\{\d+\}[^/]*\/>\s*\n?\s*<\/button>/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        if (!/aria-label/.test(m[1])) {
          const line = text.slice(0, m.index).split("\n").length;
          offenders.push(`${name}:${line}`);
        }
      }
    }
    expect(offenders, offenders.length === 0 ? "" :
      "Кнопка из одной иконки без aria-label:\n" + offenders.map(o => "  - " + o).join("\n")).toEqual([]);
  });

  it("страж сам ловит то, ради чего написан", () => {
    // Проверка, которая не может упасть, ничего не бережёт.
    expect(EMOJI.test("☀️ Светлая")).toBe(true);
    expect(EMOJI.test("🇷🇺 Русский")).toBe(true);
    expect(EMOJI.test("Светлая")).toBe(false);
    expect(/["'>]\s*[✓✗✔✘×]\s*["'<]/.test('{ok ? "✓" : "✗"}')).toBe(true);
  });
});
