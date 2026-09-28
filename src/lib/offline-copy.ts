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
 * Поэтому копия делается здесь, руками и поимённо: ровно три набора, все и так
 * лежат у агента в руках весь день.
 *
 *   • каталог товаров — без закупочной цены: product.listAll её не отдаёт
 *     намеренно, чтобы закупочная не оказалась в телефоне у того, кто торгуется
 *     с магазином; цены в нём — карточки;
 *   • цены магазина — по копии на магазин: цена при одной штуке и ступени
 *     «от N». Без них после перезагрузки без связи заказ считался по цене
 *     одной штуки мимо ступеней;
 *   • магазины агента — те же, что он видит на своей вкладке.
 *
 * Ни заказов, ни выручки, ни сотрудников, ни настроек организации здесь нет.
 *
 * ── Общее устройство ───────────────────────────────────────────────────────
 *
 * Ключ включает владельца: на складе телефон и компьютер бывают общими, и
 * вошедший следующим не должен увидеть справочники предыдущего. При выходе
 * копия стирается целиком — clearOfflineCopies вызывается из useAuth, а когда
 * входит другой, setSessionOwner убирает копии всех прежних.
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
    if (id == null) { localStorage.removeItem(OWNER); return; }
    localStorage.setItem(OWNER, String(id));
    /*
      Вошёл человек — копии всех прочих уходят.

      Стирались они только в «Выйти», а на общем компьютере сессия чаще
      истекает, чем её закрывают. Копии прежнего (каталог — больше мегабайта
      на 3000 товаров, да цены магазинов до мегабайта) лежали под его номером
      навсегда, следующий добавлял свои, и двух-трёх сменщиков хватало, чтобы
      упереться в квоту хранилища (около 5 МБ). Тогда молча переставал
      сохраняться черновик заказа — ровно то, от чего бережёт SCOPED_BUDGET.
      Прежнему копии ни к чему: без связи он не войдёт, а со связью они
      снимутся заново.

      Черновики заказа и прихода чужих не трогаем: это набранная работа, а не
      справочник, и лежат они под своими ключами, не под PREFIX.
    */
    const mine = String(id);
    const doomed: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      // Ключ копии — PREFIX.<набор>.<владелец>[.<магазин>]; OWNER владельца не несёт.
      if (k && k !== OWNER && k.startsWith(PREFIX + ".") && k.split(".")[3] !== mine) doomed.push(k);
    }
    for (const k of doomed) localStorage.removeItem(k);
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
export type OfflineKind = "catalog" | "shops" | "shopPrices";

type Envelope<T> = { savedAt: string; data: T };

/** scope — магазин для копий «по магазину»; у общих наборов его нет. */
const keyFor = (kind: OfflineKind, ownerId: number, scope?: number) =>
  `${PREFIX}.${kind}.${ownerId}` + (scope == null ? "" : `.${scope}`);

/*
  Копий по магазинам — не больше SCOPED_MAX и не больше SCOPED_BUDGET знаков
  на набор, лишние — самые старые. Агент за неделю проходит сотни магазинов,
  а хранилище у сайта одно на всё: переполнись оно копиями — молча перестал
  бы сохраняться черновик заказа.
*/
export const SCOPED_MAX = 20;
export const SCOPED_BUDGET = 1_000_000;

/*
  Дата копии — с начала строки, без JSON.parse. savedAt — первый ключ
  конверта (см. saveOfflineCopy), а разбирать ради него соседние копии
  целиком — до 19 записей по десяткам и сотням КБ на каждое сохранение, дважды
  на ответ сервера и в основном потоке — незачем.
*/
const SAVED_AT = /^\{"savedAt":"([^"]*)"/;
const savedAtOf = (raw: string): string => SAVED_AT.exec(raw)?.[1] ?? "";

