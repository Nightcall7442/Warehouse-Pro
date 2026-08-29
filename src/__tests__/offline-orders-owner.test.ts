// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";

/**
 * Очередь офлайн-заказов не должна показывать заказы одного агента другому.
 *
 * База IndexedDB живёт в браузере, а не в учётной записи: выход из системы её
 * не трогает. На складе компьютер часто общий — агент А оформил заказы без
 * связи, вышел, вошёл агент Б. Раньше Б видел заказы А и в значке очереди, и
 * на странице «Офлайн», а страница отправляет их сама при открытии. Сервер при
 * этом ставит агентом того, кто вошёл сейчас, игнорируя присланного, — то есть
 * заказы А уходили от имени Б, с его показателями и его выручкой.
 *
 * Проверка гоняет настоящий модуль хранилища поверх подделки IndexedDB:
 * подделка нужна потому, что в jsdom своего IndexedDB нет, а тащить ради
 * одной проверки новую зависимость — значит трогать файл блокировки.
 */

// ── Подделка IndexedDB ───────────────────────────────────────────────────────
// Ровно то, чем пользуется модуль: open, transaction, objectStore, add, getAll,
// delete. Обработчики вызываются в следующем такте, как в настоящем API.

type Row = Record<string, unknown> & { localId: number };

let rows: Row[] = [];
let nextId = 1;

function request<T>(compute: () => T) {
  const req: {
    result?: T;
    error?: unknown;
    onsuccess?: () => void;
    onerror?: () => void;
    onupgradeneeded?: () => void;
  } = {};
  queueMicrotask(() => {
    try {
      req.result = compute();
      req.onsuccess?.();
    } catch (e) {
      req.error = e;
      req.onerror?.();
    }
  });
  return req;
}

const store = {
  add: (value: Record<string, unknown>) =>
    request(() => {
      const localId = nextId++;
      rows.push({ ...value, localId });
      return localId;
    }),
  getAll: () => request(() => rows.slice()),
  delete: (localId: number) =>
    request(() => {
      rows = rows.filter(r => r.localId !== localId);
      return undefined;
    }),
};

beforeEach(() => {
  rows = [];
  nextId = 1;
  (globalThis as unknown as { indexedDB: unknown }).indexedDB = {
    open: () =>
      request(() => ({
        createObjectStore: () => store,
        transaction: () => ({ objectStore: () => store }),
      })),
  };
});

const АГЕНТ_А = 11;
const АГЕНТ_Б = 22;

async function helpers() {
  return await import("@/pages/OfflineOrders.helpers");
}

describe("Очередь офлайн-заказов", () => {
  it("не отдаёт заказы одного агента другому", async () => {
    const { savePendingOrder, getPendingOrders } = await helpers();

    await savePendingOrder({ shopName: "Магазин А", total: "500000" }, АГЕНТ_А);
    await savePendingOrder({ shopName: "Магазин А-2", total: "120000" }, АГЕНТ_А);
    await savePendingOrder({ shopName: "Магазин Б", total: "90000" }, АГЕНТ_Б);

    const свои = await getPendingOrders(АГЕНТ_Б);

    // До правки здесь оказывались все три: чтение не фильтровалось вовсе.
    expect(свои).toHaveLength(1);
    expect(свои[0].shopName).toBe("Магазин Б");
  });

  it("возвращает заказы владельцу, когда он входит снова", async () => {
    const { savePendingOrder, getPendingOrders } = await helpers();

    await savePendingOrder({ shopName: "Магазин А", total: "500000" }, АГЕНТ_А);

    // Смысл именно в этом: чистить базу при выходе было бы проще, но тогда
    // неотправленный заказ пропал бы — а очередь заведена ровно ради него.
    expect(await getPendingOrders(АГЕНТ_Б)).toHaveLength(0);
    expect(await getPendingOrders(АГЕНТ_А)).toHaveLength(1);
  });

  it("не отдаёт никому записи, оставшиеся без владельца", async () => {
    const { getPendingOrders, orphanedCount } = await helpers();

    // Запись из версии, где поля владельца ещё не было.
    rows.push({ localId: 99, shopName: "Из прошлой версии", total: "1000" });

    expect(await getPendingOrders(АГЕНТ_А)).toHaveLength(0);
    expect(await getPendingOrders(АГЕНТ_Б)).toHaveLength(0);
    // Из базы они не выбрасываются — о них можно узнать.
    expect(await orphanedCount()).toBe(1);
  });
});
