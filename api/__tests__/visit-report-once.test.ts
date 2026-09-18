/**
 * Отчёт мерчандайзера по плану — один.
 *
 * Отчёт с чек-листом на сотни строк шёл с телефона с таймаутом 15 с: на
 * слабой связи в магазине ответ рвался после того, как сервер уже вставил
 * строку, мерчандайзер жал «повторить» — и по одному визиту выходило два
 * отчёта в контроле. Повтор теперь возвращает первый отчёт.
 */
import { describe, it, expect, vi } from "vitest";
import { visitReports, dailyPlans } from "@db/schema";

vi.mock("../lib/cache", () => ({ cache: { invalidate: vi.fn() }, CacheKeys: { dashboardKpis: (t: number) => `kpis:${t}` } }));

import { MerchandiserService } from "../services/merchandiser";

/** Двойник базы: планы и отчёты по таблицам, вставка возвращает растущий id. */
function fakeDb() {
  const rows = new Map<unknown, Record<string, unknown>[]>([
    [dailyPlans, [{ id: 5, tenantId: 1, agentId: 10, status: "planned", visitedAt: null }]],
    [visitReports, []],
  ]);
  let nextId = 100;
  const chain = (get: () => unknown[]): any => new Proxy(() => {}, {
    get(_t, prop) {
      if (prop === "then") return (res: (v: unknown) => void, rej: (e: unknown) => void) => Promise.resolve(get()).then(res, rej);
      if (prop === "from") return (table: unknown) => chain(() => rows.get(table) ?? []);
      return () => chain(get);
    },
  });
  return {
    rows,
    select: () => chain(() => []),
    insert: (table: unknown) => ({
      values: async (v: Record<string, unknown>) => {
        const id = nextId++;
        rows.get(table)!.push({ id, ...v });
        return [{ insertId: id }];
      },
    }),
    update: () => ({ set: (patch: Record<string, unknown>) => ({ where: async () => { Object.assign(rows.get(dailyPlans)![0], patch); } }) }),
  };
}

const input = { planId: 5, shopId: 3, photos: ["https://s3/visits/1.jpg"], checklist: [] };

describe("merchandiser.submitReport", () => {
  it("повтор по тому же плану возвращает первый отчёт, второй строки нет", async () => {
    const db = fakeDb();
    const first = await MerchandiserService.submitReport(db as never, 1, 10, input);
    const again = await MerchandiserService.submitReport(db as never, 1, 10, input);
    expect(first).toEqual({ success: true, reportId: 100 });
    expect(again).toEqual({ success: true, reportId: 100, duplicate: true });
    expect(db.rows.get(visitReports)!).toHaveLength(1);
  });

  it("чужой план — отказ, как и раньше", async () => {
    const db = fakeDb();
    await expect(MerchandiserService.submitReport(db as never, 1, 11, input)).rejects.toThrow("другому сотруднику");
    expect(db.rows.get(visitReports)!).toHaveLength(0);
  });
});
