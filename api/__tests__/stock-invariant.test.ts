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
  const upd = /UPDATE\s+warehouse_stock\b([\s\S]*?)\bWHERE\b/gi;
  let m: RegExpExecArray | null;
  while ((m = upd.exec(source)) !== null) clauses.push(m[1]);

  /*
    Приход заводит строку, если её нет, — тот же остаток, другая форма записи.
    Проверять только UPDATE значило бы оставить дыру ровно там, где голый
    UPDATE однажды и не совпал ни с одной строкой: возврат принимали, с
    магазина списывали, а на склад он не попадал.
  */
  const ins = /INSERT\s+INTO\s+warehouse_stock\b[\s\S]*?\bON\s+DUPLICATE\s+KEY\s+UPDATE\b([\s\S]*?)`/gi;
  while ((m = ins.exec(source)) !== null) clauses.push(m[1]);
  return clauses;
}

/** `available = current_stock - reserved` — единственная допустимая форма. */
const DERIVED = /\bavailable\s*=\s*current_stock\s*-\s*reserved\b/i;

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
   * Двух колонок мало, пока available хранится как самостоятельное число.
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
   *
   * Прежняя редакция этой проверки требовала, чтобы ограничение было учтено с
   * обеих сторон — то есть встретилось в предложении дважды. Правило верное, но
   * оно лечило следствие: available и reserved могли разъехаться потому, что
   * из трёх колонок независимы только две, а писали все три вручную.
   *
   * Теперь available не поддерживается, а ВЫВОДИТСЯ на каждой записи, и правило
   * стало прямым: `available = current_stock - reserved` обязано быть в каждом
   * предложении, которое трогает остаток или резерв. Оно строже прежнего —
   * односторонние ограничения оно запрещает заодно, потому что разъехаться
   * выведенному значению больше негде.
   *
   * Проверяются сырые предложения: две записи двери и приход. Записи через
   * построитель drizzle — inventory в services/stock.ts и перемещение между
   * складами в warehouse-multi-router.ts — резерв не трогают вовсе и меняют
   * current_stock с available на одну и ту же величину; их держит проверка
   * выше. Свести и их к двери — отдельная работа.
   */
  it("available выводится на каждой записи, а не поддерживается вручную", () => {
    const offenders: string[] = [];

    for (const file of walkTypeScript(API_DIR)) {
      const source = readFileSync(file, "utf8");
      const rel = relative(API_DIR, file).split("\\").join("/");

      for (const clause of rawUpdateClauses(source)) {
        // Предложение, не трогающее ни остаток, ни резерв, выводить нечего.
        if (!/\b(?:current_stock|reserved)\s*=/i.test(clause)) continue;
        if (DERIVED.test(clause)) continue;
        offenders.push(`${rel} — ${clause.replace(/\s+/g, " ").trim().slice(0, 110)}`);
      }
    }

    expect(
      offenders,
      offenders.length === 0 ? "" :
        `Появилась запись в остаток, где available не выводится из двух других\n` +
        `колонок. Три числа, из которых независимы только два, разъедутся —\n` +
        `молча, и всплывёт это инвентаризацией. Пишите через дверь\n` +
        `(api/services/stock-ledger.ts). Найдено:\n` +
        offenders.map(o => `  - ${o}`).join("\n"),
    ).toEqual([]);
  });

  /**
   * Порядок присвоений в SET — несущий, а не косметика.
   *
   * MySQL вычисляет присвоения слева направо и в правых частях видит уже
   * ОБНОВЛЁННЫЕ значения предыдущих колонок.
   *
   * Раньше это было ловушкой: available правили независимо, и он обязан был
   * стоять ПЕРВЫМ, чтобы успеть прочитать старый резерв. Перестановка двух
   * строк тихо ломала деньги, а понять это по коду было нельзя — только по
   * комментарию заглавными.
   *
   * Теперь требование перевернулось и стало очевидным: available выводится,
   * значит стоит ПОСЛЕДНИМ и читает уже новые current_stock и reserved. Иначе
   * он их попросту не выведет.
   */
  it("available присваивается ПОСЛЕДНИМ — он читает уже обновлённые колонки", () => {
    const offenders: string[] = [];

    for (const file of walkTypeScript(API_DIR)) {
      const source = readFileSync(file, "utf8");
      const rel = relative(API_DIR, file).split("\\").join("/");

      for (const clause of rawUpdateClauses(source)) {
        if (!DERIVED.test(clause)) continue;
        const availableAt = clause.search(/\bavailable\s*=/i);
        const sources = [/\bcurrent_stock\s*=/i, /\breserved\s*=/i]
          .map(re => clause.search(re))
          .filter(at => at !== -1);
        if (sources.some(at => at > availableAt)) {
          offenders.push(`${rel} — available стоит раньше колонок, из которых выводится`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it("правила про available умеют падать", () => {
    // Проверка, которая не может упасть, не защищает ничего.
    const derived = "SET current_stock = current_stock + 1, reserved = GREATEST(0, reserved - 1), available = current_stock - reserved";
    const kept = "SET reserved = GREATEST(0, reserved - 1), available = available + 1";
    const swapped = "SET available = current_stock - reserved, reserved = GREATEST(0, reserved - 1)";

    expect(DERIVED.test(derived)).toBe(true);
    expect(DERIVED.test(kept), "правило пропустило самостоятельный available").toBe(false);

    const availableAt = swapped.search(/\bavailable\s*=/i);
    expect(swapped.search(/\breserved\s*=/i), "перестановка не замечена").toBeGreaterThan(availableAt);
  });
});
