/**
 * Сутки на сервере — ташкентские: отчёт, фильтр и график за 13-е — это заказы
 * с полуночи 13-го до полуночи 14-го по Ташкенту.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Экран после PR о времени на экране просил у сервера тот день, который видит
 * человек, а сервер делил сутки по UTC: граница дня бралась строкой
 * «2026-10-13 00:00:00», сессия MySQL сравнивала её в UTC — то есть с 05:00 по
 * Ташкенту. Заказ в 03:30 13-го попадал в отчёт, фильтр и график за 12-е,
 * DATE(created_at) клал его туда же, CURDATE() до пяти утра был вчерашним, а
 * месяц зарплаты начинался 1-го в 05:00.
 *
 * ── Почему не сменить пояс сессии ───────────────────────────────────────────
 *
 * drizzle пишет TIMESTAMP через toISOString и читает с «+0000»: он сам
 * считает, что сессия в UTC. Поэтому сессия остаётся в UTC, а граница дня
 * переводится явно (lib/date-range): полночь по Ташкенту — 19:00 по UTC
 * накануне, день отметки — DATE(col + INTERVAL 5 HOUR). Колонки DATE (план
 * визитов, срок годности, период зарплаты) хранят сам день и не сдвигаются.
 *
 * ── Что проверяется ─────────────────────────────────────────────────────────
 *
 *  1. Границы дня и периода — ташкентские полночи.
 *  2. Страж исходников: CURDATE(), DATE(колонка) без сдвига, «23:59:59» и
 *     «00:00:00» строкой, день через toISOString от «сейчас», format из
 *     date-fns и полночь по часам процесса в сервер не возвращаются.
 *
 * Сквозная проверка на настоящей базе — real-db/business-day.test.ts.
 *
 * Нарочная поломка: в lib/date-range верни dayStartUtc на `${day} 00:00:00`
 * — упадут границы; напиши в любом запросе CURDATE() или
 * DATE(${orders.createdAt}) — упадёт страж.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { dayEndUtc, dayStartUtc } from "../lib/date-range";
import { dayKey, monthRange } from "../lib/period";
import { businessDay, businessDayEnd, businessDayStart, businessDaysAgo, businessToday } from "@contracts/business-time";

describe("граница дня — полночь по Ташкенту", () => {
  it("13-е начинается в 19:00 по UTC 12-го и кончается в 19:00 13-го", () => {
    expect(dayStartUtc("2026-10-13")).toBe("2026-10-12 19:00:00");
    expect(dayEndUtc("2026-10-13")).toBe("2026-10-13 19:00:00");
    expect(businessDayStart("2026-10-13").toISOString()).toBe("2026-10-12T19:00:00.000Z");
    expect(businessDayEnd("2026-10-13").toISOString()).toBe("2026-10-13T18:59:59.999Z");
  });

  it("через месяц и год", () => {
    expect(dayStartUtc("2026-01-01")).toBe("2025-12-31 19:00:00");
    expect(dayEndUtc("2026-12-31")).toBe("2026-12-31 19:00:00");
  });

  it("не день, а момент — ошибка вызывающего, а не тихо обрезанная граница", () => {
    expect(() => dayStartUtc("2026-10-13 00:00:00")).toThrow();
    expect(() => dayStartUtc("2026-10-13T00:00:00Z")).toThrow();
  });

  it("день момента, «сегодня» и «N дней назад» — по Ташкенту", () => {
    const night = Date.UTC(2026, 9, 12, 22, 30); // 03:30 13-го по Ташкенту
    expect(businessDay(night)).toBe("2026-10-13");
    expect(businessToday(night)).toBe("2026-10-13");
    expect(businessDaysAgo(1, night)).toBe("2026-10-12");
    expect(dayKey(new Date(night))).toBe("2026-10-13");
  });

  it("значение колонки DATE (полночь UTC) остаётся своим днём", () => {
    expect(dayKey(new Date("2026-10-13T00:00:00Z"))).toBe("2026-10-13");
  });

  it("месяц момента — ташкентский: 03:30 первого ноября — уже ноябрь", () => {
    expect(monthRange(new Date(Date.UTC(2026, 9, 31, 22, 30)))).toEqual({ start: "2026-11-01", end: "2026-11-30" });
  });
});

// ── Страж исходников ─────────────────────────────────────────────────────────

function* walk(dir: string): Generator<string> {
  for (const e of readdirSync(dir)) {
    const full = join(dir, e);
    if (statSync(full).isDirectory()) { if (e !== "__tests__") yield* walk(full); }
    else if (/\.ts$/.test(e) && !/\.test\.ts$/.test(e)) yield full.split("\\").join("/");
  }
}
const FILES = [...walk("api")];
// Комментарии вырезаются, но их строки остаются: номер строки в отчёте — настоящий.
const code = (f: string) => readFileSync(f, "utf-8")
  .replace(/\/\*[\s\S]*?\*\//g, c => c.replace(/[^\n]/g, ""))
  .replace(/^[ \t]*(\/\/|--).*$/gm, "");

/**
 * Исключения — по файлу и с причиной.
 *
 * Публичный API отдаёт и принимает время в UTC: так записано в договоре с
 * интегратором (docs/bekdrinks-otvet.md), и границу «по 13-е» он понимает
 * как конец 13-го по UTC. Менять её — менять договор.
 */