function pruneScoped(kind: OfflineKind, ownerId: number, keep: string, incoming: number): void {
  const prefix = keyFor(kind, ownerId) + ".";
  const others: { key: string; raw: string }[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key !== keep && key.startsWith(prefix)) others.push({ key, raw: localStorage.getItem(key) ?? "" });
  }
  // Свежие первыми: ISO-даты сравниваются как строки.
  others.sort((a, b) => savedAtOf(b.raw).localeCompare(savedAtOf(a.raw)));
  let count = 1, used = incoming;
  for (const o of others) {
    if (count < SCOPED_MAX && used + o.raw.length <= SCOPED_BUDGET) { count++; used += o.raw.length; }
    else localStorage.removeItem(o.key);
  }
}

/**
 * Отложить копию. Молча ничего не делает, если места нет.
 *
 * Хранилище бывает недоступно: приватное окно, запрет на данные сайта,
 * переполнение. Копия — подстраховка, а не работа: ронять из-за неё экран,
 * который прямо сейчас прекрасно работает по сети, нельзя.
 */
export function saveOfflineCopy<T>(kind: OfflineKind, ownerId: number, data: T, scope?: number): void {
  try {
    const key = keyFor(kind, ownerId, scope);
    // savedAt — первым: savedAtOf читает дату с начала строки.
    const envelope: Envelope<T> = { savedAt: new Date().toISOString(), data };
    const raw = JSON.stringify(envelope);
    if (scope != null) pruneScoped(kind, ownerId, key, raw.length);
    localStorage.setItem(key, raw);
  } catch { /* не поместилось — не беда */ }
}

/*
  Общая копия каталога отдаётся только по цене карточки — при любом чтении.

  Прежняя версия писала сюда ответ с ценами магазина, у которого заказывали
  последним: его прайс-лист и ступени. Такие копии ещё лежат на устройствах, и
  без связи другой магазин и витрина показывали и считали чужие цены — и в
  строке, и в офлайн-итоге. Цены магазина — только из его собственной копии
  (shopPrices); у кого её нет, тому карточка, но никогда не чужая цена.
  Приводится здесь, а не в каждом экране: читателей у копии двое (каталог и
  выбор товаров в заказе), и третий забыл бы.

  Строка без basePrice — от ещё более ранней версии: basePrice пришёл тем же
  выпуском, что и цены магазина в каталоге, так что в ней и так карточка.
*/
function atCardPrice<T>(data: T): T {
  if (!Array.isArray(data)) return data;
  return data.map((p: { unitPrice?: unknown; basePrice?: unknown } | null) =>
    p?.unitPrice === undefined ? p : { ...p, unitPrice: p.basePrice ?? p.unitPrice, priceListId: null, tiers: null }) as T;
}

/** Достать копию. null — копии нет или она от другой версии. */
export function loadOfflineCopy<T>(kind: OfflineKind, ownerId: number, scope?: number): { data: T; savedAt: string } | null {
  try {
    const raw = localStorage.getItem(keyFor(kind, ownerId, scope));
    if (!raw) return null;
    const envelope = JSON.parse(raw) as Envelope<T>;
    if (!envelope || typeof envelope.savedAt !== "string" || envelope.data == null) return null;
    return { data: kind === "catalog" ? atCardPrice(envelope.data) : envelope.data, savedAt: envelope.savedAt };
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
/*
  Что уходит с сессией: копии справочников и черновики прихода/заказа —
  в черновиках закупочные цены и скидки, а ключ по владельцу не мешает
  прочитать их через DevTools следующему на общем компьютере (аудит 20.09.2026).
*/
const SESSION_BOUND = [PREFIX + ".", "warehouse_pro_arrival_draft:", "warehouse_pro_order_draft:"];

export function clearOfflineCopies(): void {
  try {
    const doomed: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && SESSION_BOUND.some(p => k.startsWith(p))) doomed.push(k);
    }
    for (const k of doomed) localStorage.removeItem(k);
  } catch { /* нет хранилища — нечего и стирать */ }
}
