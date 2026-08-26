import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * A stock row satisfies `current_stock = available + reserved` at all times:
 * everything on hand is either free to sell or spoken for by an open order.
 *
 * Nothing enforces that at the database level, so it survives only as long as
 * every write respects it — and the arithmetic makes that easy to check. Since
 * the three columns are linked by one equation, moving just one of them always
 * breaks it. A correct write therefore touches at least two:
 *
 *   goods arrive             current += q, available += q
 *   order reserves them      reserved += q, available -= q
 *   order ships              current -= q, reserved  -= q
 *   order is cancelled       reserved -= q, available += q
 *
 * A statement touching exactly one column is, without exception, a bug — and a
 * silent one, because the row still looks plausible afterwards. This test is
 * cheap insurance against writing that statement, in the same spirit as
 * shop-debt-invariant.test.ts: the balance-sheet bugs that actually shipped
 * were never wrong formulas, they were paths that forgot an obligation existed.
 */

const API_DIR = join(__dirname, "..");
const STOCK_COLUMNS = ["current_stock", "reserved", "available"] as const;
const STOCK_COLUMNS_CAMEL = ["currentStock", "reserved", "available"] as const;

function* walkTypeScript(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "__tests__") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walkTypeScript(full);
    else if (entry.endsWith(".ts") && !entry.endsWith(".d.ts")) yield full;
  }
}

/** The SET clause of each `UPDATE warehouse_stock ... WHERE`, raw-SQL form. */
function rawUpdateClauses(source: string): string[] {
  const clauses: string[] = [];
  const re = /UPDATE\s+warehouse_stock\b([\s\S]*?)\bWHERE\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) clauses.push(m[1]);
  return clauses;
}

