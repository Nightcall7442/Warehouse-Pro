/**
 * Точка заказа — одна формула, и тревога срабатывает на любом пути вниз.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Три формулы: порог на товаре (`<` в одних местах, `<=` в других), мёртвая
 * колонка warehouse_stock.reorder_point (никем не писалась — бот в Telegram
 * отвечал «всё в порядке», пока товар не кончится совсем) и «динамическая»
 * из скорости продаж. Тревога слалась только при ручном списании; отгрузка
 * по заказу — главный путь вниз — молчала.
 *
 * Нарочная поломка: верни в NotificationService `available < reorderPoint`
 * вместо lowStockCondition() — первый тест назовёт файл.
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

describe("одно правило", () => {
  it("все экраны, бот и сводка берут условие из services/reorder.ts, своих формул нет", () => {
    const users = ["api/services/NotificationService.ts", "api/telegram-router.ts", "api/telegram/answers.ts", "api/warehouse-router.ts"];
    for (const f of users) {
      const src = read(f);
      expect(src, `${f}: не импортирует правило`).toMatch(/from "\.{1,2}\/(services\/)?reorder"/);
      expect(src, `${f}: своя формула «<»`).not.toMatch(/available\}\s*<\s*\$\{products\.reorderPoint\}/);
    }
    // мёртвой колонки больше нет ни в схеме, ни в коде
    expect(read("db/schema.ts")).not.toMatch(/warehouse_stock[\s\S]{0,800}reorder_point/);
    expect(read("db/migrations/0038_drop_stock_reorder_point.sql").trim()).toBe("ALTER TABLE `warehouse_stock` DROP COLUMN `reorder_point`;");
    expect(read("api/warehouse-reports-router.ts")).toContain("reorderPoint: products.reorderPoint,");
    // единственное место, где порог сравнивается: > 0 и <=
    const rule = read("api/services/reorder.ts");
    expect(rule).toContain("sql`${products.reorderPoint} > 0`");
    expect(rule).toContain("sql`${warehouseStock.available} <= ${products.reorderPoint}`");
  });

  it("ручное списание тревогу больше не шлёт само — её шлёт крон раз в полчаса", () => {
    expect(read("api/services/stock.ts")).not.toContain('type: "stock.low"');
    const sched = read("api/cron/scheduler.ts");
    expect(sched).toContain('name: "low-stock-alerts"');
    expect(sched).toMatch(/name: "low-stock-alerts",\s*everyMinutes: 30/);
  });
});

describe("крон: одно уведомление на пересечение", () => {
  /** Подделка: select → заранее заданные строки; пишем через дверь (mock). */
  function fakeDb(recovered: Array<{ id: number }>, fresh: Array<Record<string, unknown>>) {
    let call = 0;
    const chain = (rows: unknown[]) => {
      const q: Record<string, unknown> = {};
      for (const m of ["from", "innerJoin", "where", "orderBy", "limit"]) q[m] = () => q;
      (q as { then: unknown }).then = (res: (v: unknown) => void) => res(rows);
      return q;
    };
    return {
      select: () => { call++; return chain(call === 1 ? recovered : call === 2 ? fresh : []); },
      execute: vi.fn(async () => [[], []]),
    } as never;
  }

  it("новое пересечение: событие, запись офису, Telegram, пометка; восстановленное — пометка снята", async () => {
    const marked: Array<[number[], Date | null]> = [];
    vi.doMock("../services/stock-ledger", () => ({ markLowStockAlerted: async (_tx: unknown, ids: number[], at: Date | null) => { marked.push([ids, at]); } }));
    const emitted: unknown[] = [];
    vi.doMock("../lib/sse", () => ({ sseBus: { emit: (e: unknown) => emitted.push(e) } }));
    const bulk = vi.fn(async () => {});
    vi.doMock("../services/NotificationService", () => ({ NotificationService: { createBulk: bulk } }));
    const tg = vi.fn(async () => ({ sent: 1, queued: 0 }));
    vi.doMock("../services/telegram-notify", () => ({ notifyEvent: tg }));

    const { runLowStockAlerts } = await import("../services/reorder");
    const fresh = [
      { tenantId: 1, stockId: 11, productId: 5, productName: "Сахар", unit: "kg", available: "3.00", reorderPoint: "10.00" },
      { tenantId: 1, stockId: 12, productId: 6, productName: "Соль", unit: "kg", available: "0.00", reorderPoint: "5.00" },
    ];
    const db = fakeDb([{ id: 99 }], fresh);
    // третий select — офис (ceo/operator)
    (db as { select: () => unknown }).select = ((orig) => { let n = 0; return () => { n++; if (n === 3) { const q: Record<string, unknown> = {}; q.from = () => q; q.where = () => q; (q as { then: unknown }).then = (res: (v: unknown) => void) => res([{ id: 7 }]); return q; } return orig(); }; })((db as { select: () => unknown }).select);

    const r = await runLowStockAlerts(db);
    expect(r).toEqual({ alerted: 2, cleared: 1, tenants: 1 });
    expect(marked).toEqual([[[99], null], [[11, 12], expect.any(Date)]]);
    expect(emitted.map(e => (e as { type: string }).type)).toEqual(["stock.low", "stock.low"]);
    expect(bulk).toHaveBeenCalledTimes(1);
    expect(tg).toHaveBeenCalledTimes(1);
    const text = (tg.mock.calls[0] as unknown as [{ text: string }])[0].text;
    expect(text).toContain("Сахар — 3 kg (порог 10)");
    expect(text).toContain("Соль — 0 kg (порог 5)");
    vi.doUnmock("../services/stock-ledger"); vi.doUnmock("../lib/sse"); vi.doUnmock("../services/NotificationService"); vi.doUnmock("../services/telegram-notify");
  });
});
