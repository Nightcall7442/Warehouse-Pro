import { describe, it, expect } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { orders } from "@db/schema";
import {
  safeDateParse,
  isIsoDay,
  isoDaySchema,
  onDay,
  sinceDay,
  beforeNextDay,
  onDate,
  untilDate,
} from "./date-range";

const dialect = new MySqlDialect();
const render = (query: ReturnType<typeof sinceDay>) => dialect.sqlToQuery(query);

/** Payloads a date filter must never turn into executable SQL. */
const INJECTION_PAYLOADS = [
  "2024-01-01' OR '1'='1",
  "'; DROP TABLE users; --",
  "2024-01-01' UNION SELECT username, password FROM users --",
  "2024-01-01' AND SLEEP(5) --",
  "2024-01-01'/**/OR/**/1=1#",
  '2024-01-01" OR ""="',
  "2024-01-01\\' OR 1=1",
  "1 OR 1=1",
];

describe("safeDateParse", () => {
  it("accepts a well-formed day", () => {
    expect(safeDateParse("2024-01-01")).toBe("2024-01-01");
    expect(safeDateParse("1999-12-31")).toBe("1999-12-31");
  });

  it("accepts a real leap day", () => {
    expect(safeDateParse("2024-02-29")).toBe("2024-02-29");
  });

  it("rejects a leap day in a non-leap year", () => {
    expect(safeDateParse("2023-02-29")).toBeNull();
  });

  it("rejects impossible calendar dates that JS would roll over", () => {
    // new Date("2024-02-30T00:00:00Z") silently becomes March 1st
    expect(safeDateParse("2024-02-30")).toBeNull();
    expect(safeDateParse("2024-04-31")).toBeNull();
  });

  it("rejects out-of-range months and days", () => {
    expect(safeDateParse("2024-13-01")).toBeNull();
    expect(safeDateParse("2024-00-10")).toBeNull();
    expect(safeDateParse("2024-01-32")).toBeNull();
    expect(safeDateParse("2024-01-00")).toBeNull();
  });

  it("rejects nullish and non-string input", () => {
    expect(safeDateParse(undefined)).toBeNull();
    expect(safeDateParse(null)).toBeNull();
    expect(safeDateParse("")).toBeNull();
    expect(safeDateParse(20240101 as unknown as string)).toBeNull();
    expect(safeDateParse({} as unknown as string)).toBeNull();
  });

  it("rejects other date formats", () => {
    expect(safeDateParse("2024-1-1")).toBeNull();
    expect(safeDateParse("01/02/2024")).toBeNull();
    expect(safeDateParse("2024-01-01T00:00:00Z")).toBeNull();
    expect(safeDateParse("2024-01-01 23:59:59")).toBeNull();
    expect(safeDateParse("24-01-01")).toBeNull();
  });

  it("rejects padding and embedded whitespace", () => {
    expect(safeDateParse(" 2024-01-01")).toBeNull();
    expect(safeDateParse("2024-01-01 ")).toBeNull();
    expect(safeDateParse("2024-01-01\n")).toBeNull();
    expect(safeDateParse("2024-01-01\u0000")).toBeNull();
  });

  it("rejects SQL injection payloads", () => {
    for (const payload of INJECTION_PAYLOADS) {
      expect(safeDateParse(payload), payload).toBeNull();
    }
  });

  it("rejects XSS and path traversal payloads", () => {
    expect(safeDateParse("<script>alert(1)</script>")).toBeNull();
    expect(safeDateParse("2024-01-01<script>")).toBeNull();
    expect(safeDateParse("../../etc/passwd")).toBeNull();
    expect(safeDateParse("2024-01-01/../../../etc/passwd")).toBeNull();
  });

  it("exposes the same rule through isIsoDay and isoDaySchema", () => {
    expect(isIsoDay("2024-01-01")).toBe(true);
    expect(isIsoDay("2024-02-30")).toBe(false);
    expect(isIsoDay(42)).toBe(false);

    expect(isoDaySchema.safeParse("2024-01-01").success).toBe(true);
    expect(isoDaySchema.safeParse("2024-02-30").success).toBe(false);
    expect(isoDaySchema.safeParse("'; DROP TABLE users; --").success).toBe(false);
  });
});

describe("beforeNextDay", () => {
  it("compares against the start of the next day instead of 23:59:59", () => {
    const { sql: text, params } = render(beforeNextDay(orders.createdAt, "2024-01-31"));
    expect(text).toContain("<");
    expect(text).not.toContain("23:59:59");
    expect(params).toEqual(["2024-02-01 00:00:00"]);
  });

  it("rolls over months, leap years and years", () => {
    expect(render(beforeNextDay(orders.createdAt, "2024-02-28")).params).toEqual(["2024-02-29 00:00:00"]);
    expect(render(beforeNextDay(orders.createdAt, "2023-02-28")).params).toEqual(["2023-03-01 00:00:00"]);
    expect(render(beforeNextDay(orders.createdAt, "2024-12-31")).params).toEqual(["2025-01-01 00:00:00"]);
  });
});

describe("day-boundary helpers", () => {
  it("sinceDay binds an explicit start-of-day boundary", () => {
    const { params } = render(sinceDay(orders.createdAt, "2024-03-05"));
    expect(params).toEqual(["2024-03-05 00:00:00"]);
  });

  it("onDay binds both boundaries of a single day", () => {
    const { params } = render(onDay(orders.createdAt, "2024-03-05"));
    expect(params).toEqual(["2024-03-05 00:00:00", "2024-03-06 00:00:00"]);
  });

  it("onDate and untilDate bind the bare day for DATE columns", () => {
    expect(render(onDate(orders.createdAt, "2024-03-05")).params).toEqual(["2024-03-05"]);
    expect(render(untilDate(orders.createdAt, "2024-03-05")).params).toEqual(["2024-03-05"]);
  });

  it("never inlines the day into the SQL text", () => {
    for (const day of ["2024-01-01", "2024-06-15"]) {
      for (const query of [onDay(orders.createdAt, day), sinceDay(orders.createdAt, day), beforeNextDay(orders.createdAt, day)]) {
        const { sql: text } = render(query);
        expect(text).not.toContain(day);
        expect(text).toContain("?");
      }
    }
  });
});
