/**
 * Время и «сегодня» на экране — по Ташкенту, на каком бы поясе ни стоял компьютер.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Арендатор 14.10.2026: «если зайдёт Мак, другое время покажет, и заказы
 * сдвинутся назад или вперёд». Экран считал время по часам устройства: на
 * Маке с поясом не Ташкента заказ в 01:30 первого ноября показывался «31.10
 * 16:30», чип «Сегодня» просил у сервера тридцать первое октября, «Этот месяц»
 * — октябрь, хотя в Ташкенте уже ноябрь.
 *
 * ── Что проверяется ─────────────────────────────────────────────────────────
 *
 *  1. Устройство в Нью-Йорке (западнее Ташкента) и в Токио (восточнее), а в
 *     каждом — момент, когда у устройства и у Ташкента разные числа: время
 *     заказа, «сегодня», чипы и месяц страницы «Заказы», день из календаря и
 *     поле datetime-local — ташкентские.
 *  2. Одна дверь: format берётся только из lib/business-time, isToday и
 *     подобные (они спрашивают часы устройства) не берутся вовсе, а
 *     toLocaleDateString / toLocaleTimeString, день через toISOString,
 *     полночь через new Date(год, месяц, число) и «сейчас» по часам
 *     устройства (toDay(new Date()), new Date().getHours()) на экраны не
 *     возвращаются.
 *
 * Нарочная поломка: в lib/orders-query верни `today: Date = new Date()` —
 * упадут чипы в Нью-Йорке и в Токио; в lib/business-time.format убери перевод
 * в TZDate — упадёт «время заказа»; в lib/date-range верни parseDay на
 * `new Date(y, m - 1, d)` — упадёт «день из календаря» в Токио; импортируй
 * format из date-fns в любом экране — упадёт «одна дверь».
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { startOfMonth } from "date-fns";
import { bizDay, bizNow, bizToday, format, fromBizInput, toBizInput, bizDateTimeText } from "@/lib/business-time";
import { ordersQuery, type OrdersView } from "@/lib/orders-query";
import { monthCells, parseDay, toDay } from "@/lib/date-range";
import { monthLabel } from "@/components/pnl/styles";

const VIEW: OrdersView = { section: "active", status: "", chips: {}, dateFrom: "", dateTo: "", search: "", agentIds: [] };

/*
  Для каждого пояса — момент, когда у устройства и у Ташкента разные числа.
  Нью-Йорк: 31.10 16:30 у устройства, 01.11 01:30 в Ташкенте.
  Токио:    01.11 03:30 у устройства, 31.10 23:30 в Ташкенте.
*/
const CASES = [
  { zone: "America/New_York", at: Date.UTC(2026, 9, 31, 20, 30), deviceDay: 31, today: "2026-11-01", time: "01.11.2026 01:30", month: "2026-11-01" },
  { zone: "Asia/Tokyo",       at: Date.UTC(2026, 9, 31, 18, 30), deviceDay: 1,  today: "2026-10-31", time: "31.10.2026 23:30", month: "2026-10-01" },
] as const;

for (const c of CASES) {
  describe(`устройство в поясе ${c.zone}`, () => {
    const was = process.env.TZ;
    beforeAll(() => { process.env.TZ = c.zone; });
    afterAll(() => { process.env.TZ = was; });
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(c.at);
    });
    afterEach(() => { vi.useRealTimers(); });

    it("у устройства и правда другое число", () => {
      // Без этого проверка ниже прошла бы и на сломанном коде.
      expect(new Date(c.at).getDate()).toBe(c.deviceDay);
    });

    it("время заказа — ташкентское", () => {
      expect(format(new Date(c.at).toISOString(), "dd.MM.yyyy HH:mm")).toBe(c.time);
      expect(format(new Date(c.at), "dd.MM.yyyy HH:mm")).toBe(c.time);
      expect(bizDateTimeText(c.at, "ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }))
        .toBe(c.time.replace(" ", ", "));
    });

    it("«сегодня» и «этот месяц» — ташкентские", () => {
      expect(bizToday()).toBe(c.today);
      expect(bizDay(c.at)).toBe(c.today);
      expect(toDay(startOfMonth(bizNow()))).toBe(c.month);
    });

    it("чипы и период страницы «Заказы» — ташкентские", () => {
      const today = ordersQuery({ ...VIEW, chips: { datePreset: "today" } }).list;
      expect(today).toMatchObject({ dateFrom: c.today, dateTo: c.today });
      const month = ordersQuery({ ...VIEW, section: "archive" }).list;
      expect(month).toMatchObject({ dateFrom: c.month, dateTo: c.today });
    });

    it("день из календаря остаётся тем же днём", () => {
      expect(toDay(parseDay("2026-10-13"))).toBe("2026-10-13");
      expect(format(parseDay("2026-10-13"), "d MMMM yyyy")).toBe("13 October 2026");
      // 1 октября 2026 — четверг в любом поясе: три пустые клетки (пн, вт, ср).
      expect(monthCells("2026-10-01").slice(0, 4)).toEqual([null, null, null, "2026-10-01"]);
      // Подпись месяца на графике P&L — тот же месяц, а не предыдущий.
      expect(monthLabel("2026-10", "ru")).toBe("окт 26");
    });

    it("поле datetime-local — ташкентские часы", () => {
      // «Привезти к 18:00» — это 18:00 в Ташкенте, то есть 13:00 UTC.
      expect(fromBizInput("2026-10-14T18:00")?.toISOString()).toBe("2026-10-14T13:00:00.000Z");
      expect(toBizInput("2026-10-14T13:00:00.000Z")).toBe("2026-10-14T18:00");
      expect(fromBizInput("")).toBeNull();
    });
  });
}

