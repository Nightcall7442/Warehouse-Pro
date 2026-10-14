import { describe, it, expect, afterEach, vi } from "vitest";
import { getPeriod } from "../lib/period";
import { businessDay } from "@contracts/business-time";

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

// Моменты — по Ташкенту явно: календарь периода ташкентский, а не часов машины.
const at = (iso: string) => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(`${iso}+05:00`));
};

afterEach(() => vi.useRealTimers());

const ymd = (d: Date) => businessDay(d);
const bizHour = (d: Date) => new Date(d.getTime() + 5 * 3600_000).getUTCHours();

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
    expect(bizHour(periodEnd)).toBe(23);
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

describe("сегодня", () => {
  it("с полуночи по сейчас; вчера — целиком", () => {
    // Главная курьера: список доставок отдаёт только не довезённое, и
    // «Доставлено / Прогресс дня» считались из него нулём весь день.
    at("2026-09-05T12:00:00");
    const today = getPeriod("today", 0);
    expect(ymd(today.periodStart)).toBe("2026-09-05");
    expect(bizHour(today.periodStart)).toBe(0);
    expect(ymd(today.periodEnd)).toBe("2026-09-05");
    const yesterday = getPeriod("today", 1);
    expect(ymd(yesterday.periodStart)).toBe("2026-09-04");
    expect(ymd(yesterday.periodEnd)).toBe("2026-09-04");
    expect(bizHour(yesterday.periodEnd)).toBe(23);
  });

  it("месячная граница: сегодня 1-е — вчера в прошлом месяце", () => {
    at("2026-10-01T09:00:00");
    expect(ymd(getPeriod("today", 1).periodStart)).toBe("2026-09-30");
  });
});

describe("сутки — ташкентские, а не часов сервера", () => {
  /*
    Сервер живёт в UTC. По его часам месяц начинался 1-го в 05:00 по
    Ташкенту, а «сегодня» до пяти утра было вчера: заказ в 03:30 первого
    октября попадал в сентябрь.
  */
  it("в 03:30 первого октября по Ташкенту месяц — уже октябрь", () => {
    at("2026-10-01T03:30:00");
    const { periodStart, periodEnd } = getPeriod("month", 0);
    expect(periodStart.toISOString()).toBe("2026-09-30T19:00:00.000Z");
    expect(ymd(periodEnd)).toBe("2026-10-01");
  });

  it("«сегодня» начинается в ташкентскую полночь", () => {
    at("2026-10-14T03:30:00");
    expect(getPeriod("today", 0).periodStart.toISOString()).toBe("2026-10-13T19:00:00.000Z");
  });
});