const UTC_BY_CONTRACT = new Set(["api/public/order-export.ts", "api/public/orders-v1.ts"]);

/** Строки файла, где сработало правило: «файл:строка: текст». */
function offenders(rule: (line: string) => boolean, skip: ReadonlySet<string> = new Set()): string[] {
  const out: string[] = [];
  for (const f of FILES) {
    if (skip.has(f)) continue;
    code(f).split(/\r?\n/).forEach((line, i) => { if (rule(line)) out.push(`${f}:${i + 1}: ${line.trim().slice(0, 120)}`); });
  }
  return out;
}

/** Функции MySQL, которые режут момент на день, час или месяц по поясу сессии (UTC). */
const TRUNC = String.raw`\b(DATE|DATE_FORMAT|HOUR|DAYOFWEEK|WEEKDAY|YEARWEEK|DAYOFMONTH|MONTH|YEAR)\(\s*`;

describe("сервер не делит сутки по UTC", () => {
  it("«сегодня» в SQL — DATE(UTC_TIMESTAMP() + INTERVAL 5 HOUR), а не CURDATE()", () => {
    // Сессия в UTC: CURDATE() до пяти утра по Ташкенту — вчерашнее число.
    const bad = offenders(l => /\b(CURDATE|CURTIME)\(\)|\bCURRENT_DATE\b/i.test(l));
    expect(bad, bad.join("\n")).toEqual([]);
  });

  it("день и месяц отметки времени — через bizClock, а не DATE(колонка)", () => {
    /*
      ${orders.createdAt} и COALESCE(${…At}, …) — отметки времени. Колонки
      DATE (expiresAt, planDate, periodStart…) именами на At не кончаются,
      кроме срока годности — он исключён явно.
    */
    const drizzle = new RegExp(`${TRUNC}(\\$\\{\\w+\\.(?!expiresAt\\b)\\w+At\\}|COALESCE\\(\\$\\{\\w+\\.\\w+At\\})`);
    const bad = offenders(l => drizzle.test(l));
    expect(bad, bad.join("\n")).toEqual([]);
  });

  it("в сыром SQL день отметки — DATE(col + INTERVAL 5 HOUR)", () => {
    const plain = new RegExp(`${TRUNC}(\\w+\\.)?(?!expires_at\\b)\\w+_at\\b(?!\\s*\\+\\s*INTERVAL 5 HOUR)`, "i");
    const coalesce = new RegExp(`${TRUNC}COALESCE\\([^()]*_at\\b[^()]*\\)(?!\\s*\\+\\s*INTERVAL 5 HOUR)`, "i");
    const bad = offenders(l => plain.test(l) || coalesce.test(l));
    expect(bad, bad.join("\n")).toEqual([]);
  });

  it("граница дня не собирается строкой «00:00:00» / «23:59:59»", () => {
    /*
      «по 13-е» → `${to} 23:59:59` — конец 13-го по UTC, то есть 04:59 14-го
      по Ташкенту, а начало — 05:00 13-го. Границы — onDay / sinceDay /
      untilDay или businessDayStart / businessDayEnd.
    */
    const bad = offenders(l => /[\sT](00:00:00|23:59:59)(\.\d+)?(?!Z)["'`]/.test(l), UTC_BY_CONTRACT);
    expect(bad, bad.join("\n")).toEqual([]);
  });

  it("«сегодня» не берут из UTC и не форматируют date-fns по часам процесса", () => {
    const bad = offenders(l =>
      /new Date\(\)\.toISOString\(\)\.(slice\(0,\s*10\)|split\(["']T["']\))/.test(l)
      || /\bformat\(\s*(new Date\(|now\b|subDays\()/.test(l));
    expect(bad, bad.join("\n")).toEqual([]);
    const fmt: string[] = [];
    for (const f of FILES) {
      for (const m of code(f).matchAll(/import\s*\{([^}]*)\}\s*from\s*["']date-fns["']/g)) {
        if (/(^|[\s,])(format|startOfDay|startOfMonth|endOfDay|endOfMonth|isToday)([\s,]|$)/.test(m[1])) fmt.push(`${f}: ${m[1].trim()}`);
      }
    }
    expect(fmt, `календарь по часам процесса:\n${fmt.join("\n")}`).toEqual([]);
  });

  it("полночь и месяц не собирают по часам процесса", () => {
    /*
      new Date(год, месяц, число) и getHours() — календарь процесса, а он в
      UTC. Исключения — арифметика над днями колонки DATE, где сам день и
      нужен, и журнал ошибок с его минутными корзинами.
    */
    const LOCAL_DAY_OK = new Set([
      "api/services/anti-fraud.ts",       // повтор визита — по дню плана, колонке DATE
      "api/services/courier-delivery.ts", // срок долга, введённый курьером, — колонка DATE
      "api/lib/error-log.ts",             // корзины «чч:мм» журнала ошибок, не сутки
    ]);
    const bad = offenders(l =>
      /new Date\(\s*[A-Za-z_][\w.]*(\(\))?\s*,\s*[A-Za-z_]/.test(l)
      || /\.get(Hours|Day)\(\)/.test(l), LOCAL_DAY_OK);
    expect(bad, bad.join("\n")).toEqual([]);
  });
});
