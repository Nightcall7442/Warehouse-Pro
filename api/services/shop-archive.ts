import { and, eq, inArray, sql } from "drizzle-orm";
import {
  shops, orders, payments, returns, dailyPlans, visitReports,
  visitSchedules, salesTargets, debtReminders, priceListAssignments,
} from "@db/schema";
import { getDb } from "../queries/connection";

/* ═══════════════════════════════════════════════════════════════════════════
   Убрать точку из работы — и вернуть обратно.

   ── Что здесь было раньше ───────────────────────────────────────────────────

   Одна кнопка «Удалить» с двумя исходами, и какой достанется — решал случай:

     • у точки есть заказы или оплаты → внешний ключ не даёт стереть строку,
       обработчик молча ставит status = 'inactive';
     • заказов ещё нет → DELETE проходит, и магазин исчезает вместе с адресом,
       координатами, фотографией и историей визитов.

   Окно подтверждения при этом обещало одно и то же: «Данные будут удалены
   безвозвратно». Директор отмечал двадцать точек — часть уничтожалась, часть
   пряталась, оставаясь в списке неотличимой от живой. Вернуть нельзя было ни
   ту, ни другую.

   ── Что здесь стало ─────────────────────────────────────────────────────────

   Два разных дела перестали быть одной кнопкой:

     • «в архив» — обычное событие в жизни справочника: точка закрылась,
       перешла к другому поставщику, ушла в спячку до сезона. Ничего не
       теряется, действие обратимо, и у него есть дата, автор и причина;
     • «удалить насовсем» — исправление ошибки ввода. Тех самых дублей, что
       наплодил повторный тап по «Создать» до появления ключа попытки. Такое
       удаление разрешено ровно тогда, когда стирать нечего: на точку не
       ссылается ни одна запись.

   Признак «убрана» — по-прежнему status = 'inactive'. По нему уже фильтруют
   агент, KPI, территории и сводка; заводить рядом второе понятие значило бы
   держать два ответа на один вопрос и рано или поздно разойтись в них.

   ── Долг архивацией не гасится ──────────────────────────────────────────────

   Это главное, чего здесь нельзя допустить. Если убранная точка выпадет из
   дебиторки, то «списать долг» будет означать «нажать в архив», причём без
   следа в деньгах: сумма просто перестанет попадаться на глаза. Поэтому
   shops.debt не трогается, точка остаётся во всех расчётах задолженности, а
   архивация должника требует отдельного подтверждения — см. checkBeforeArchive.
   ═══════════════════════════════════════════════════════════════════════════ */

/** Таблицы, ссылающиеся на магазин: по ним считается, есть ли что терять. */
const DEPENDENTS = [
  { table: orders,        title: "заказы" },
  { table: payments,      title: "платежи" },
  { table: returns,       title: "возвраты" },
  { table: visitReports,  title: "отчёты о визитах" },
  { table: dailyPlans,    title: "планы визитов" },
  { table: visitSchedules, title: "расписания визитов" },
  { table: salesTargets,  title: "планы продаж" },
  { table: debtReminders, title: "напоминания о долге" },
] as const;

/**
 * То же, но у таблицы нет своего столбца организации.
 *
 * Назначение прайс-листа привязано к организации через сам прайс-лист, а не
 * напрямую. Отбирать только по магазину здесь безопасно: сам магазин уже
 * проверен на принадлежность организации выше по вызову.
 */
const DEPENDENTS_BY_SHOP = [
  { table: priceListAssignments, title: "прайс-листы" },
] as const;

export interface ShopTrace {
  /** Сколько записей ссылается на точку, по видам. Пусто — ссылок нет. */
  counts: Record<string, number>;
  total: number;
  debt: number;
}

/**
 * Что за точкой числится.
 *
 * Один проход вместо девяти: считать по одной таблице за запрос значило бы
 * девять обращений на каждое подтверждение, а окно подтверждения открывают
 * чаще, чем архивируют.
 */
