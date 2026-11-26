import { describe, it, expect } from "vitest";
import { to1CDate, from1CDate } from "../services/onec-transform";

/*
  Даты 1С — ташкентское время без пояса (бизнес-аудит 19.11.2026, п. 22).
  Доставка 1 ноября в 02:00 по Ташкенту уходила в 1С 31 октября 21:00 —
  в прошлый месяц бухгалтерии.
*/
describe("даты 1С — по Ташкенту", () => {
  it("1 ноября 02:00 по Ташкенту уходит в 1С как 1 ноября 02:00, а не 31 октября", () => {
    expect(to1CDate(new Date("2026-10-31T21:00:00Z"))).toBe("2026-11-01T02:00:00");
  });
  it("строка 1С без пояса — ташкентское время; с поясом — как есть", () => {
    expect(from1CDate("2026-11-01T02:00:00").toISOString()).toBe("2026-10-31T21:00:00.000Z");
    expect(from1CDate("2026-11-01T02:00:00Z").toISOString()).toBe("2026-11-01T02:00:00.000Z");
    expect(from1CDate("2026-11-01T02:00:00+05:00").toISOString()).toBe("2026-10-31T21:00:00.000Z");
  });
  it("туда и обратно — тот же момент", () => {
    const at = new Date("2026-11-26T12:34:56Z");
    expect(from1CDate(to1CDate(at)).getTime()).toBe(at.getTime());
  });
});
