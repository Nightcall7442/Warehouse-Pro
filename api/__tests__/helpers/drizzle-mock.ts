/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * A complete stand-in for the operators the api imports from `drizzle-orm`.
 *
 * Each test file used to hand-list the operators it happened to need, so the
 * day a router started using `inArray` eleven kpi tests failed with
 * "No 'inArray' export is defined on the drizzle-orm mock" — a test-harness gap
 * dressed up as eleven product failures. Listing the operators once, here,
 * means a new operator in production code no longer breaks unrelated suites.
 * `drizzle-operators.test.ts` fails if the api starts importing one this file
 * does not provide.
 *
 * Operators return plain `{ __kind, … }` markers rather than real SQL: the
 * fake `execute`/`select` implementations in the suites read those markers to
 * decide which rows to hand back.
 */

type Col = unknown;
type Val = unknown;

/** Comparison operators — all share the (column, value) shape. */
const BINARY = ["eq", "ne", "gt", "gte", "lt", "lte", "like", "ilike", "notLike"] as const;

/** Operators over a column alone. */
const UNARY = ["isNull", "isNotNull", "desc", "asc", "count", "sum", "avg", "min", "max"] as const;

/** Operators that take a variable number of conditions. */
const VARIADIC = ["and", "or", "not"] as const;

export type DrizzleMock = Record<string, unknown>;

/**
 * Builds the mock module. Pass `overrides` when a suite needs a specific
 * operator to do more than record its arguments — most commonly `sql`, which
 * several suites replace with a tag that their fake `execute` can interpret.
 *
 *   vi.mock("drizzle-orm", async () => {
 *     const { drizzleMock } = await import("./helpers/drizzle-mock");
 *     return drizzleMock();
 *   });
 */
export function drizzleMock(overrides: DrizzleMock = {}): DrizzleMock {
  const mock: DrizzleMock = {};

  for (const op of BINARY) mock[op] = (col: Col, val: Val) => ({ __kind: op, col, val });
  for (const op of UNARY) mock[op] = (col: Col) => ({ __kind: op, col });
  for (const op of VARIADIC) mock[op] = (...conds: unknown[]) => ({ __kind: op, conds });

  // Set membership — the operator whose absence started this.
  mock.inArray = (col: Col, values: unknown) => ({ __kind: "inArray", col, values });
  mock.notInArray = (col: Col, values: unknown) => ({ __kind: "notInArray", col, values });
  mock.between = (col: Col, from: Val, to: Val) => ({ __kind: "between", col, from, to });
  mock.exists = (query: unknown) => ({ __kind: "exists", query });

  // `sql` is a template tag that also carries helpers used as `sql.raw(…)`.
  // The marker names match what helpers/mock-execute.ts reads back, so a suite
  // building an IN-list with sql.join still resolves to the right rows.
  const sqlTag = Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) => ({ __kind: "sql", strings, values }),
    {
      raw:  (str: unknown) => ({ __kind: "sql_raw", str }),
      join: (chunks: unknown[], separator?: unknown) => ({ __kind: "sql_join", chunks, separator }),
      empty: () => ({ __kind: "sql_empty" }),
    },
  );
  mock.sql = sqlTag;

  // Schema files call `relations(...)` at module load; it needs to be callable
  // but its result is never read by these suites.
  mock.relations = () => ({});
  mock.getTableColumns = (table: any) => table;
  mock.alias = (table: any, name: string) => ({ ...(table as object), __alias: name });

  return { ...mock, ...overrides };
}
