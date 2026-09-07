/**
 * Обмен с 1С не выдаёт документ первой жизни за выгрузку второй.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Повторная выгрузка заказа намеренно не создаёт документ заново, а
 * до-проводит сохранённый: так закрыт случай с таймаутом, когда «Реализация» в
 * 1С уже появилась, а наружу улетела ошибка и директор нажал синхронизацию
 * второй раз. Без этого в 1С заводился ВТОРОЙ документ на тот же заказ, и
 * после проведения обоих дважды списывались остатки и дважды считалась
 * выручка.
 *
 * У этого хода была вторая сторона. Заказ можно вернуть из архива в работу —
 * он начинает второй круг под тем же номером, и состав с суммой у него уже
 * другие. Связь оставалась от первого круга, синхронизация покорно
 * перепроводила СТАРЫЙ документ и писала «выполнено». В 1С — первая
 * накладная, в Warehouse Pro — вторая, и ни одна сторона об этом не сообщала.
 *
 * ── Как это отличается от таймаута ──────────────────────────────────────────
 *
 * По времени. order-reopen двигает created_at заказа на день возврата в
 * работу; last_synced_at остался от выгрузки первого круга. У обычного заказа
 * порядок обратный — сначала оформили, потом выгрузили, — и повтор после
 * таймаута обязан по-прежнему просто до-проводить.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const bridge = {
  odataQuery: vi.fn().mockResolvedValue([]),
  createDocument: vi.fn().mockResolvedValue({ id: "doc-НОВЫЙ" }),
  postDocument: vi.fn().mockResolvedValue(undefined),
  healthCheck: vi.fn().mockResolvedValue(true),
};

vi.mock("../lib/onec-bridge", () => ({
  getBridge: () => bridge,
  getBridgeForTenant: () => Promise.resolve(bridge),
}));
vi.mock("../lib/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock("../lib/metrics", () => ({ record1CSync: vi.fn() }));
vi.mock("../services/onec-status", () => ({ updateSyncStatus: vi.fn().mockResolvedValue(undefined) }));

/**
 * Заказ и его позиции читаются обычным построителем; подменяется он целиком.
 *
 * Строк здесь ровно столько, сколько нужно службе: сам заказ и одна позиция.
 * Порядок вызовов select у службы известен и не меняется — сначала заказ,
 * потом позиции, — поэтому очередь ответов задаётся списком.
 */
const selectQueue: unknown[][] = [];
vi.mock("../queries/connection", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        leftJoin: () => ({ where: () => Promise.resolve(selectQueue.shift() ?? []) }),
        where: () => ({
          limit: () => Promise.resolve(selectQueue.shift() ?? []),
        }),
      }),
    }),
    insert: () => ({ values: () => Promise.resolve([{ insertId: 1 }]) }),
    update: () => ({ set: () => ({ where: () => Promise.resolve({}) }) }),
    delete: () => ({ where: () => Promise.resolve({}) }),
  }),
}));

const mapper = {
  getInternalId: vi.fn().mockResolvedValue(null),
  getExternalId: vi.fn().mockResolvedValue(null),
  getMapping: vi.fn(),
  forget: vi.fn().mockResolvedValue(undefined),
  upsert: vi.fn().mockResolvedValue(undefined),
  getAll: vi.fn().mockResolvedValue([]),
};
vi.mock("../services/onec-mapper", () => ({ OneCMapper: mapper }));

const ORDERED = new Date("2026-01-10T09:00:00Z");
const SYNCED  = new Date("2026-01-10T09:05:00Z");
const REOPENED = new Date("2026-03-01T11:00:00Z");

/** Заказ, каким его читает служба, и одна его позиция. */
function queueOrder(createdAt: Date) {
  selectQueue.length = 0;
  selectQueue.push([{
    id: 7, status: "new", total: "500.00", orderNumber: "№7",
    shopId: 3, createdAt,
  }]);
  selectQueue.push([{
    productId: 11, quantity: "5", unitPrice: "100.00", unit: "pcs", unitWeight: "1.0",
  }]);
}

