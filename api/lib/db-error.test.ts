import { describe, it, expect, beforeEach, vi } from "vitest";

// error-log.ts persists to logs/error-log.jsonl on import and on every write.
// Keep the suite hermetic: no directories created, no files touched.
vi.mock("fs", () => ({
  existsSync: () => false,
  mkdirSync: () => undefined,
  readFileSync: () => "",
  appendFileSync: () => undefined,
  statSync: () => ({ size: 0 }),
  renameSync: () => undefined,
}));

import { TRPCError } from "@trpc/server";
import { describeDbError, extractDbError, stripBoundParams } from "./db-error";
import { getErrors, logTrpcError, purgeOldErrors } from "./error-log";

/**
 * A mysql2 driver error, as it actually arrives: the useful fields are own
 * enumerable properties, and `sql` carries the statement with the values already
 * interpolated — the leak this helper exists to avoid.
 */
function mysql2Error(fields: {
  code: string;
  errno: number;
  sqlState: string;
  sqlMessage: string;
  sql?: string;
}): Error {
  const err = new Error(fields.sqlMessage);
  return Object.assign(err, fields);
}

/** Drizzle's wrapper: the statement with `?` placeholders, then the bound values. */
function drizzleError(sql: string, params: string, cause: unknown): Error {
  return new Error(`Failed query: ${sql}\nparams: ${params}`, { cause });
}

const TRUNCATED = {
  code: "ER_TRUNCATED_WRONG_VALUE",
  errno: 1366,
  sqlState: "22007",
  sqlMessage: "Incorrect decimal value: '' for column 'unit_weight' at row 1",
  sql: "insert into `products` (`name`, `unit_weight`) values ('Помидоры свежие', '')",
};

const DUPLICATE = {
  code: "ER_DUP_ENTRY",
  errno: 1062,
  sqlState: "23000",
  sqlMessage: "Duplicate entry 'TOM-001' for key 'products.uq_product_code'",
};

/** The insert from the incident, placeholders only. */
const PRODUCT_INSERT =
  "insert into `products` (`tenant_id`, `code`, `name`, `unit_weight`) values (?, ?, ?, ?)";
/** …and the customer data bound to it, which must never be recorded. */
const PRODUCT_PARAMS = "7,TOM-001,Помидоры свежие,";

describe("extractDbError — Drizzle-wrapped driver failure", () => {
  const detail = extractDbError(
    drizzleError(PRODUCT_INSERT, PRODUCT_PARAMS, mysql2Error(TRUNCATED)),
  );

  it("reaches the driver code and the server's own message", () => {
    expect(detail).not.toBeNull();
    expect(detail?.driverCode).toBe("ER_TRUNCATED_WRONG_VALUE");
    expect(detail?.sqlMessage).toBe(
      "Incorrect decimal value: '' for column 'unit_weight' at row 1",
    );
  });

  it("carries errno and sqlState for alert routing", () => {
    expect(detail?.errno).toBe(1366);
    expect(detail?.sqlState).toBe("22007");
  });

  it("names the column at fault and the table from the statement", () => {
    expect(detail?.column).toBe("unit_weight");
    expect(detail?.table).toBe("products");
  });

  it("never carries the interpolated statement mysql2 attaches as `sql`", () => {
    expect(JSON.stringify(detail)).not.toContain("Помидоры");
    expect(Object.keys(detail!)).not.toContain("sql");
  });
});

describe("extractDbError — bare mysql2 error", () => {
  it("works without any Drizzle wrapper", () => {
    const detail = extractDbError(mysql2Error(DUPLICATE));

    expect(detail?.driverCode).toBe("ER_DUP_ENTRY");
    expect(detail?.errno).toBe(1062);
    expect(detail?.sqlMessage).toBe("Duplicate entry 'TOM-001' for key 'products.uq_product_code'");
  });

  it("reads the table out of the duplicated key name", () => {
    expect(extractDbError(mysql2Error(DUPLICATE))?.table).toBe("products");
  });
});

describe("extractDbError — non-database errors", () => {
  it("returns null for a plain Error", () => {
    expect(extractDbError(new Error("boom"))).toBeNull();
  });

  it("returns null for a plain Error wrapping another plain Error", () => {
    expect(extractDbError(new Error("outer", { cause: new Error("inner") }))).toBeNull();
  });

  it("returns null for values that are not errors at all", () => {
    expect(extractDbError(null)).toBeNull();
    expect(extractDbError(undefined)).toBeNull();
    expect(extractDbError("ER_DUP_ENTRY")).toBeNull();
  });

  it("ignores a filesystem error that merely has a code and errno", () => {
    const enoent = Object.assign(new Error("ENOENT: no such file"), {
      code: "ENOENT",
      errno: -2,
      syscall: "open",
    });
    expect(extractDbError(enoent)).toBeNull();
  });
});