/** The object literal of each `.update(warehouseStock).set({ ... })`, drizzle form. */
function builderUpdateClauses(source: string): string[] {
  const clauses: string[] = [];
  const re = /\.update\(\s*warehouseStock\s*\)[\s\S]{0,60}?\.set\(\s*\{/gi;
  while (re.exec(source) !== null) {
    // Walk from the opening brace to its match so nested sql`` templates and
    // objects don't truncate the clause early.
    let depth = 1;
    let i = re.lastIndex;
    while (i < source.length && depth > 0) {
      if (source[i] === "{") depth++;
      else if (source[i] === "}") depth--;
      i++;
    }
    clauses.push(source.slice(re.lastIndex, i));
  }
  return clauses;
}

function columnsTouched(clause: string): string[] {
  const touched = new Set<string>();
  STOCK_COLUMNS.forEach((c, idx) => {
    // `current_stock =` in SQL, or `currentStock:` in a drizzle object.
    if (new RegExp(`\\b${c}\\s*=`).test(clause)) touched.add(c);
    if (new RegExp(`\\b${STOCK_COLUMNS_CAMEL[idx]}\\s*:`).test(clause)) touched.add(c);
  });
  return [...touched];
}

describe("current_stock = available + reserved", () => {
  it("no stock update moves a single column on its own", () => {
    const offenders: string[] = [];

    for (const file of walkTypeScript(API_DIR)) {
      const source = readFileSync(file, "utf8");
      const rel = relative(API_DIR, file).split("\\").join("/");

      for (const clause of [...rawUpdateClauses(source), ...builderUpdateClauses(source)]) {
        const touched = columnsTouched(clause);
        if (touched.length === 1) {
          offenders.push(`${rel} — updates only ${touched[0]}`);
        }
      }
    }

    expect(
      offenders,
      offenders.length === 0 ? "" :
        `These statements move one stock column in isolation, which breaks\n` +
        `current_stock = available + reserved:\n` +
        offenders.map(o => `  - ${o}`).join("\n") +
        `\n\nEvery real stock movement changes at least two of the three ` +
        `columns — see the table in this test file.`,
    ).toEqual([]);
  });

  it("recognises a correct write and rejects a lone-column one", () => {
    // Guards the detector itself: a test that cannot fail protects nothing.
    const good = "SET current_stock = current_stock - 5, reserved = reserved - 5";
    const bad = "SET current_stock = current_stock - 5";

    expect(columnsTouched(good)).toHaveLength(2);
    expect(columnsTouched(bad)).toEqual(["current_stock"]);
  });

  /**
   * Двух колонок мало, если одну ограничивают, а другую нет.
   *
   * Так было в девяти местах — applyStockDelta, обе ветки курьерской доставки,
   * полный и частичный возврат, отмена, удаление заказа и повторный импорт:
   *
   *   SET reserved = GREATEST(0, reserved - q), available = available + q
   *
   * Колонки две, проверка выше довольна. Пока reserved >= q всё сходится, но
   * как только ограничение срабатывает — reserved замирает на нуле, а available
   * получает полное q. Свободный остаток становится больше физического, и
   * система разрешает продать то, чего нет. Ошибки при этом не возникает:
   * строка выглядит правдоподобной, недостача всплывает при инвентаризации.
   * Ровно это описано в комментарии courier-router.ts:331 — отказ там уже
   * видели и закрыли один частный случай, оставив причину.
   *
   * Правило: если в SET есть GREATEST или LEAST, ограниченная величина обязана
   * войти и во вторую колонку — то есть встретиться в предложении дважды.
   * Правильная парная колонка у каждой операции своя (у отгрузки одна, у
   * возврата другая, у частичного возврата третья), поэтому проверка требует
   * не конкретной формулы, а самого факта: ограничение учтено с обеих сторон.
   *
   * Число ниже — храповик, и оно должно оставаться нулём. Смысл держать его
   * переменной, а не сравнением с пустым списком: если однажды появится
   * выражение, которое иначе записать нельзя, послабление придётся выписать
   * явным числом, а не спрятать в условии.
   */
  const KNOWN_ONE_SIDED_CLAMPS = 0;

  it("ограничение снизу учтено с обеих сторон", () => {
    const offenders: string[] = [];

    for (const file of walkTypeScript(API_DIR)) {
      const source = readFileSync(file, "utf8");
      const rel = relative(API_DIR, file).split("\\").join("/");

      for (const clause of [...rawUpdateClauses(source), ...builderUpdateClauses(source)]) {
        const clamps = clause.match(/\b(?:GREATEST|LEAST)\s*\(/gi) ?? [];
        if (clamps.length === 0) continue;
        if (columnsTouched(clause).length < 2) continue; // это ловит проверка выше
        // Ограничение, применённое к одной колонке, обязано быть учтено и во
        // второй — а значит, встретиться в предложении минимум дважды.
        if (clamps.length < 2) {
          offenders.push(`${rel} — ${clause.replace(/\s+/g, " ").trim().slice(0, 110)}`);
        }
      }
    }

    expect(
      offenders.length,
      offenders.length <= KNOWN_ONE_SIDED_CLAMPS ? "" :
        `Появилось новое выражение, где ограничение (GREATEST/LEAST) наложено на\n` +
        `одну колонку остатка, а парная меняется на неограниченную величину.\n` +
        `Как только ограничение сработает, current_stock = available + reserved\n` +
        `разъедется молча. Найдено:\n` +
        offenders.map(o => `  - ${o}`).join("\n"),
    ).toBeLessThanOrEqual(KNOWN_ONE_SIDED_CLAMPS);

    // Храповик крутится только в одну сторону: починили — уменьшите число.
    expect(
      offenders.length,
      `Односторонних ограничений стало меньше (${offenders.length} вместо ` +
      `${KNOWN_ONE_SIDED_CLAMPS}) — уменьшите KNOWN_ONE_SIDED_CLAMPS, чтобы ` +
      `храповик не дал им вернуться.`,
    ).toBe(KNOWN_ONE_SIDED_CLAMPS);
  });

  /**
   * Порядок присвоений в SET — несущий, а не косметика.
   *
   * MySQL вычисляет присвоения слева направо и в правых частях видит уже
   * ОБНОВЛЁННЫЕ значения предыдущих колонок. Поэтому available, считающий
   * разницу через reserved, обязан стоять ДО reserved: иначе разница
   * посчитается от самой себя и выйдет нулём — резерв изменится, а доступный
   * остаток нет.
   */
  it("available считается раньше reserved там, где зависит от него", () => {
    const offenders: string[] = [];

    for (const file of walkTypeScript(API_DIR)) {
      const source = readFileSync(file, "utf8");
      const rel = relative(API_DIR, file).split("\\").join("/");

      for (const clause of rawUpdateClauses(source)) {
        const availableAt = clause.search(/\bavailable\s*=/i);
        const reservedAt = clause.search(/\breserved\s*=/i);
        if (availableAt === -1 || reservedAt === -1) continue;

        // Правая часть available упоминает reserved — значит зависит от него.
        const availableExpr = clause.slice(availableAt).split("\n")[0];
        if (!/\breserved\b/i.test(availableExpr)) continue;

        if (availableAt > reservedAt) {
          offenders.push(`${rel} — available присваивается после reserved, хотя зависит от него`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