beforeEach(() => {
  vi.clearAllMocks();
  bridge.createDocument.mockResolvedValue({ id: "doc-НОВЫЙ" });
  bridge.postDocument.mockResolvedValue(undefined);
  // Магазин и товар сопоставлены — иначе выгрузка откажет раньше и не по делу.
  mapper.getExternalId.mockResolvedValue("ext-сопоставлено");
});

describe("выгрузка заказа в 1С", () => {
  it("после таймаута до-проводит прежний документ, а не создаёт второй", async () => {
    // Заказ оформили в 09:00, выгрузили в 09:05. Второй жизни нет.
    queueOrder(ORDERED);
    mapper.getMapping.mockResolvedValue({ externalId: "doc-ПЕРВЫЙ", lastSyncedAt: SYNCED });

    const { oneCSync } = await import("../services/onec-sync");
    await oneCSync.syncOrderTo1C(1, 7);

    expect(bridge.createDocument, "завёлся второй документ на тот же заказ").not.toHaveBeenCalled();
    expect(bridge.postDocument).toHaveBeenCalledWith("Document_РеализацияТоваровИУслуг", "doc-ПЕРВЫЙ");
  });

  it("после возврата в работу отказывает вместо тихой перевыгрузки", async () => {
    // Выгрузили в январе, вернули в работу в марте: created_at стал мартовским.
    queueOrder(REOPENED);
    mapper.getMapping.mockResolvedValue({ externalId: "doc-ПЕРВЫЙ", lastSyncedAt: SYNCED });

    const { oneCSync } = await import("../services/onec-sync");
    await expect(oneCSync.syncOrderTo1C(1, 7)).rejects.toThrow(/возвращали в работу/);

    expect(bridge.postDocument, "старый документ всё-таки перепровели").not.toHaveBeenCalled();
    expect(bridge.createDocument).not.toHaveBeenCalled();
  });

  it("отказ называет заказ и говорит, что делать", async () => {
    queueOrder(REOPENED);
    mapper.getMapping.mockResolvedValue({ externalId: "doc-ПЕРВЫЙ", lastSyncedAt: SYNCED });

    const { oneCSync } = await import("../services/onec-sync");
    const err = await oneCSync.syncOrderTo1C(1, 7).catch((e: Error) => e);

    expect(String(err)).toContain("№7");
    expect(String(err)).toMatch(/разберите прежний документ в 1С/i);
  });

  it("по прямому решению директора выгружает заказ новым документом", async () => {
    queueOrder(REOPENED);
    mapper.getMapping.mockResolvedValue({ externalId: "doc-ПЕРВЫЙ", lastSyncedAt: SYNCED });

    const { oneCSync } = await import("../services/onec-sync");
    await oneCSync.syncOrderTo1C(1, 7, { asNewDocument: true });

    // Связь забыта, документ создан заново и проведён именно новый.
    expect(mapper.forget).toHaveBeenCalledWith(expect.anything(), 1, "order", 7);
    expect(bridge.createDocument).toHaveBeenCalled();
    expect(bridge.postDocument).toHaveBeenCalledWith("Document_РеализацияТоваровИУслуг", "doc-НОВЫЙ");
  });

  it("заказ без связи выгружается как раньше", async () => {
    // Страховка от «зелёного ни на чём»: обычный путь не должен пострадать.
    queueOrder(ORDERED);
    mapper.getMapping.mockResolvedValue(null);

    const { oneCSync } = await import("../services/onec-sync");
    await oneCSync.syncOrderTo1C(1, 7);

    expect(bridge.createDocument).toHaveBeenCalled();
    expect(mapper.forget).not.toHaveBeenCalled();
  });

  it("связь без отметки времени не считается устаревшей", async () => {
    // last_synced_at может оказаться пустым у строк, заведённых до того, как
    // колонку начали заполнять. Отказывать по незнанию нельзя — это остановило
    // бы обмен у тех, у кого он работал.
    queueOrder(REOPENED);
    mapper.getMapping.mockResolvedValue({ externalId: "doc-ПЕРВЫЙ", lastSyncedAt: null });

    const { oneCSync } = await import("../services/onec-sync");
    await oneCSync.syncOrderTo1C(1, 7);

    expect(bridge.postDocument).toHaveBeenCalledWith("Document_РеализацияТоваровИУслуг", "doc-ПЕРВЫЙ");
  });
});
