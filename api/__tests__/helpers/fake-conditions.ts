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

  /**
   * Считать условие выполненным, если поддельная строка не содержит колонку.
   *
   * Это вторая разрешающая уловка прежних копий: `if (!(field in row)) return
   * true`. Смысл тот же — фильтр по колонке, которую стенд не моделирует,
   * молча проходит. Строка без deleted_at пройдёт любой фильтр по удалённым.
   *
   * Снимать её надо файл за файлом: у многих стендов строки описаны частично,
   * и строгий режим уронит их пачкой, причём каждое падение придётся
   * разбирать — это пробел стенда или настоящая ошибка в продукте.
   *
   * Поэтому здесь она не умолчание, а явный флаг: виден при чтении файла, его
   * можно посчитать и сокращать. По умолчанию выключен.
   */
  treatMissingColumnAsMatch?: boolean;
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
  /**
   * Значения списка для inArray.
   *
   * Моки называют его по-разному: `values` в одних файлах, `vals` в других.
   * Оба варианта настоящие — это самодельные моки drizzle, и требовать от них
   * единого имени значило бы править тридцать пять файлов ради одного слова.
   */
  const listOf = (cond: Row): unknown[] => {
    const list = (cond.values ?? cond.vals) as unknown[] | undefined;
    if (!Array.isArray(list)) {
      throw new UnsupportedCondition("inArray", "у условия нет списка значений (values или vals)");
    }
    return list;
  };

  /** Отсутствие колонки в строке — особый случай, а не обычное значение. */
  const MISSING = Symbol("missing column");

  const valueOf = (row: Row, col: unknown): unknown => {
    const field = options.fieldOf(col);
    if (field === undefined) {
      const name = (col as { name?: string } | null)?.name;
      throw new UnsupportedCondition("колонка", `неизвестная колонка${name ? ` «${name}»` : ""}`);
    }
    if (!(field in row)) {
      if (options.treatMissingColumnAsMatch) return MISSING;
      throw new UnsupportedCondition(
        "колонка",
        `строка стенда не содержит «${field}» — фильтр по ней ничего не проверит`,
      );
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

    // Отсутствующая колонка при включённом флаге означает «условие не
    // проверяем». Решение принимается один раз здесь, а не в каждой ветке:
    // забыть его в одной означало бы получить произвольный результат вместо
    // честного «пропущено».
    const missing = (v: unknown) => v === MISSING;

    switch (kind) {
      case "and": return (cond.conds as Cond[]).every(c => evaluate(row, c));
      case "or":  return (cond.conds as Cond[]).some(c => evaluate(row, c));
      case "not": return !evaluate(row, cond.cond as Cond);

      case "eq": { const v = valueOf(row, cond.col); return missing(v) || looseEquals(v, cond.val); }
      case "ne": { const v = valueOf(row, cond.col); return missing(v) || !looseEquals(v, cond.val); }

      case "gt":  { const v = valueOf(row, cond.col); return missing(v) || compare(v, cond.val) > 0; }
      case "gte": { const v = valueOf(row, cond.col); return missing(v) || compare(v, cond.val) >= 0; }
      case "lt":  { const v = valueOf(row, cond.col); return missing(v) || compare(v, cond.val) < 0; }
      case "lte": { const v = valueOf(row, cond.col); return missing(v) || compare(v, cond.val) <= 0; }

      // NULL и undefined в поддельной строке — одно и то же: колонка пуста.
      case "isNull":    { const v = valueOf(row, cond.col); return missing(v) || v == null; }
      case "isNotNull": { const v = valueOf(row, cond.col); return missing(v) || v != null; }

      case "inArray": {
        const v = valueOf(row, cond.col);
        return missing(v) || listOf(cond).some(x => looseEquals(v, x));
      }
      case "notInArray": {
        const v = valueOf(row, cond.col);
        return missing(v) || !listOf(cond).some(x => looseEquals(v, x));
      }

      case "like":    { const v = valueOf(row, cond.col); return missing(v) || likeMatches(v, cond.val); }
      case "notLike": { const v = valueOf(row, cond.col); return missing(v) || !likeMatches(v, cond.val); }

      case "between": {
        const v = valueOf(row, cond.col);
        return missing(v) || (compare(v, cond.min) >= 0 && compare(v, cond.max) <= 0);
      }

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
