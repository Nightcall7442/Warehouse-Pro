/**
 * Убрать точку из работы — не то же самое, что стереть её.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Одна кнопка «Удалить» с двумя исходами, и какой достанется, решал случай:
 *
 *   • есть заказы или оплаты → внешний ключ не давал стереть строку, и
 *     обработчик молча ставил status = 'inactive';
 *   • заказов ещё нет → DELETE проходил, и магазин исчезал вместе с адресом,
 *     координатами, фотографией и историей визитов.
 *
 * Окно подтверждения обещало одно и то же: «данные будут удалены безвозвратно».
 * Директор отмечал двадцать точек — часть уничтожалась, часть пряталась,
 * оставаясь в списке неотличимой от живой. Вернуть нельзя было ни ту, ни другую.
 *
 * ── Что проверяется ─────────────────────────────────────────────────────────
 *
 * Три правила, каждое из которых стоило бы денег, если его нарушить:
 *
 *   1. архивация НИКОГДА не удаляет строку;
 *   2. стереть насовсем можно только точку, за которой ничего не числится, —
 *      и отказ называет, что именно мешает;
 *   3. архивация НЕ трогает долг: убрать должника с глаз — не то же самое,
 *      что простить ему деньги.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../queries/connection", () => ({ getDb: vi.fn() }));

import { getDb } from "../queries/connection";
import {
  archiveShops, restoreShop, deleteShopForever, shopTrace,
  ShopHasHistoryError, traceSummary,
} from "../services/shop-archive";

/**
 * Поддельная база ровно под те запросы, что делает модуль.
 *
 * `counts` — сколько строк «лежит» в зависимых таблицах: они читаются в том же
 * порядке, в каком объявлены DEPENDENTS, и подделке достаточно отдавать их
 * очередью.
 */
function fakeDb(opts: { shop?: { debt: string } | null; counts?: number[]; targets?: Array<{ id: number; debt: string }> }) {
  const counts = [...(opts.counts ?? Array(9).fill(0))];
  const calls = { updates: [] as unknown[], deletes: 0 };
  let selectShape: "shop" | "count" | "targets" = "shop";

  const db = {
    select: vi.fn((shape?: Record<string, unknown>) => {
      // Различаем запросы по составу выбираемых столбцов — так же, как их
      // различил бы человек, читая код модуля.
      if (shape && "n" in shape) selectShape = "count";
      else if (shape && "debt" in shape && "id" in shape) selectShape = "targets";
      else if (shape && "debt" in shape) selectShape = "shop";
      else selectShape = "shop";
      return db;
    }),
    from: vi.fn(() => db),
    limit: vi.fn(() => (selectShape === "shop" ? (opts.shop ? [opts.shop] : []) : [])),
    where: vi.fn(() => {
      if (selectShape === "count") return [{ n: counts.shift() ?? 0 }];
      if (selectShape === "targets") return opts.targets ?? [];
      return db;
    }),
    update: vi.fn(() => db),
    set: vi.fn((values: unknown) => { calls.updates.push(values); return db; }),
    delete: vi.fn(() => { calls.deletes++; return { where: vi.fn(() => undefined) }; }),
  } as unknown as Record<string, ReturnType<typeof vi.fn>> & { __calls: typeof calls };

  // `where` у update/delete завершает цепочку, у select — отдаёт строки.
  // Разделять их незачем: обе ветви разведены по selectShape выше.
  (db as unknown as { __calls: typeof calls }).__calls = calls;
  return { db, calls };
}

