import { describe, it, expect } from "vitest";
import {
  RETENTION_LIMITS,
  tierPrefix,
  backupKey,
  dayFromKey,
  tiersForDay,
  selectExpired,
  type BackupTier,
} from "./backup-retention";

const INVALID_DAY_MESSAGE = "Некорректная дата резервной копии: ожидается формат ГГГГ-ММ-ДД";

/** Days a bad caller might pass in place of a "YYYY-MM-DD" day. */
const INVALID_DAYS = [
  "",
  "2026-7-31",
  "31.07.2026",
  "2026-02-30",
  "2026-13-01",
  "2026-07-31T00:00:00Z",
  " 2026-07-31",
  "tomorrow",
  "'; DROP TABLE users; --",
];

describe("RETENTION_LIMITS", () => {
  it("keeps 7 daily, 4 weekly and 12 monthly backups", () => {
    expect(RETENTION_LIMITS).toEqual({ daily: 7, weekly: 4, monthly: 12 });
  });
});

describe("tierPrefix", () => {
  it("returns a trailing-slash prefix per tier", () => {
    expect(tierPrefix("daily")).toBe("backups/daily/");
    expect(tierPrefix("weekly")).toBe("backups/weekly/");
    expect(tierPrefix("monthly")).toBe("backups/monthly/");
  });
});

describe("backupKey", () => {
  it("builds the documented key", () => {
    expect(backupKey("daily", "2026-07-31")).toBe("backups/daily/warehouse-pro-2026-07-31.sql.gz.enc");
    expect(backupKey("monthly", "2026-02-01")).toBe("backups/monthly/warehouse-pro-2026-02-01.sql.gz.enc");
  });

  it("puts the key under the tier prefix", () => {
    for (const tier of ["daily", "weekly", "monthly"] as BackupTier[]) {
      expect(backupKey(tier, "2026-07-31").startsWith(tierPrefix(tier))).toBe(true);
    }
  });

  it("throws on an invalid day instead of producing a bad key", () => {
    for (const day of INVALID_DAYS) {
      expect(() => backupKey("daily", day), day).toThrow(INVALID_DAY_MESSAGE);
    }
  });
});

describe("dayFromKey", () => {
  it("round-trips every tier", () => {
    for (const tier of ["daily", "weekly", "monthly"] as BackupTier[]) {
      for (const day of ["2026-07-31", "2024-02-29", "1999-12-31"]) {
        expect(dayFromKey(backupKey(tier, day))).toBe(day);
      }
    }
  });

  it("returns null for foreign keys", () => {
    expect(dayFromKey("backups/daily/other.txt")).toBeNull();
    expect(dayFromKey("logo.png")).toBeNull();
    expect(dayFromKey("")).toBeNull();
    expect(dayFromKey("backups/hourly/warehouse-pro-2026-07-31.sql.gz.enc")).toBeNull();
    expect(dayFromKey("backups/daily/nested/warehouse-pro-2026-07-31.sql.gz.enc")).toBeNull();
    expect(dayFromKey("other-app/daily/warehouse-pro-2026-07-31.sql.gz.enc")).toBeNull();
    expect(dayFromKey("backups/daily/other-app-2026-07-31.sql.gz.enc")).toBeNull();
    expect(dayFromKey("backups/daily/warehouse-pro-2026-07-31.sql.gz")).toBeNull();
  });

  it("returns null for a malformed or impossible date", () => {
    expect(dayFromKey("backups/daily/warehouse-pro-2026-7-31.sql.gz.enc")).toBeNull();
    expect(dayFromKey("backups/daily/warehouse-pro-31-07-2026.sql.gz.enc")).toBeNull();
    expect(dayFromKey("backups/daily/warehouse-pro-2026-02-30.sql.gz.enc")).toBeNull();
    expect(dayFromKey("backups/daily/warehouse-pro-.sql.gz.enc")).toBeNull();
  });
});

