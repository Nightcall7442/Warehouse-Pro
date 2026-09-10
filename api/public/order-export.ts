/* ═══════════════════════════════════════════════════════════════════════════
   Выгрузка заказов наружу: снимок, курсор, разбор фильтров.

   ── Зачем отдельный файл ────────────────────────────────────────────────────

   Здесь нет ни одного обращения к базе. Всё, что решает, КАКИЕ строки войдут в
   выгрузку и в каком порядке, вынесено в чистые функции — и проверяется
   числами, без MySQL. На этой машине её нет, а ошибка в листании стоит
   потерянного заказа у того, кто по этим данным считает долги.

   ── Почему снимок по идентификатору, а не по времени ────────────────────────

   Приёмка требует (пункты B и C ТЗ): на трёх страницах ни одна строка не
   потеряна и не задвоена, а пришедший во время выгрузки заказ снимок не рушит.
   Смещением (`offset`) это недостижимо в принципе: новая строка сдвигает все
   последующие, и на границе страницы одна теряется, а другая приходит дважды.

   Снимок мог бы отсекать по времени создания — но в этом продукте
   `created_at` ДВИГАЕТСЯ: заказ, возвращённый из архива в работу, получает
   дату второго круга (services/order-reopen.ts). То есть по времени граница
   набора не постоянна, а значит и снимок не постоянен.

   Поэтому граница — «идентификатор не больше того, что был на момент снимка».
   `id` выдаётся базой по возрастанию и не меняется никогда: набор строк
   зафиксирован намертво, новые в него не попадут, а листание по тому же полю
   не может ни потерять, ни повторить.

   ── Чего снимок НЕ обещает ──────────────────────────────────────────────────

   Он фиксирует СОСТАВ набора, а не содержимое строк: статус заказа, попавшего
   в снимок, может измениться между первой и третьей страницей, и отдастся
   текущий. Хранить историю версий заказа система не умеет, и делать вид, что
   умеет, нельзя. Именно для этого в ТЗ есть второй режим — «что изменилось с
   такого-то времени».
   ═══════════════════════════════════════════════════════════════════════════ */

/** Что известно про заказ снаружи. Имена полей — из ТЗ, менять нельзя. */
export interface ExportedOrder {
  order_id: number;
  order_number: string;
  company_id: number;
  warehouse_id: number | null;
  created_at: string;
  updated_at: string;
  status: string;
  amount: string;
  currency: string;
  shop_id: number;
  sales_agent_id: number | null;

  shop_name: string | null;
  sales_agent_name: string | null;
  territory_id: number | null;
  territory_name: string | null;

  courier_id: number | null;
  courier_name: string | null;
  /**
   * Обещанный срок доставки.
   *
   * ВСЕГДА null: такого поля в системе нет — ни в базе, ни на экране, где его
   * мог бы поставить агент. ТЗ на этот случай отвечает само (пункт 9): без
   * него вывод о просрочке — «неизвестно», а пункт 17-G прямо запрещает
   * подставлять догадку. Подставить сюда дату доставки или дату заказа значило
   * бы выдать выдумку за обещание, по которому другая сторона считает срывы.
   */
  promised_delivery_at: null;
  delivered_at: string | null;

  /** Заполняется только в режиме изменений: заказ удалён. */
  deleted_at?: string | null;
}

/* ── Снимок ──────────────────────────────────────────────────────────────── */

export interface Snapshot {
  /** Наибольший идентификатор заказа на момент снимка. Граница набора. */
  maxId: number;
  /** Момент снимка — для человека и для журнала на той стороне. */
  asOf: string;
}

const b64url = {
  encode: (s: string) => Buffer.from(s, "utf8").toString("base64url"),
  decode: (s: string) => Buffer.from(s, "base64url").toString("utf8"),
};

export function encodeSnapshot(snap: Snapshot): string {
  return b64url.encode(JSON.stringify({ m: snap.maxId, t: snap.asOf }));
}

/**
 * Разобрать снимок. Непонятный — отказ, а не «начнём заново».
 *
 * Молча выдать новый снимок вместо присланного значило бы порвать выгрузку
 * посередине так, что другая сторона об этом не узнает: страницы поехали бы
 * по другому набору, и часть заказов не пришла бы вовсе.
 */
