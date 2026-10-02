import { and, eq, inArray } from "drizzle-orm";
import { settings, shops } from "@db/schema";
import { overdueHoldReason } from "@contracts/hold-reason";
import { overdueDebtByShop } from "./shop-debt";

type Db = ReturnType<typeof import("../queries/connection").getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export interface OverdueHold {
  /** Просроченная сумма, целыми. */
  amount: number;
  /** Возраст самого старого просроченного долга, дней (от даты заказа). */
  oldestDays: number;
  /** Отсрочка, по которой считали: своя у магазина или организации. */
  graceDays: number;
  /** Причина удержания — русской строкой, как лежит в orders.hold_reason. */
  reason: string;
}

/**
 * Держит ли просроченный долг заказ этого магазина — и почему.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Кредитный лимит — единственный тормоз — был денежным и смотрелся только у
 * заказа «в долг». Магазин с долгом трёхмесячной давности, но в пределах
 * суммы, получал товар без вопросов, и за наличные тоже: отгрузили, а
 * наличных у двери «нет, в следующий раз».
 *
 * ── Как теперь ──────────────────────────────────────────────────────────────
 *
 * Если организация включила проверку (settings.overdueHoldEnabled), заказ
 * магазину с просрочкой не отказывается, а встаёт в «ожидает» до решения
 * офиса — тем же путём, что скидка выше порога. Отсрочка — своя у магазина
 * (shops.paymentGraceDays), пусто — организации (settings.overdueGraceDays).
 * Сумма и возраст — services/shop-debt.ts (overdueDebtByShop), по правилам долга.
 *
 * null — проверка выключена, магазина нет или просрочки нет.
 *
 * Зовут двое: создание заказа — внутри своей сделки, под замком строки
 * магазина (services/order-create.ts), и подсказка агенту на шаге выбора
 * магазина (order.shopOverdue) — просто чтением.
 */
export async function overdueHold(db: Db | Tx, tenantId: number, shopId: number): Promise<OverdueHold | null> {
  const cfg = await orgRule(db, tenantId);
  if (!cfg?.enabled) return null;

  const o = (await overdueWith(db, tenantId, [shopId], cfg.grace)).get(shopId);
  if (!o || o.amount <= 0) return null;
  return { ...o, reason: overdueHoldReason(o, { symbol: cfg.symbol, position: cfg.position }) };
}

/**
 * Отсрочка организации, когда строки настроек нет: умолчание столбца
 * settings.overdue_grace_days. Удержанию она не нужна (нет настроек — нет и
 * удержания), а светофору — да: просрочка остаётся фактом и без «стоп отгрузки».
 */
const ORG_GRACE_DEFAULT = 14;

async function orgRule(db: Db | Tx, tenantId: number) {
  const [cfg] = await (db as Tx).select({
    enabled: settings.overdueHoldEnabled, grace: settings.overdueGraceDays,
    symbol: settings.currencySymbol, position: settings.symbolPosition,
  }).from(settings).where(eq(settings.tenantId, tenantId)).limit(1);
  return cfg;
}

/**
 * Просрочка по магазинам — какую отсрочку брать, решается только здесь.
 *
 * Своя отсрочка магазина перекрывает общую; пусто — общая. Ответ — по каждому
 * найденному магазину организации, с нулём, если просрочки нет: светофору
 * нужна и отсрочка, по которой считали.
 */
async function overdueWith(
  db: Db | Tx, tenantId: number, shopIds: number[], orgGrace: number,
): Promise<Map<number, { amount: number; oldestDays: number; graceDays: number }>> {
  const out = new Map<number, { amount: number; oldestDays: number; graceDays: number }>();
  if (shopIds.length === 0) return out;
  const rows = await (db as Tx).select({ id: shops.id, grace: shops.paymentGraceDays }).from(shops)
    .where(and(eq(shops.tenantId, tenantId), inArray(shops.id, shopIds)));
  const graceByShop = new Map(rows.map(shop => [Number(shop.id), shop.grace ?? orgGrace]));
  const debts = await overdueDebtByShop(db, tenantId, graceByShop);
  for (const [id, graceDays] of graceByShop) {
    out.set(id, { ...(debts.get(id) ?? { amount: 0, oldestDays: 0 }), graceDays });
  }
  return out;
}

/**
 * Просрочка многих магазинов сразу — для светофора (services/shop-light.ts).
 *
 * То же правило, что держит заказ (overdueWith выше), но без условия
 * «проверка включена»: просроченный долг — факт и тогда, когда организация
 * не останавливает отгрузку. Включена ли она — отдельным полем holdsOrders:
 * от него зависит, встанет ли новый заказ на проверку офиса.
 *
 * Запросов всегда три, сколько бы магазинов ни спросили.
 */
export async function overdueByShops(
  db: Db | Tx, tenantId: number, shopIds: number[],
): Promise<{ holdsOrders: boolean; byShop: Map<number, { amount: number; oldestDays: number; graceDays: number }> }> {
  const cfg = await orgRule(db, tenantId);
  const byShop = await overdueWith(db, tenantId, shopIds, cfg?.grace ?? ORG_GRACE_DEFAULT);
  return { holdsOrders: Boolean(cfg?.enabled), byShop };
}
