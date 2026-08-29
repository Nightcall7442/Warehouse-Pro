/**
 * Очередь заказов, оформленных без связи.
 *
 * ── Почему у записи есть владелец ──────────────────────────────────────────
 *
 * База живёт в браузере, а не в учётной записи, и выход из системы её не
 * трогает. На складе один компьютер часто общий: агент А оформил заказы без
 * связи, вышел, вошёл агент Б — и раньше Б видел заказы А в значке очереди и
 * на странице «Офлайн». Хуже того, страница отправляет их сама при открытии,
 * а сервер ставит агентом того, кто вошёл сейчас, игнорируя присланного: чужие
 * заказы уходили от имени Б.
 *
 * Поэтому каждая запись помечена владельцем, а чтение фильтруется по нему.
 * Чистить базу при выходе было бы проще, но тогда неотправленные заказы
 * пропадали бы вместе с утечкой — а это ровно то, ради чего очередь заведена.
 *
 * В мобильном приложении это уже сделано тем же способом (ownerId).
 */
const DB_NAME    = "warehouse_pro_offline";
const DB_VERSION = 1;
const STORE      = "pending_orders";

/** Кому принадлежит запись. Записи без него остались от версии без владельцев. */
type Owned = { ownerId?: number };

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE, { keyPath: "localId", autoIncrement: true });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

export async function savePendingOrder(order: Record<string, unknown>, ownerId: number): Promise<number> {
  const db  = await openDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE, "readwrite");
    const req = tx.objectStore(STORE).add({ ...order, ownerId, savedAt: new Date().toISOString() });
    req.onsuccess = () => resolve(req.result as number);
    req.onerror   = () => reject(req.error);
  });
}

/**
 * Заказы текущего пользователя.
 *
 * Записи без владельца (сохранённые до появления этого поля) не отдаются
 * никому: привязать их к человеку задним числом нельзя, а показать первому
 * встречному — это ровно та утечка, от которой здесь защищаются. Из базы они
 * не удаляются; сколько их, показывает orphanedCount.
 */
export async function getPendingOrders(ownerId: number): Promise<Record<string, unknown>[]> {
  const db  = await openDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(
      (req.result as (Record<string, unknown> & Owned)[]).filter(o => o.ownerId === ownerId),
    );
    req.onerror   = () => reject(req.error);
  });
}

/** Сколько записей осталось от версии без владельцев — чтобы о них знать. */
export async function orphanedCount(): Promise<number> {
  const db  = await openDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(
      (req.result as (Record<string, unknown> & Owned)[]).filter(o => o.ownerId === undefined).length,
    );
    req.onerror   = () => reject(req.error);
  });
}

export async function deletePendingOrder(localId: number): Promise<void> {
  const db  = await openDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE, "readwrite");
    const req = tx.objectStore(STORE).delete(localId);
    req.onsuccess = () => resolve();
    req.onerror   = () => reject(req.error);
  });
}