export function decodeSnapshot(raw: string): Snapshot | null {
  try {
    const o = JSON.parse(b64url.decode(raw)) as { m?: unknown; t?: unknown };
    const maxId = Number(o.m);
    if (!Number.isInteger(maxId) || maxId < 0) return null;
    if (typeof o.t !== "string" || !o.t) return null;
    return { maxId, asOf: o.t };
  } catch {
    return null;
  }
}

/* ── Курсор ──────────────────────────────────────────────────────────────── */

export interface Cursor {
  /** Последний отданный идентификатор. Следующая страница — строго за ним. */
  lastId: number;
  /**
   * Снимок, которому курсор принадлежит.
   *
   * ТЗ требует прямо: «курсор привязан к этому состоянию». Без привязки
   * курсор от одной выгрузки можно подставить в другую, и набор поедет — а
   * выглядеть это будет как потерянные заказы, причём у той стороны.
   */
  snapshotId: string;
  /** Режим изменений: с какого времени идёт отбор. */
  updatedSince?: string;
}

export function encodeCursor(c: Cursor): string {
  return b64url.encode(JSON.stringify({ i: c.lastId, s: c.snapshotId, u: c.updatedSince }));
}

export function decodeCursor(raw: string): Cursor | null {
  try {
    const o = JSON.parse(b64url.decode(raw)) as { i?: unknown; s?: unknown; u?: unknown };
    const lastId = Number(o.i);
    if (!Number.isInteger(lastId) || lastId < 0) return null;
    if (typeof o.s !== "string") return null;
    return {
      lastId,
      snapshotId: o.s,
      updatedSince: typeof o.u === "string" ? o.u : undefined,
    };
  } catch {
    return null;
  }
}

/* ── Разбор запроса ──────────────────────────────────────────────────────── */

/** Сколько строк отдаём за раз. Потолок назван, а не угадывается. */
export const MAX_PAGE_SIZE = 200;
export const DEFAULT_PAGE_SIZE = 100;

export function parseLimit(raw: string | undefined): number {
  const n = Number(raw ?? DEFAULT_PAGE_SIZE);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_PAGE_SIZE;
  return Math.min(Math.floor(n), MAX_PAGE_SIZE);
}

/**
 * Границы периода — ОБЕ включительно, и это сказано в документации.
 *
 * «2026-09-01..2026-09-30» без времени означает весь сентябрь: конец
 * раздвигается до последней секунды дня. Иначе заказы последнего дня
 * выпадали бы — беда, которую в этом продукте уже ловили в отчётах.
 */
export function parseDayBound(raw: string | undefined, edge: "from" | "to"): string | null {
  if (!raw) return null;
  const s = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return edge === "from" ? `${s} 00:00:00` : `${s} 23:59:59`;
  const t = Date.parse(s);
  if (Number.isNaN(t)) return null;
  return s;
}

/** Статусы через запятую. Неизвестный — отказ, а не тихо пустой ответ. */
export function parseStatuses(raw: string | undefined, known: readonly string[]): string[] | null | "invalid" {
  if (!raw) return null;
  const list = raw.split(",").map(s => s.trim()).filter(Boolean);
  if (list.length === 0) return null;
  if (list.some(s => !known.includes(s))) return "invalid";
  return list;
}

/* ── Деньги и время ──────────────────────────────────────────────────────── */

/**
 * Деньги — строкой с двумя знаками, как требует ТЗ («2975000.00»).
 *
 * Числом с плавающей точкой их отдавать нельзя: на той стороне разбор в double
 * теряет копейки, а сверка сумм — главный пункт приёмки.
 */
export function money(v: unknown): string {
  const n = Number(v ?? 0);
  return (Number.isFinite(n) ? n : 0).toFixed(2);
}

/**
 * Время — ISO 8601 в UTC, с «Z».
 *
 * Без часового пояса дата читается получателем в его собственном, и период
 * съезжает на несколько часов — то есть заказы попадают в соседние сутки.
 */
export function iso(v: Date | string | null | undefined): string | null {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