describe("extractDbError — cause chain", () => {
  it("walks two levels of wrapping", () => {
    const wrapped = new Error("Не удалось создать заказ", {
      cause: drizzleError(PRODUCT_INSERT, PRODUCT_PARAMS, mysql2Error(TRUNCATED)),
    });

    expect(extractDbError(wrapped)?.driverCode).toBe("ER_TRUNCATED_WRONG_VALUE");
  });

  it("gives up past the depth bound instead of walking forever", () => {
    let err = mysql2Error(DUPLICATE);
    for (let i = 0; i < 6; i++) err = new Error(`wrap ${i}`, { cause: err });

    expect(extractDbError(err)).toBeNull();
  });

  it("terminates on a self-referencing cause", () => {
    const looping = new Error("loops back on itself") as Error & { cause?: unknown };
    looping.cause = looping;

    expect(extractDbError(looping)).toBeNull();
  });

  it("terminates on a two-node cause cycle", () => {
    const a = new Error("a") as Error & { cause?: unknown };
    const b = new Error("b", { cause: a }) as Error & { cause?: unknown };
    a.cause = b;

    expect(extractDbError(a)).toBeNull();
  });
});

describe("stripBoundParams", () => {
  it("cuts the customer data off a Drizzle message, keeping the statement", () => {
    const stripped = stripBoundParams(
      `Failed query: ${PRODUCT_INSERT}\nparams: ${PRODUCT_PARAMS}`,
    );

    expect(stripped).toBe(`Failed query: ${PRODUCT_INSERT}`);
    expect(stripped).toContain("values (?, ?, ?, ?)");
    expect(stripped).not.toContain("params:");
    expect(stripped).not.toContain("Помидоры");
  });

  it("leaves an ordinary message untouched", () => {
    expect(stripBoundParams("Заказ не найден")).toBe("Заказ не найден");
  });
});

describe("describeDbError", () => {
  it("prefers the server's reason", () => {
    const err = drizzleError(PRODUCT_INSERT, PRODUCT_PARAMS, mysql2Error(TRUNCATED));
    expect(describeDbError(err)).toBe(TRUNCATED.sqlMessage);
  });

  it("falls back to the message without its bound parameters", () => {
    const err = new Error(`Failed query: ${PRODUCT_INSERT}\nparams: ${PRODUCT_PARAMS}`);
    expect(describeDbError(err)).toBe(`Failed query: ${PRODUCT_INSERT}`);
  });

  it("handles a non-Error throw", () => {
    expect(describeDbError("плохо")).toBe("плохо");
  });
});

describe("logTrpcError — recorded entry", () => {
  beforeEach(() => {
    purgeOldErrors(0);
  });

  /** The incident, end to end: service throws, tRPC wraps, the feed records it. */
  function recordIncident() {
    const trpcError = new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: `Failed query: ${PRODUCT_INSERT}\nparams: ${PRODUCT_PARAMS}`,
      cause: drizzleError(PRODUCT_INSERT, PRODUCT_PARAMS, mysql2Error(TRUNCATED)),
    });
    return logTrpcError({ error: trpcError, path: "product.create", method: "POST" });
  }

  it("attaches the driver detail to the entry", () => {
    const { entry } = recordIncident();

    expect(entry?.db?.driverCode).toBe("ER_TRUNCATED_WRONG_VALUE");
    expect(entry?.db?.sqlMessage).toBe(TRUNCATED.sqlMessage);
    expect(entry?.db?.column).toBe("unit_weight");
  });

  it("returns the detail to the caller for its own logger and Sentry", () => {
    expect(recordIncident().db?.errno).toBe(1366);
  });

  it("records no bound parameters anywhere in the entry", () => {
    recordIncident();
    const serialized = JSON.stringify(getErrors().errors);

    expect(serialized).not.toContain("params:");
    expect(serialized).not.toContain("Помидоры");
    expect(serialized).not.toContain("TOM-001");
  });

  it("keeps the placeholder statement, which is what makes it diagnosable", () => {
    const { entry } = recordIncident();

    expect(entry?.message).toBe(`Failed query: ${PRODUCT_INSERT}`);
    expect(entry?.message).toContain("insert into `products`");
  });

  it("leaves a non-database fault without a db field", () => {
    const { entry } = logTrpcError({
      error: new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "boom" }),
      path: "order.create",
      method: "POST",
    });

    expect(entry?.db).toBeUndefined();
  });
});