// ── Одна дверь ───────────────────────────────────────────────────────────────

function* walk(dir: string): Generator<string> {
  for (const e of readdirSync(dir)) {
    const full = join(dir, e);
    if (statSync(full).isDirectory()) { if (e !== "__tests__") yield* walk(full); }
    else if (/\.tsx?$/.test(e) && !/\.test\.tsx?$/.test(e)) yield full.split("\\").join("/");
  }
}
const DOOR = "src/lib/business-time.ts";
const FILES = [...walk("src")].filter(f => f !== DOOR);
// Комментарии вырезаются, но их строки остаются: номер строки в отчёте — настоящий.
const code = (f: string) => readFileSync(f, "utf-8").replace(/\/\*[\s\S]*?\*\//g, c => c.replace(/[^\n]/g, "")).replace(/^\s*\/\/.*$/gm, "");

/** Строки файла, где сработало правило: «файл:строка: текст». */
function offenders(rule: (line: string) => boolean): string[] {
  const out: string[] = [];
  for (const f of FILES) {
    code(f).split(/\r?\n/).forEach((line, i) => { if (rule(line)) out.push(`${f}:${i + 1}: ${line.trim().slice(0, 110)}`); });
  }
  return out;
}

describe("время на экране — через одну дверь", () => {
  it("format берётся из lib/business-time, а не из date-fns", () => {
    const bad: string[] = [];
    for (const f of FILES) {
      for (const m of code(f).matchAll(/import\s*\{([^}]*)\}\s*from\s*["']date-fns["']/g)) {
        if (/(^|[\s,])format([\s,]|$)/.test(m[1])) bad.push(f);
      }
    }
    expect(bad, `format по часам устройства:\n${bad.join("\n")}`).toEqual([]);
  });

  it("функции date-fns, которые сами спрашивают часы устройства, не берутся", () => {
    const bad: string[] = [];
    for (const f of FILES) {
      for (const m of code(f).matchAll(/import\s*\{([^}]*)\}\s*from\s*["']date-fns["']/g)) {
        const names = m[1].split(",").map(s => s.trim().split(/\s+as\s+/)[0]);
        const hit = names.filter(n => /^(isToday|isYesterday|isTomorrow|isThis\w+|startOfToday|endOfToday|startOfYesterday|startOfTomorrow|parseISO)$/.test(n));
        if (hit.length) bad.push(`${f}: ${hit.join(", ")}`);
      }
    }
    expect(bad, bad.join("\n")).toEqual([]);
  });

  it("toLocaleDateString / toLocaleTimeString — только через bizDateText / bizTimeText", () => {
    const bad = offenders(l => /\.toLocale(Date|Time)String\(/.test(l));
    expect(bad, bad.join("\n")).toEqual([]);
  });

  it("дата через toLocaleString — только с поясом", () => {
    // Число через toLocaleString — законно; дата — только bizDateTimeText.
    const bad = offenders(l => /(new Date\([^)]*\)|toDate\([^)]*\)\??|\b\w*(At|Date|date|timestamp|Timestamp|since)\b\??)\.toLocaleString\(/.test(l) && !/timeZone/.test(l));
    expect(bad, bad.join("\n")).toEqual([]);
  });

  it("день не печатают через UTC и не собирают по часам устройства", () => {
    /*
      toISOString().slice(0, 10) — день по UTC: до пяти утра в Ташкенте это
      вчера. new Date(год, месяц, число) и getTimezoneOffset — полночь и пояс
      устройства. Так «Рассчитать KPI» до этой правки отправлял началом
      октября 30 сентября даже с ташкентского компьютера.
    */
    const bad = offenders(l =>
      /\.toISOString\(\)\.(slice\(0,\s*1[06]\)|split\(["']T["']\))/.test(l)
      || /new Date\(\s*(\d{4}|[A-Za-z_][\w.]*(\(\))?)\s*,/.test(l)
      || /getTimezoneOffset\(/.test(l));
    expect(bad, bad.join("\n")).toEqual([]);
  });

  it("«сейчас» по часам устройства не превращают в день или час", () => {
    const bad = offenders(l =>
      /\b(toDay|localDay|ymd|day|dayOf|subDays|addDays|subMonths|addMonths|startOf\w+|endOf\w+|presetRange|ordersQuery|monthToDate)\(new Date\(\)/.test(l)
      || /new Date\([^)]*\)\.get(FullYear|Month|Date|Day|Hours|Minutes)\(/.test(l));
    expect(bad, bad.join("\n")).toEqual([]);
  });
});