describe("архивация не удаляет", () => {
  beforeEach(() => vi.clearAllMocks());

  it("убирает точки в архив, оставляя строку на месте", async () => {
    const { db, calls } = fakeDb({ targets: [{ id: 7, debt: "0.00" }] });
    vi.mocked(getDb).mockReturnValue(db as never);

    const result = await archiveShops(1, [7], 42, "закрылся");

    expect(result.archived).toBe(1);
    expect(calls.deletes, "архивация стёрла строку").toBe(0);
    const written = calls.updates[0] as Record<string, unknown>;
    expect(written.status).toBe("inactive");
    expect(written.archivedBy).toBe(42);
    expect(written.archiveReason).toBe("закрылся");
    expect(written.archivedAt).toBeInstanceOf(Date);
    // Долг не в списке записываемых полей — и это главное в этой проверке.
    expect(Object.keys(written)).not.toContain("debt");
  });

  it("причина из одних пробелов не выдаётся за указанную", async () => {
    const { db, calls } = fakeDb({ targets: [{ id: 7, debt: "0.00" }] });
    vi.mocked(getDb).mockReturnValue(db as never);

    await archiveShops(1, [7], 42, "   ");

    expect((calls.updates[0] as Record<string, unknown>).archiveReason).toBeNull();
  });

  it("считает должников среди убранных — чтобы сказать о них вслух", async () => {
    const { db } = fakeDb({ targets: [
      { id: 1, debt: "150000.00" },
      { id: 2, debt: "0.00" },
      { id: 3, debt: "40000.50" },
    ] });
    vi.mocked(getDb).mockReturnValue(db as never);

    const result = await archiveShops(1, [1, 2, 3], 42);

    expect(result.archived).toBe(3);
    expect(result.withDebt).toBe(2);
    expect(result.debtTotal).toBeCloseTo(190000.5, 2);
  });

  it("пустой список не трогает базу", async () => {
    const { db, calls } = fakeDb({});
    vi.mocked(getDb).mockReturnValue(db as never);

    const result = await archiveShops(1, [], 42);

    expect(result.archived).toBe(0);
    expect(calls.updates).toHaveLength(0);
    expect(calls.deletes).toBe(0);
  });

  it("возврат в работу снимает метки архива", async () => {
    const { db, calls } = fakeDb({ shop: { debt: "0.00" } });
    vi.mocked(getDb).mockReturnValue(db as never);

    await restoreShop(1, 7);

    const written = calls.updates[0] as Record<string, unknown>;
    expect(written.status).toBe("active");
    // Иначе вернувшаяся точка носила бы дату, которая уже ничего не означает,
    // и следующий архив нечем было бы отличить от прошлого.
    expect(written.archivedAt).toBeNull();
    expect(written.archivedBy).toBeNull();
    expect(written.archiveReason).toBeNull();
  });
});

describe("стереть можно только то, за чем ничего не числится", () => {
  beforeEach(() => vi.clearAllMocks());

  it("точка без единой ссылки удаляется", async () => {
    const { db, calls } = fakeDb({ shop: { debt: "0.00" }, counts: Array(9).fill(0) });
    vi.mocked(getDb).mockReturnValue(db as never);

    const trace = await deleteShopForever(1, 7);

    expect(trace.total).toBe(0);
    expect(calls.deletes).toBe(1);
  });

  it("точка с историей не удаляется, а отказ называет причину", async () => {
    // 14 заказов и 3 оплаты — порядок тот же, что у DEPENDENTS.
    const { db, calls } = fakeDb({ shop: { debt: "0.00" }, counts: [14, 3, 0, 0, 0, 0, 0, 0, 0] });
    vi.mocked(getDb).mockReturnValue(db as never);

    await expect(deleteShopForever(1, 7)).rejects.toBeInstanceOf(ShopHasHistoryError);
    expect(calls.deletes, "строку всё-таки стёрли").toBe(0);
  });

  it("в отказе перечислено, что именно мешает", async () => {
    const { db } = fakeDb({ shop: { debt: "0.00" }, counts: [14, 3, 0, 0, 0, 0, 0, 0, 0] });
    vi.mocked(getDb).mockReturnValue(db as never);

    const err = await deleteShopForever(1, 7).catch(e => e as ShopHasHistoryError);

    expect(err).toBeInstanceOf(ShopHasHistoryError);
    const message = (err as ShopHasHistoryError).message;
    // «Нельзя» без объяснения ничем не помогает: человеку нужно понять, почему
    // и что делать вместо этого.
    expect(message).toContain("заказы — 14");
    expect(message).toContain("платежи — 3");
    expect(message).toContain("архив");
  });

  it("перечень читается по-человечески", () => {
    expect(traceSummary({ counts: { "заказы": 14, "платежи": 3 }, total: 17, debt: 0 }))
      .toBe("заказы — 14, платежи — 3");
  });

  it("несуществующая точка не молчит", async () => {
    const { db } = fakeDb({ shop: null });
    vi.mocked(getDb).mockReturnValue(db as never);

    await expect(shopTrace(1, 999)).resolves.toBeNull();
    await expect(deleteShopForever(1, 999)).rejects.toThrow("не найден");
  });
});
