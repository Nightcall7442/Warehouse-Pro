import { describe, it, expect, afterEach, vi } from "vitest";
import { getPeriod } from "../lib/period";

/**
 * Сдвиг периода назад.
 *
 * Зарплату за сентябрь выдают в октябре, а экран умел показывать только «с
 * первого числа по сегодня»: закрытый месяц посмотреть было нельзя вовсе, и
 * спор «за март не платили» разбирать было не по чему.
 *
 * Проверяется прямо, а не через процедуру: арифметика дат ошибается тихо. Ни
 * один из этих случаев — месяц из 31 дня, переход через год, границы квартала —
 * не виден ни типам, ни линтеру.
 */

const at = (iso: string) => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(iso));
};

afterEach(() => vi.useRealTimers());

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

describe("месяц", () => {
  it("текущий — с первого числа по сегодня", () => {
    at("2026-09-05T12:00:00");
    const { periodStart, periodEnd } = getPeriod("month", 0);
    expect(ymd(periodStart)).toBe("2026-09-01");
    expect(ymd(periodEnd)).toBe("2026-09-05");
  });

  it("прошлый — целиком, а не по сегодняшнее число", () => {
    /*
      Здесь и была бы самая дорогая ошибка: конец периода «сегодня» показал бы
      в августе ещё и сентябрьские выплаты, и фонд не сошёлся бы ни с чем.
    */
    at("2026-09-05T12:00:00");
    const { periodStart, periodEnd } = getPeriod("month", 1);
    expect(ymd(periodStart)).toBe("2026-08-01");
    expect(ymd(periodEnd)).toBe("2026-08-31");
    expect(periodEnd.getHours()).toBe(23);
  });

  it("длина месяца берётся настоящая, а не 30 дней", () => {
    at("2026-03-10T12:00:00");
    expect(ymd(getPeriod("month", 1).periodEnd)).toBe("2026-02-28");
  });

  it("сдвиг через границу года уходит в прошлый год", () => {
    at("2026-01-15T12:00:00");
    const { periodStart, periodEnd } = getPeriod("month", 1);
    expect(ymd(periodStart)).toBe("2025-12-01");
    expect(ymd(periodEnd)).toBe("2025-12-31");
  });
});

describe("неделя", () => {
  it("текущая — последние семь дней по сегодня", () => {
    at("2026-09-05T12:00:00");
    const { periodStart, periodEnd } = getPeriod("week", 0);
    expect(ymd(periodStart)).toBe("2026-08-30");
    expect(ymd(periodEnd)).toBe("2026-09-05");
  });

  it("прошлая — ровно предыдущие семь дней", () => {
    at("2026-09-05T12:00:00");
    const { periodStart, periodEnd } = getPeriod("week", 1);
    expect(ymd(periodStart)).toBe("2026-08-23");
    expect(ymd(periodEnd)).toBe("2026-08-29");
  });
});

describe("квартал", () => {
  it("текущий — с начала квартала по сегодня", () => {
    at("2026-09-05T12:00:00");
    const { periodStart, periodEnd } = getPeriod("quarter", 0);
    expect(ymd(periodStart)).toBe("2026-07-01");
    expect(ymd(periodEnd)).toBe("2026-09-05");
  });

  it("прошлый — целиком", () => {
    at("2026-09-05T12:00:00");
    const { periodStart, periodEnd } = getPeriod("quarter", 1);
    expect(ymd(periodStart)).toBe("2026-04-01");
    expect(ymd(periodEnd)).toBe("2026-06-30");
  });

  it("сдвиг через границу года уходит в прошлый год", () => {
    at("2026-02-10T12:00:00");
    const { periodStart, periodEnd } = getPeriod("quarter", 1);
    expect(ymd(periodStart)).toBe("2025-10-01");
    expect(ymd(periodEnd)).toBe("2025-12-31");
  });
});

describe("без сдвига", () => {
  it("вызов с одним доводом ведёт себя как раньше", () => {
    // Процедур, зовущих getPeriod, восемь, и большинству сдвиг не нужен.
    at("2026-09-05T12:00:00");
    expect(getPeriod("month")).toEqual(getPeriod("month", 0));
  });
});
