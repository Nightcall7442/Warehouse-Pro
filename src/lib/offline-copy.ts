/**
 * Копия справочников на устройстве — чтобы без связи было из чего собрать заказ.
 *
 * ── Зачем ──────────────────────────────────────────────────────────────────
 *
 * Вкладка «Офлайн» держала только те заказы, которые агент успел оформить при
 * связи. Собрать заказ БЕЗ связи было не из чего: каталог и магазины
 * приезжают запросами, а служебному работнику запрещено кэшировать ответы
 * API. Агент в подсобке видел пустые экраны, и офлайн-режим оставался
 * наполовину декоративным.
 *
 * ── Почему не служебный работник ───────────────────────────────────────────
 *
 * В vite.config.ts стоит осознанное решение: ответы tRPC не кэшировать, чтобы
 * данные организации не оседали в Cache Storage. Отменять его нельзя, да и не
 * получится аккуратно: запросы чтения уходят ПАЧКОЙ, одним адресом на
 * несколько процедур, и «закэшировать только каталог» по адресу не выйдет —
 * вместе с ним осел бы весь пакет, чем бы он ни оказался.
 *
 * Поэтому копия делается здесь, руками и поимённо: ровно два набора, оба и так
 * лежат у агента в руках весь день.
 *
 *   • каталог товаров — без закупочной цены: product.listAll её не отдаёт
 *     намеренно, чтобы закупочная не оказалась в телефоне у того, кто торгуется
 *     с магазином;
 *   • магазины агента — те же, что он видит на своей вкладке.
 *
 * Ни заказов, ни выручки, ни сотрудников, ни настроек организации здесь нет.
 *
 * ── Общее устройство ───────────────────────────────────────────────────────
 *
 * Ключ включает владельца: на складе телефон и компьютер бывают общими, и
 * вошедший следующим не должен увидеть справочники предыдущего. При выходе
 * копия стирается целиком — clearOfflineCopies вызывается из useAuth.
 */

const PREFIX = "wp.offline";

/*
  Кто сейчас за устройством.

  Живёт здесь, а не в useAuth, нарочно. Копии нужны каталогу и списку товаров
  в мастере заказа — обычным компонентам, у которых ни роутера, ни запроса
  auth.me нет и быть не должно. Взяв владельца из useAuth, каталог потянул бы
  за собой и то и другое: проверено — тесты на выдвижную корзину сразу упали с
  «useNavigate может использоваться только внутри Router».

  Значение кладёт useAuth, когда личность приходит с сервера, и снимает при
  выходе. Прав оно не даёт и ничего не удостоверяет — только разделяет копии
  между теми, кто входил на этом устройстве.
*/
const OWNER = "wp.offline.owner";

export function setSessionOwner(id: number | null): void {
  try {
    if (id == null) localStorage.removeItem(OWNER);
    else localStorage.setItem(OWNER, String(id));
  } catch { /* приватный режим — копий просто не будет */ }
}

/** Владелец копий или null, если на этом устройстве ещё не входили. */
export function currentOwnerId(): number | null {
  try {
    const raw = localStorage.getItem(OWNER);
    if (!raw) return null;
    const n = Number(raw);
    return Number.isInteger(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

/** Что разрешено класть на устройство. Список закрытый — это его смысл. */
export type OfflineKind = "catalog" | "shops";

type Envelope<T> = { savedAt: string; data: T };

const keyFor = (kind: OfflineKind, ownerId: number) => `${PREFIX}.${kind}.${ownerId}`;

/**
 * Отложить копию. Молча ничего не делает, если места нет.
 *
 * Хранилище бывает недоступно: приватное окно, запрет на данные сайта,
 * переполнение. Копия — подстраховка, а не работа: ронять из-за неё экран,
 * который прямо сейчас прекрасно работает по сети, нельзя.
 */
export function saveOfflineCopy<T>(kind: OfflineKind, ownerId: number, data: T): void {
  try {
    const envelope: Envelope<T> = { savedAt: new Date().toISOString(), data };
    localStorage.setItem(keyFor(kind, ownerId), JSON.stringify(envelope));
  } catch { /* не поместилось — не беда */ }
}

/** Достать копию. null — копии нет или она от другой версии. */
export function loadOfflineCopy<T>(kind: OfflineKind, ownerId: number): { data: T; savedAt: string } | null {
  try {
    const raw = localStorage.getItem(keyFor(kind, ownerId));
    if (!raw) return null;
    const envelope = JSON.parse(raw) as Envelope<T>;
    if (!envelope || typeof envelope.savedAt !== "string" || envelope.data == null) return null;
    return { data: envelope.data, savedAt: envelope.savedAt };
  } catch {
    // Разбор не удался — запись от другой версии. Молча забываем: показать
    // непонятное хуже, чем показать пусто.
    return null;
  }
}

/**
 * Стереть все копии этого устройства.
 *
 * Вызывается при выходе. Не по владельцу, а целиком: выходящий может быть не
 * тем, чьи копии лежат (сессия истекла, вошли под другим), и оставлять чужое
 * на общем устройстве — ровно та утечка, от которой здесь защищаются.
 */
export function clearOfflineCopies(): void {
  try {
    const doomed: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(PREFIX + ".")) doomed.push(k);
    }
    for (const k of doomed) localStorage.removeItem(k);
  } catch { /* нет хранилища — нечего и стирать */ }
}
