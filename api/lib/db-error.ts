/**
 * Driver-level detail for a failed database query.
 *
 * FIX: production incident triage — a failing insert reached the monitoring feed
 * as `Failed query: insert into \`products\` ... values (?, ?, ?)` and nothing
 * else. The reason ("Incorrect decimal value: '' for column 'unit_weight'") was
 * on the mysql2 error that Drizzle hangs off `.cause`, and no sink ever read it,
 * so the only way to diagnose the outage was to read the bound parameters out of
 * the query text by hand.
 *
 * Drizzle wraps every driver failure as `new Error("Failed query: <sql> params:
 * <values>", { cause: mysql2Error })`, and a service that catches and rethrows
 * can wrap it a second time. {@link extractDbError} walks that chain and pulls
 * the fields worth alerting on: `code`, `errno`, `sqlState`, `sqlMessage`.
 *
 * Two things are deliberately NOT captured:
 *  - the bound parameters (`params: …` in Drizzle's message) — they are customer
 *    data: names, phone numbers, prices. {@link stripBoundParams} cuts them off.
 *  - mysql2's `err.sql`, which is the query with the values already interpolated
 *    and therefore the same leak by another name.
 *
 * The query text with `?` placeholders is safe and stays in the message.
 */

/** What a database driver can tell us about a failure. Every field is optional. */
export interface DbErrorDetail {
  /** mysql2 `code`, e.g. `ER_DUP_ENTRY`, `ER_TRUNCATED_WRONG_VALUE`. */
  driverCode?: string;
  /** MySQL numeric error number, e.g. 1366. */
  errno?: number;
  /** ANSI SQLSTATE, e.g. `"22007"`. */
  sqlState?: string;
  /** The server's own text, e.g. `Incorrect decimal value: '' for column 'x' at row 1`. */
  sqlMessage?: string;
  /** Table parsed out of the message or the failing statement, when identifiable. */
  table?: string;
  /** Column parsed out of the driver message, when it names one. */
  column?: string;
}

/**
 * How far to follow `.cause`. Drizzle adds one level, a rethrowing service can
 * add another; five is slack enough without letting a pathological chain spin.
 */
const MAX_CAUSE_DEPTH = 5;

/**
 * Drizzle builds its message as `Failed query: <sql>\nparams: <values>`, so the
 * boundary is a line of its own. A bound value containing a newline continues
 * onto the following lines, which is why dropping stops only at the next stack
 * frame (in a `stack`) or at the end of the text (in a `message`).
 */
const PARAMS_LINE = /^\s*params:/;
const STACK_FRAME = /^\s*at\s/;

/**
 * Remove Drizzle's `params: …` values from a message or a stack.
 *
 * The statement (with `?` placeholders) is what makes an error diagnosable; the
 * values bound to it are customer data — names, prices, phone numbers — and must
 * never reach a log file. A stack keeps its frames: only the parameter lines go.
 * Text without the marker comes back untouched.
 */
export function stripBoundParams(text: string): string {
  if (!text.includes("params:")) return text;

  const kept: string[] = [];
  let dropping = false;
  for (const line of text.split("\n")) {
    if (PARAMS_LINE.test(line)) {
      dropping = true;
      continue;
    }
    if (dropping) {
      // Still inside a multi-line bound value until the frames start again.
      if (!STACK_FRAME.test(line)) continue;
      dropping = false;
    }
    kept.push(line);
  }

  return kept.join("\n").trimEnd();
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * Is this the driver's own error, rather than an application error that merely
 * has a `code`?
 *
 * `sqlState`/`sqlMessage` are set only by the server round-trip. Failing those,
 * a mysql2-shaped `code` prefix identifies it. The last clause catches socket
 * failures (`ECONNREFUSED`, `ETIMEDOUT`) — mysql2 marks its own as `fatal`,
 * which is what separates them from an unrelated `ENOENT` off the filesystem.
 */
function isDriverError(rec: Record<string, unknown>): boolean {
  if (str(rec.sqlState) || str(rec.sqlMessage)) return true;
  const code = str(rec.code);
  if (!code) return false;
  if (/^(ER_|PROTOCOL_|POOL_)/.test(code)) return true;
  return rec.fatal === true && num(rec.errno) !== undefined;
}

/** `for column 'x'`, `Unknown column 'x'`, `Field 'x' doesn't have a default value`. */
function findColumn(text: string | undefined): string | undefined {
  if (!text) return undefined;
  return (
    /(?:for|Unknown) column '([^']+)'/.exec(text)?.[1] ??
    /\bField '([^']+)'/.exec(text)?.[1]
  );
}

