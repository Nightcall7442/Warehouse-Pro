/**
 * Разбор условий WHERE для поддельной базы в тестах.
 *
 * ── Зачем он один на всех ───────────────────────────────────────────────────
 *
 * В тестах эта функция была скопирована в три с лишним десятка файлов, и в
 * каждой копии заканчивалась одинаково:
 *
 *     return true;   // всё, чего не поняли
 *
 * Понимали при этом не всё. `eq` и `and` знали все копии, `inArray` — меньше
 * половины, `isNull` — пять файлов из тридцати шести. Значит в остальных
 * `isNull(orders.deletedAt)` считался выполненным всегда: удалённые заказы
 * попадали в выборку, а тест этого не замечал. Убери такой фильтр из
 * продакшена — тест останется зелёным.
 *
 * Это худший вид неверного теста. Он не падает ложно, он молча подтверждает.
 * Сегодня мы правили выручку, считавшуюся по удалённым заказам, и долг,
 * вычитавший возвраты по ним же, — ни одну из этих ошибок стенд поймать не мог.
 *
 * ── Что здесь сделано иначе ─────────────────────────────────────────────────
 *
 * Неизвестное условие бросает исключение. Тест, где встретилось непонятое
 * условие, обязан упасть с внятным текстом, а не притвориться пройденным:
 * «стенд этого не умеет» — это состояние стенда, а не свойство проверяемого
 * кода, и молчать о нём нельзя.
 *
 * Сырой sql`` — отдельный случай. Разобрать произвольный SQL здесь невозможно,
 * поэтому он тоже ошибка — если тест явно не передал обработчик. Так решение
 * «мы сознательно считаем это условие выполненным» становится видимой строкой
 * в конкретном тесте, а не общим умолчанием, о котором никто не помнит.
 */

export class UnsupportedCondition extends Error {
  constructor(kind: string, detail?: string) {
    super(
      `Поддельная база не умеет разбирать условие «${kind}»${detail ? `: ${detail}` : ""}.\n` +
      `Добавьте его поддержку в api/__tests__/helpers/fake-conditions.ts либо передайте обработчик.\n` +
      `Считать непонятое условие выполненным нельзя: тест станет подтверждать что угодно.`,
    );
    this.name = "UnsupportedCondition";
  }
}

type Row = Record<string, unknown>;
type Cond = Record<string, unknown> | null | undefined;

export interface EvaluatorOptions {
  /**
   * Как превратить объект колонки в имя поля поддельной строки.
   *
   * Обычно это карта, собранная из схемы: `Object.entries(orders)` даёт пары
   * «имя поля → объект колонки».
   */
  fieldOf: (col: unknown) => string | undefined;

  /**
   * Как понимать сырой sql``. Не передан — любое такое условие станет ошибкой.
   *
   * Возврат `true` здесь — осознанное «в этом тесте условие не важно», и
   * написано оно будет в самом тесте, где его видно при чтении.
   */
  rawSql?: (cond: Row, row: Row) => boolean;
}

/**
 * Значения из БД приходят строками, и сравнивать их надо так же нестрого, как
 * это делает MySQL.
 *
 * Сравнения по тексту здесь мало: DECIMAL отдаётся как «10.00», а в условии
 * стоит число 10 — как строки они не равны, хотя это одно значение. Поэтому
 * когда обе стороны читаются как числа, сравниваются числа.
 *
 * Пустая строка исключена намеренно: Number("") даёт 0, и без этой оговорки
 * незаполненное поле совпало бы с нулём.
 */
function looseEquals(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (a !== "" && b !== "") {
    const na = Number(a), nb = Number(b);
    if (Number.isFinite(na) && Number.isFinite(nb)) return na === nb;
  }
  return String(a) === String(b);
}

function compare(a: unknown, b: unknown): number {
  const na = Number(a), nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
  const sa = a instanceof Date ? a.getTime() : String(a);
  const sb = b instanceof Date ? b.getTime() : String(b);
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

/** LIKE с % и _ — тот же смысл, что в SQL. */
function likeMatches(value: unknown, pattern: unknown): boolean {
  const escaped = String(pattern)
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/%/g, ".*")
    .replace(/_/g, ".");
  return new RegExp(`^${escaped}$`, "i").test(String(value ?? ""));
}

export function makeConditionEvaluator(options: EvaluatorOptions) {
  const valueOf = (row: Row, col: unknown): unknown => {
    const field = options.fieldOf(col);
    if (field === undefined) {
      const name = (col as { name?: string } | null)?.name;
      throw new UnsupportedCondition("колонка", `неизвестная колонка${name ? ` «${name}»` : ""}`);
    }
    return row[field];
  };

  /**
   * Строка и условие принимаются как unknown намеренно.
   *
   * В тестах, которые предстоит перевести, подпись этой функции написана шестью
   * разными способами — от `row: any` до `row: FakeRow`. Требовать здесь точный
   * тип значило бы править ещё и подписи, превращая перевод файла в правку
   * типов вместо правки смысла.
   */
  function evaluate(rowInput: unknown, condInput: unknown): boolean {
    const row = (rowInput ?? {}) as Row;
    const cond = condInput as Cond;
    // Отсутствие условия — это «без WHERE», и оно действительно верно для всех
    // строк. Единственный случай, где «да» безопасно.
    if (cond == null) return true;
    if (typeof cond !== "object") {
      throw new UnsupportedCondition(typeof cond, "условие не является объектом");
    }

    const kind = cond.__kind as string | undefined;
    if (kind === undefined) {
      throw new UnsupportedCondition("без вида", "у объекта условия нет поля __kind");
    }

    switch (kind) {
      case "and": return (cond.conds as Cond[]).every(c => evaluate(row, c));
      case "or":  return (cond.conds as Cond[]).some(c => evaluate(row, c));
      case "not": return !evaluate(row, cond.cond as Cond);

      case "eq": return looseEquals(valueOf(row, cond.col), cond.val);
      case "ne": return !looseEquals(valueOf(row, cond.col), cond.val);

      case "gt":  return compare(valueOf(row, cond.col), cond.val) > 0;
      case "gte": return compare(valueOf(row, cond.col), cond.val) >= 0;
      case "lt":  return compare(valueOf(row, cond.col), cond.val) < 0;
      case "lte": return compare(valueOf(row, cond.col), cond.val) <= 0;

      // NULL и undefined в поддельной строке — одно и то же: колонка пуста.
      case "isNull":    return valueOf(row, cond.col) == null;
      case "isNotNull": return valueOf(row, cond.col) != null;

      case "inArray":
        return (cond.values as unknown[]).some(v => looseEquals(valueOf(row, cond.col), v));
      case "notInArray":
        return !(cond.values as unknown[]).some(v => looseEquals(valueOf(row, cond.col), v));

      case "like":    return likeMatches(valueOf(row, cond.col), cond.val);
      case "notLike": return !likeMatches(valueOf(row, cond.col), cond.val);

      case "between":
        return compare(valueOf(row, cond.col), cond.min) >= 0
            && compare(valueOf(row, cond.col), cond.max) <= 0;

      case "sql":
      case "sql.join": {
        if (!options.rawSql) {
          const text = Array.isArray(cond.strings) ? (cond.strings as string[]).join("?").trim() : "";
          throw new UnsupportedCondition("sql``", text.slice(0, 120) || "без текста");
        }
        return options.rawSql(cond, row);
      }

      default:
        throw new UnsupportedCondition(kind);
    }
  }

  return evaluate;
}
