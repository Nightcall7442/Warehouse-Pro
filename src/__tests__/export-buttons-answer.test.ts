/**
 * Кнопка выгрузки отвечает всегда: файлом или словами.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * В самой выгрузке проверка есть и работает: пустой набор она называет отказом
 * — «Нет данных для выгрузки», — и заведена была ровно потому, что тихий выход
 * неотличим от сломанной кнопки.
 *
 * Но до неё дело не доходило. Восемь мест вызова прикрывались своим условием:
 *
 *     onClick={async () => stock && await exportToExcel(...)}
 *     onClick={async () => data?.data && await exportToExcel(...)}
 *     if (!allProds.length) return;
 *
 * При отсутствующих данных не вызывалось НИЧЕГО, и человек получал ровно то,
 * ради чего проверку добавляли: нажатие без ответа. Условие в обработчике
 * отменяло объяснение, написанное одним уровнем ниже.
 *
 * ── Почему правило, а не восемь правок ──────────────────────────────────────
 *
 * Потому что писать `data && export(...)` — естественное движение руки: так
 * TypeScript перестаёт ругаться на возможный undefined. Девятая кнопка
 * появится с тем же условием.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const SRC = join(__dirname, "..");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "__tests__") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

const FILES = walk(SRC)
  .map(f => ({ rel: relative(SRC, f).replace(/\\/g, "/"), text: readFileSync(f, "utf8") }))
  // Сами выгрузки — то место, где отказ и произносится; правило про их
  // вызывающих.
  .filter(f => f.rel !== "lib/excel.ts" && f.rel !== "lib/export.ts");

describe("выгрузка не отменяется условием у вызывающего", () => {
  it("такие вызовы в приложении есть", () => {
    // Иначе правило ниже прошло бы на пустом списке и ничего не значило.
    const callers = FILES.filter(f => /exportToExcel\(/.test(f.text)).length;
    expect(callers, "вызовов выгрузки не найдено вовсе").toBeGreaterThanOrEqual(8);
  });

  it("перед вызовом не стоит условие, глотающее нажатие", () => {
    /*
      Ищется `<что-то> && exportToExcel(` — то есть вызов, который при пустых
      данных просто не случится. Правильная запись отдаёт пустой набор
      выгрузке: `exportToExcel(format(rows ?? []), …)`.
    */
    const offenders: string[] = [];
    for (const { rel, text } of FILES) {
      const code = text
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^[ \t]*\/\/.*$/gm, "");
      for (const m of code.matchAll(/&&\s*(await\s+)?exportToExcel\(/g)) {
        const at = code.slice(Math.max(0, m.index - 70), m.index + 20).replace(/\s+/g, " ");
        offenders.push(`${rel}: …${at}`);
      }
    }
    expect(
      offenders,
      "нажатие не даст ни файла, ни объяснения — отдайте пустой набор самой " +
      "выгрузке, она называет его отказом:\n" + offenders.join("\n"),
    ).toEqual([]);
  });

  it("обе выгрузки отвечают на пустой набор и на отказ сборки", () => {
    /*
      Правило выше опирается на то, что отвечает сама выгрузка. Если ответ
      оттуда уберут, оно начнёт разрешать ровно ту беду, ради которой
      написано.
    */
    const excel = readFileSync(join(SRC, "lib", "excel.ts"), "utf8");
    const exp = readFileSync(join(SRC, "lib", "export.ts"), "utf8");

    for (const [name, text] of [["lib/excel.ts", excel], ["lib/export.ts", exp]] as const) {
      expect(text, `${name}: пустой набор проходит молча`).toMatch(/notify\.info\(/);
      expect(text, `${name}: отказ сборки уходит в консоль`).toMatch(/catch[\s\S]{0,120}notify\.error\(/);
    }
  });
});