/**
 * The table, from whichever of the driver's phrasings applies: a missing table,
 * a duplicate key (MySQL 8 reports keys as `table.index`), or a foreign key
 * constraint naming `` `db`.`table` ``.
 */
function findTableInSqlMessage(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const missing = /Table '(?:[^'.]*\.)?([^']+)' doesn't exist/.exec(text)?.[1];
  if (missing) return missing;

  const key = /for key '([^']+)'/.exec(text)?.[1];
  if (key) {
    const parts = key.split(".");
    if (parts.length === 2 && parts[0]) return parts[0];
  }

  return /foreign key constraint fails \(`[^`]+`\.`([^`]+)`/.exec(text)?.[1];
}

/**
 * Fallback: the table named by the failing statement itself. Drizzle puts the
 * statement in the wrapper message, and it is placeholder-only, so reading it
 * costs nothing in exposure.
 */
function findTableInStatement(messages: string[]): string | undefined {
  for (const message of messages) {
    const match = /\b(?:insert\s+into|update|delete\s+from|from)\s+`?([A-Za-z0-9_]+)`?/i.exec(message);
    if (match) return match[1];
  }
  return undefined;
}

function buildDetail(rec: Record<string, unknown>, wrappers: string[]): DbErrorDetail {
  const detail: DbErrorDetail = {};

  const driverCode = str(rec.code);
  if (driverCode) detail.driverCode = driverCode;

  const errno = num(rec.errno);
  if (errno !== undefined) detail.errno = errno;

  const sqlState = str(rec.sqlState);
  if (sqlState) detail.sqlState = sqlState;

  const sqlMessage = str(rec.sqlMessage);
  if (sqlMessage) detail.sqlMessage = stripBoundParams(sqlMessage);

  // The driver's own `message` is usually the same text as `sqlMessage`; use it
  // for parsing when the field itself is absent, but never record it as one.
  const text = sqlMessage ?? str(rec.message);

  const table = findTableInSqlMessage(text) ?? findTableInStatement(wrappers);
  if (table) detail.table = table;

  const column = findColumn(text);
  if (column) detail.column = column;

  return detail;
}

/**
 * Pull the driver-level detail out of anything thrown, walking `.cause` until a
 * database error turns up.
 *
 * Returns `null` when the chain holds no database error — a validation failure,
 * a `TypeError`, a `DomainError` — so callers can treat "not a DB problem" as a
 * distinct case rather than as an empty object.
 *
 * The walk is bounded at {@link MAX_CAUSE_DEPTH} and remembers what it has seen,
 * so an error whose `cause` points back at itself terminates instead of hanging.
 */
export function extractDbError(err: unknown): DbErrorDetail | null {
  const seen = new Set<unknown>();
  /** Wrapper messages, outermost first — where the `?`-placeholder SQL lives. */
  const wrappers: string[] = [];
  let current: unknown = err;

  for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth++) {
    const rec = asRecord(current);
    if (!rec || seen.has(current)) break;
    seen.add(current);

    if (isDriverError(rec)) return buildDetail(rec, wrappers);

    const message = str(rec.message);
    if (message) wrappers.push(message);
    current = rec.cause;
  }

  return null;
}

/**
 * One line describing a failure, safe to show a user or put in an import report:
 * the server's reason when there is one, otherwise the message minus its bound
 * parameters.
 */
export function describeDbError(err: unknown): string {
  const detail = extractDbError(err);
  if (detail?.sqlMessage) return detail.sqlMessage;
  return stripBoundParams(err instanceof Error ? err.message : String(err));
}