export async function shopTrace(tenantId: number, shopId: number): Promise<ShopTrace | null> {
  const db = getDb();

  const [shop] = await db.select({ debt: shops.debt })
    .from(shops)
    .where(and(eq(shops.id, shopId), eq(shops.tenantId, tenantId)))
    .limit(1);
  if (!shop) return null;

  const counts: Record<string, number> = {};
  let total = 0;

  const rows = await Promise.all([
    ...DEPENDENTS.map(async ({ table, title }) => {
      const [row] = await db.select({ n: sql<number>`count(*)` })
        .from(table)
        .where(and(eq(table.shopId, shopId), eq(table.tenantId, tenantId)));
      return { title, n: Number(row?.n ?? 0) };
    }),
    ...DEPENDENTS_BY_SHOP.map(async ({ table, title }) => {
      const [row] = await db.select({ n: sql<number>`count(*)` })
        .from(table)
        .where(eq(table.shopId, shopId));
      return { title, n: Number(row?.n ?? 0) };
    }),
  ]);

  for (const { title, n } of rows) {
    if (n > 0) { counts[title] = n; total += n; }
  }

  return { counts, total, debt: Number(shop.debt ?? 0) };
}

/** Человеческий перечень вида «заказы — 14, платежи — 3». */
export function traceSummary(trace: ShopTrace): string {
  return Object.entries(trace.counts).map(([k, n]) => `${k} — ${n}`).join(", ");
}

/**
 * Убрать точки в архив.
 *
 * Возвращает, сколько убрано и сколько среди них было с долгом: последнее
 * показывается человеку, чтобы «убрал с глаз» не превратилось в «списал».
 */
export async function archiveShops(
  tenantId: number,
  shopIds: number[],
  archivedBy: number,
  reason?: string,
): Promise<{ archived: number; withDebt: number; debtTotal: number }> {
  if (shopIds.length === 0) return { archived: 0, withDebt: 0, debtTotal: 0 };
  const db = getDb();

  const targets = await db.select({ id: shops.id, debt: shops.debt })
    .from(shops)
    .where(and(
      inArray(shops.id, shopIds),
      eq(shops.tenantId, tenantId),
      eq(shops.status, "active"),
    ));
  if (targets.length === 0) return { archived: 0, withDebt: 0, debtTotal: 0 };

  await db.update(shops)
    .set({
      status: "inactive",
      archivedAt: new Date(),
      archivedBy,
      // Пустая строка в поле причины ничем не лучше NULL, а выглядит как
      // «причину указали».
      archiveReason: reason?.trim() || null,
    })
    .where(and(inArray(shops.id, targets.map(t => t.id)), eq(shops.tenantId, tenantId)));

  const debtors = targets.filter(t => Number(t.debt ?? 0) > 0);
  return {
    archived: targets.length,
    withDebt: debtors.length,
    debtTotal: debtors.reduce((s, t) => s + Number(t.debt ?? 0), 0),
  };
}

/**
 * Вернуть точку в работу.
 *
 * Метки архива снимаются: иначе вернувшаяся точка носила бы дату, которая уже
 * ничего не означает, и следующий архив нечем было бы отличить от прошлого.
 */
export async function restoreShop(tenantId: number, shopId: number): Promise<boolean> {
  const db = getDb();
  const [shop] = await db.select({ id: shops.id })
    .from(shops)
    .where(and(eq(shops.id, shopId), eq(shops.tenantId, tenantId), eq(shops.status, "inactive")))
    .limit(1);
  if (!shop) return false;

  await db.update(shops)
    .set({ status: "active", archivedAt: null, archivedBy: null, archiveReason: null })
    .where(and(eq(shops.id, shopId), eq(shops.tenantId, tenantId)));
  return true;
}

/** Отказ удалить насовсем — с перечнем того, что бы при этом пропало. */
export class ShopHasHistoryError extends Error {
  // Обычное поле, а не свойство-параметр: сборка идёт с erasableSyntaxOnly,
  // где объявление в подписи конструктора запрещено.
  readonly trace: ShopTrace;

  constructor(trace: ShopTrace) {
    super(
      `Точку нельзя удалить: за ней числятся ${traceSummary(trace)}. ` +
      `Её можно убрать в архив — история сохранится, и точку можно будет вернуть.`,
    );
    this.name = "ShopHasHistoryError";
    this.trace = trace;
  }
}

/**
 * Стереть точку, за которой ничего не числится.
 *
 * Проверка идёт до удаления, а не ловится по ошибке внешнего ключа, ради
 * ответа: «нельзя» без объяснения ничем не помогает, а «заказы — 14, платежи —
 * 3» сразу говорит, почему и что делать вместо этого.
 */
export async function deleteShopForever(tenantId: number, shopId: number): Promise<ShopTrace> {
  const trace = await shopTrace(tenantId, shopId);
  if (!trace) throw new Error("Магазин не найден");
  if (trace.total > 0) throw new ShopHasHistoryError(trace);

  await getDb().delete(shops)
    .where(and(eq(shops.id, shopId), eq(shops.tenantId, tenantId)));
  return trace;
}