describe("tiersForDay", () => {
  it("puts a plain weekday in the daily tier only", () => {
    // 2026-07-31 is a Friday
    expect(tiersForDay("2026-07-31")).toEqual(["daily"]);
    expect(tiersForDay("2026-07-25")).toEqual(["daily"]);
  });

  it("adds the weekly tier on a Sunday", () => {
    // 2026-07-26 is a Sunday
    expect(tiersForDay("2026-07-26")).toEqual(["daily", "weekly"]);
  });

  it("adds the monthly tier on the 1st", () => {
    // 2026-07-01 is a Wednesday
    expect(tiersForDay("2026-07-01")).toEqual(["daily", "monthly"]);
  });

  it("adds both tiers when the 1st falls on a Sunday", () => {
    expect(tiersForDay("2026-02-01")).toEqual(["daily", "weekly", "monthly"]);
  });

  it("reads the day in UTC, not local time", () => {
    // A local-time reading could shift these onto the neighbouring day and move
    // the weekly/monthly boundaries.
    expect(tiersForDay("2026-01-31")).toEqual(["daily"]);
    expect(tiersForDay("2026-03-01")).toEqual(["daily", "weekly", "monthly"]);
  });

  it("throws on an invalid day", () => {
    for (const day of INVALID_DAYS) {
      expect(() => tiersForDay(day), day).toThrow(INVALID_DAY_MESSAGE);
    }
  });
});

describe("selectExpired", () => {
  const dailyKeys = (days: string[]) => days.map((day) => backupKey("daily", day));

  it("keeps the newest N regardless of input order", () => {
    const days = ["2026-07-01", "2026-07-02", "2026-07-03", "2026-07-04", "2026-07-05"];
    const expected = dailyKeys(["2026-07-01", "2026-07-02"]);

    expect(selectExpired(dailyKeys(days), 3)).toEqual(expected);
    expect(selectExpired(dailyKeys([...days].reverse()), 3)).toEqual(expected);
    expect(selectExpired(dailyKeys(["2026-07-03", "2026-07-01", "2026-07-05", "2026-07-02", "2026-07-04"]), 3)).toEqual(expected);
  });

  it("returns nothing when the tier is at or under the limit", () => {
    const days = ["2026-07-01", "2026-07-02", "2026-07-03"];
    expect(selectExpired(dailyKeys(days), 3)).toEqual([]);
    expect(selectExpired(dailyKeys(days), 7)).toEqual([]);
    expect(selectExpired([], RETENTION_LIMITS.daily)).toEqual([]);
  });

  it("expires everything recognised at limit 0", () => {
    const keys = dailyKeys(["2026-07-01", "2026-07-02"]);
    expect(selectExpired(keys, 0)).toEqual(keys);
  });

  it("never returns unrecognised keys, even when the list is over the limit", () => {
    const foreign = ["backups/daily/other.txt", "logo.png", "backups/daily/warehouse-pro-2026-02-30.sql.gz.enc"];
    const keys = [...foreign, ...dailyKeys(["2026-07-01", "2026-07-02", "2026-07-03"])];

    expect(selectExpired(keys, 1)).toEqual(dailyKeys(["2026-07-01", "2026-07-02"]));
    expect(selectExpired(keys, 0)).toEqual(dailyKeys(["2026-07-01", "2026-07-02", "2026-07-03"]));
    expect(selectExpired(foreign, 0)).toEqual([]);
  });

  it("counts only recognised keys towards the limit", () => {
    const keys = ["logo.png", "backups/daily/other.txt", ...dailyKeys(["2026-07-01", "2026-07-02"])];
    expect(selectExpired(keys, 2)).toEqual([]);
  });

  it("applies the real daily limit to a full window", () => {
    const days = Array.from({ length: 10 }, (_, i) => `2026-07-${String(i + 1).padStart(2, "0")}`);
    const expired = selectExpired(dailyKeys(days), RETENTION_LIMITS.daily);
    expect(expired).toEqual(dailyKeys(["2026-07-01", "2026-07-02", "2026-07-03"]));
  });

  it("orders the result oldest first", () => {
    const keys = dailyKeys(["2026-06-30", "2026-07-02", "2026-07-01"]);
    expect(selectExpired(keys, 0)).toEqual(dailyKeys(["2026-06-30", "2026-07-01", "2026-07-02"]));
  });
});
