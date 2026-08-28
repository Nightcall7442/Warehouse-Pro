/**
 * Сторож общей заглушки drizzle-orm.
 *
 * ── Что случилось однажды ───────────────────────────────────────────────────
 *
 * Каждый набор тестов перечислял операторы drizzle сам, руками. В день, когда
 * роутер впервые применил `inArray`, одиннадцать тестов kpi упали с текстом
 * «No 'inArray' export is defined on the drizzle-orm mock» — дыра в стенде,
 * одетая как одиннадцать поломок продукта. Час ушёл на поиск того, чего в
 * продукте не было.
 *
 * Помощник helpers/drizzle-mock.ts свёл перечень в одно место, и в его шапке
 * написано: «drizzle-operators.test.ts падает, если api начинает импортировать
 * оператор, которого этот файл не даёт».
 *
 * Такого файла не было. Обещание в шапке ничем не подкреплялось три месяца.
 * Вот он.
 *
 * ── Что проверяется ─────────────────────────────────────────────────────────
 *
 * Каждое имя, которое продакшн-код берёт из "drizzle-orm", заглушка обязана
 * отдавать. Не совпало — падает здесь, один раз и с понятным текстом, а не
 * россыпью чужих наборов.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { drizzleMock } from "./helpers/drizzle-mock";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** Исходники, которые попадают под заглушку: api и схема базы, но не тесты. */
function* sourceFiles(dir: string): Generator<string> {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "__tests__") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* sourceFiles(full);
    else if (entry.name.endsWith(".ts")) yield full;
  }
}

/**
 * Имена из `import { … } from "drizzle-orm"`.
 *
 * Отбрасывается то, чего в рантайме не существует: `import type { … }` целиком
 * и отдельные спецификаторы с `type`. Заглушке они не нужны — их стирает
 * компилятор.
 */
const IMPORT_RE = /import\s+(type\s+)?\{([^}]*)\}\s*from\s*["']drizzle-orm["']/g;

function importedNames(): Map<string, string[]> {
  const byName = new Map<string, string[]>();
  for (const dir of ["api", "db"]) {
    for (const file of sourceFiles(path.join(ROOT, dir))) {
      const src = fs.readFileSync(file, "utf8");
      for (const m of src.matchAll(IMPORT_RE)) {
        if (m[1]) continue; // import type { … }
        for (const raw of m[2].split(",")) {
          const spec = raw.trim();
          if (!spec || spec.startsWith("type ")) continue;
          // `sql as sqlTag` — заглушке важно исходное имя.
          const name = spec.split(/\s+as\s+/)[0].trim();
          if (!name) continue;
          const where = path.relative(ROOT, file).split(path.sep).join("/");
          const seen = byName.get(name);
          if (seen) { if (!seen.includes(where)) seen.push(where); }
          else byName.set(name, [where]);
        }
      }
    }
  }
  return byName;
}

describe("заглушка drizzle-orm покрывает то, что берёт продакшн-код", () => {
  const imported = importedNames();
  const mock = drizzleMock();

  it("продакшн-код вообще что-то оттуда берёт — иначе проверка пустая", () => {
    // Без этого сломанный разбор импортов дал бы пустой список, и набор ниже
    // прошёл бы, ничего не проверив.
    expect(imported.size).toBeGreaterThan(5);
    expect([...imported.keys()]).toContain("eq");
  });

  it.each([...imported.entries()].map(([name, files]) => [name, files] as const))(
    "%s есть в заглушке",
    (name, files) => {
      expect(
        Object.prototype.hasOwnProperty.call(mock, name),
        `"${name}" берётся из drizzle-orm в ${files.slice(0, 3).join(", ")}` +
          `${files.length > 3 ? ` и ещё ${files.length - 3} файлах` : ""}, ` +
          `но helpers/drizzle-mock.ts его не отдаёт. Добавьте — иначе набор, ` +
          `который дойдёт до этого кода, упадёт с виду по вине продукта.`,
      ).toBe(true);
    },
  );
});
