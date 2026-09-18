import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { moneyEveningText } from "../cron/money-evening";

/**
 * Вечерняя сводка «деньги в поле» — директору в Telegram (вместо кассовой):
 * молчит, когда сдавать нечего; называет очередь и людей с наличными; больше
 * суток — с пометкой; ведёт в «Ждут расчёта». Работа стоит в расписании.
 */
const money = (o: Partial<Parameters<typeof moneyEveningText>[0]>) => ({ onHands: [], awaiting: { count: 0, total: 0, oldestAt: null }, ...o });

describe("вечерняя сводка", () => {
  it("молчит, когда очередь пуста и на руках ничего", () => {
    expect(moneyEveningText(money({}))).toBeNull();
  });
  it("очередь, люди с наличными, возраст, куда идти; имена экранируются", () => {
    const t = moneyEveningText(money({
      awaiting: { count: 7, total: 8_400_000, oldestAt: new Date() },
      onHands: [{ userId: 3, name: "Ботир <b>", amount: 3_100_000, since: new Date(), orders: 3, hours: 49 }, { userId: 4, name: "Азиз", amount: 500_000, since: new Date(), orders: 1, hours: 2 }],
    }))!;
    expect(t).toContain("Ждут расчёта: <b>7</b>");
    expect(t).toContain("Ботир &lt;b&gt; — ");
    expect(t).toContain("3 зак. ⚠️ 2 дн.");
    expect(t).toContain("Азиз — ");
    expect(t).not.toContain("Азиз — 500 000 сум · 1 зак. ⚠️");
    expect(t).toContain("«Ждут расчёта»");
  });
  it("работа в расписании в 19:30, а кассовой больше нет", () => {
    const sched = readFileSync(join(process.cwd(), "api/cron/scheduler.ts"), "utf8");
    expect(sched).toMatch(/name: "money-evening",\s*daily: \{ hour: 19, minute: 30 \}/);
    expect(sched).not.toContain("cash-evening");
  });
});
