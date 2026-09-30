import { and, eq } from "drizzle-orm";
import { settings, shops } from "@db/schema";
import { overdueHoldReason } from "@contracts/hold-reason";
import { overdueDebt } from "./shop-debt";

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
 * Сумма и возраст — services/shop-debt.ts (overdueDebt), по правилам долга.
 *
 * null — проверка выключена, магазина нет или просрочки нет.
 *
 * Зовут двое: создание заказа — внутри своей сделки, под замком строки
 * магазина (services/order-create.ts), и подсказка агенту на шаге выбора
 * магазина (order.shopOverdue) — просто чтением.
 */
export async function overdueHold(db: Db | Tx, tenantId: number, shopId: number): Promise<OverdueHold | null> {
  const [cfg] = await (db as Tx).select({
    enabled: settings.overdueHoldEnabled, grace: settings.overdueGraceDays,
    symbol: settings.currencySymbol, position: settings.symbolPosition,
  }).from(settings).where(eq(settings.tenantId, tenantId)).limit(1);
  if (!cfg?.enabled) return null;

  const [shop] = await (db as Tx).select({ grace: shops.paymentGraceDays }).from(shops)
    .where(and(eq(shops.id, shopId), eq(shops.tenantId, tenantId))).limit(1);
  if (!shop) return null;

  // Своя отсрочка магазина перекрывает общую; пусто — общая.
  const graceDays = shop.grace ?? cfg.grace;
  const o = await overdueDebt(db, tenantId, shopId, graceDays);
  if (o.amount <= 0) return null;
  return { ...o, graceDays, reason: overdueHoldReason(o, { symbol: cfg.symbol, position: cfg.position }) };
}
