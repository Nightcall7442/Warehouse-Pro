/**
 * Подсказка «Просрочено партий» не выдаёт закупку тем, кому её не видно.
 *
 * Подсказки на главной получают директор, супервайзер и оператор, а сумма
 * «по себестоимости» — это закупка. Закупку видит только директор
 * (expiry-plan.seesCost — то же правило у «Сроков» и «Прибыли»), иначе
 * супервайзер узнавал её с главной, хотя на экране сроков её не видел.
 */
import { describe, it, expect } from "vitest";
import { expiredStockMessage } from "../services/NotificationService";

const ru = (r: string) => r;
const uz = (_r: string, u: string) => u;

describe("expiredStockMessage — сумма по закупке только директору", () => {
  it("директор видит сумму по себестоимости", () => {
    const m = expiredStockMessage(429600, "ceo", ru);
    expect(m).toMatch(/по себестоимости/);
    expect(m).toContain((429600).toLocaleString("ru"));
  });

  it.each(["supervisor", "operator", "agent", "courier", "merchandiser", ""])("%s — без суммы и без слова «себестоимость»", role => {
    const m = expiredStockMessage(429600, role, ru);
    expect(m).toBe("Списать, в отгрузку не уйдут");
    expect(m).not.toMatch(/\d/);
    expect(expiredStockMessage(429600, role, uz)).not.toMatch(/Tannarx|\d/);
  });

  it("без суммы у партий — у директора тоже без цифр", () => {
    expect(expiredStockMessage(0, "ceo", ru)).toBe("Списать, в отгрузку не уйдут");
  });
});
