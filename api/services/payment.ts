import { payments, shops } from "@db/schema";
import { eq, and, sql, desc } from "drizzle-orm";
import { sanitizeString } from "../lib/sanitize";
import { recalcShopDebt } from "./shop-debt";
import { isDuplicateEntry } from "../lib/db-errors";

type DrizzleInstance = ReturnType<typeof import("../queries/connection").getDb>;
type Tx = Parameters<Parameters<DrizzleInstance["transaction"]>[0]>[0];

export interface AddPaymentInput {
  shopId: number;
  amount: string;
  type?: "payment" | "debt";
  notes?: string;
  createdBy: number;
  /**
   * Метка одной попытки оплаты, одинаковая у всех её повторов.
   *
   * Без неё оплата, отправленная дважды, записывалась дважды, и долг магазина
   * уменьшался вдвое. Поводов для повтора хватает и без злого умысла: сорвалась
   * связь и клиент отправил снова, кассир нажал кнопку второй раз, открыты две
   * вкладки.
   *
   * Поле необязательное — старые вызовы, ещё не передающие ключ, обязаны
   * продолжать работать, иначе оплату нельзя будет провести вообще.
   */
  idempotencyKey?: string;
}

/**
 * Повторная отправка той же оплаты: запись уже есть, долг уже пересчитан.
 *
 * Возвращается успех, а не ошибка. Для отправителя это тот же результат, что и
 * с первого раза — деньги приняты один раз, — а ошибка заставила бы его
 * повторять снова или, хуже, решить, что оплата не прошла, и провести её
 * вручную ещё раз.
 */
export interface AddPaymentResult {
  success: true;
  duplicate?: true;
}

/**
 * Нарушение уникального индекса.
 *
 * Читается по всей цепочке cause: drizzle заворачивает ошибку драйвера, и у
 * обёртки никакого code нет. Пока читали с верхнего уровня, повторная отправка
 * оплаты с тем же ключом идемпотентности отдавала пятисотую вместо «уже
 * записано».
 */
const isDuplicateKey = isDuplicateEntry;

export const PaymentService = {
  async addPayment(db: DrizzleInstance, tenantId: number, input: AddPaymentInput): Promise<AddPaymentResult> {
    const { shopId, amount, type = "payment", notes, createdBy, idempotencyKey } = input;

    // #FIX3: Validate amount
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      throw new Error("Сумма платежа должна быть положительным числом");
    }

    try {
      await db.transaction(async (tx) => {
        // Verify shop exists and belongs to tenant (lock row to prevent concurrent payment race)
        const [shop] = await tx.select({ id: shops.id, debt: shops.debt })
          .from(shops)
          .where(and(eq(shops.id, shopId), eq(shops.tenantId, tenantId)))
          .limit(1)
          .for("update");
        if (!shop) {
          throw new Error("Магазин не найден");
        }

        // #FIX3: Warn if overpayment
        if (type === "payment" && amt > Number(shop.debt)) {
          // Allow but log — don't block
        }

        // Защиту даёт сам уникальный индекс, а не проверка «нет ли уже такой
        // записи»: между проверкой и вставкой успевает вклиниться второй
        // запрос, и оба видят пусто. Индекс же отказывает второму независимо
        // от того, насколько близко по времени пришли повторы.
        await tx.insert(payments).values({
          tenantId,
          shopId,
          amount: amt.toFixed(2),
          type,
          notes: notes ? sanitizeString(notes) : undefined,
          createdBy,
          idempotencyKey,
        });

        // These rows carry no orderId — they are shop-level adjustments, and
        // recalcShopDebt folds them in (debt adds, payment subtracts) alongside
        // what the shop's orders owe.
        await recalcShopDebt(tx, tenantId, shopId);
      });
    } catch (e) {
      // Отказ по уникальному индексу означает: эта же попытка уже проведена, и
      // транзакция откатилась целиком — лишней строки не осталось, долг не
      // тронут. Разбирать код ошибки безопасно только когда ключ передан: без
      // ключа столбец пуст, конфликтовать нечему, и ER_DUP_ENTRY означал бы
      // нарушение какого-то другого индекса, которое нельзя выдавать за
      // успешную оплату.
      if (idempotencyKey && isDuplicateKey(e)) {
        return { success: true, duplicate: true };
      }
      throw e;
    }

    return { success: true };
  },

  /**
   * Сторнировать платёж: отрицательная строка того же типа со ссылкой на
   * исходную. Автор строки — автор исходного платежа, чтобы касса того же
   * человека сошлась в ноль; кто сторнировал — в журнале действий.
   * Повторное сторно и сторно самого сторно отвергаются.
   */
  async reverse(
    db: DrizzleInstance, tenantId: number,
    input: { paymentId: number; reason: string; actor: { id: number; name?: string; role: string } },
  ): Promise<{ success: true; reversalId: number }> {
    const reason = sanitizeString(input.reason);
    if (!reason) throw new Error("Укажите причину сторно");
    let reversalId = 0;
    let shopId = 0;
    let original: { amount: string; orderId: number | null } | null = null;
    await db.transaction(async (tx) => {
      const [p] = await tx.select({
        id: payments.id, shopId: payments.shopId, orderId: payments.orderId, amount: payments.amount,
        type: payments.type, paymentMethod: payments.paymentMethod, createdBy: payments.createdBy,
        reversalOf: payments.reversalOf, status: payments.status,
      }).from(payments)
        .where(and(eq(payments.id, input.paymentId), eq(payments.tenantId, tenantId)))
        .for("update").limit(1);
      if (!p) throw new Error("Платёж не найден");
      if (p.reversalOf != null) throw new Error("Это уже сторно — сторнировать его нельзя");
      const [already] = await tx.select({ id: payments.id }).from(payments)
        .where(eq(payments.reversalOf, p.id)).limit(1);
      if (already) throw new Error("Платёж уже сторнирован");

      const [row] = await tx.insert(payments).values({
        tenantId, shopId: p.shopId, orderId: p.orderId,
        amount: (-Number(p.amount)).toFixed(2),
        type: p.type, paymentMethod: p.paymentMethod,
        status: "reversal",
        notes: `Сторно платежа #${p.id}: ${reason}`,
        createdBy: p.createdBy,
        reversalOf: p.id,
        paidAt: new Date(),
      });
      reversalId = Number(row.insertId);
      await tx.update(payments).set({ status: "reversed" }).where(eq(payments.id, p.id));
      shopId = p.shopId;
      original = { amount: p.amount, orderId: p.orderId };
      await recalcShopDebt(tx, tenantId, shopId);
    });

    const { recordAudit } = await import("./audit-log");
    await recordAudit(db, {
      tenantId, actorId: input.actor.id, actorName: input.actor.name,
      action: "payment.reverse", targetType: "payment", targetId: input.paymentId,
      meta: { reversalId, shopId, amount: original!.amount, orderId: original!.orderId, reason, actorRole: input.actor.role },
    });
    return { success: true, reversalId };
  },

  async getPaymentHistory(db: DrizzleInstance, tenantId: number, shopId: number) {
    return db.select()
      .from(payments)
      .where(and(eq(payments.shopId, shopId), eq(payments.tenantId, tenantId)))
      .orderBy(desc(payments.createdAt))
      .limit(20);
  },

  async getPaymentHistoryRange(db: DrizzleInstance, tenantId: number, shopId: number, days: number = 30) {
    return db.select({
      id: payments.id,
      amount: payments.amount,
      type: payments.type,
      notes: payments.notes,
      createdAt: payments.createdAt,
      status: payments.status,
      reversalOf: payments.reversalOf,
    })
      .from(payments)
      .where(and(
        eq(payments.shopId, shopId),
        eq(payments.tenantId, tenantId),
        sql`${payments.createdAt} >= NOW() - INTERVAL ${days} DAY`,
      ))
      .orderBy(desc(payments.createdAt))
      .limit(50);
  },
};

/**
 * Сколько по заказу УЖЕ принято.
 *
 * ── Зачем отдельной функцией ────────────────────────────────────────────────
 *
 * Операторский путь (applyPartialPayment в services/order.ts) это считает и
 * отказывается принять больше остатка. Оба курьерских пути — markDelivered и
 * completeDelivery — сравнивали присланную сумму с ПОЛНОЙ суммой заказа, а не
 * с остатком, и уже принятое не читали вовсе.
 *
 * Пока заказ проводится один раз, разницы нет. Но заказ можно провести
 * дважды: вернуть из архива в работу и доставить заново. Тогда по заказу на
 * 300 появлялись две записи по 300 — магазин числился переплатившим вдвое, а
 * нижняя граница GREATEST(0, …) в расчёте долга эту переплату молча съедала.
 * Ни на одном экране этих денег больше не было.
 *
 * Читать ОБЯЗАТЕЛЬНО после блокировки строки заказа: иначе два одновременных
 * нажатия прочитают одно и то же «уже принято» и оба сочтут, что место есть.
 */
export async function paidForOrder(
  tx: { select: DrizzleInstance["select"] },
  tenantId: number,
  orderId: number,
): Promise<number> {
  /*
    Обычная выборка и сложение в JS, а не SUM в запросе.

    Платежей по одному заказу единицы, зато запрос остаётся внутри того куска
    построителя, который умеют служебные заглушки: агрегат они не вычисляют, и
    проверка молча читала бы ноль — то есть разрешала бы ровно то, что должна
    запрещать. Тот же приём применён в services/order.ts к возвращённым
    количествам, и по той же причине.
  */
  const rows = await tx.select({ amount: payments.amount })
    .from(payments)
    .where(and(
      eq(payments.orderId, orderId),
      eq(payments.tenantId, tenantId),
      eq(payments.type, "payment"),
    ));
  return rows.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
}

/**
 * Запас на округление вверх — «сдачу оставьте себе».
 *
 * Применяется к ОСТАТКУ, а не к сумме заказа. От суммы заказа он означал бы,
 * что по оплаченному заказу можно принять ещё столько же и сверху двадцать
 * процентов.
 */
export const CASH_ROUNDING_TOLERANCE = 1.2;

/**
 * Проверить, что принимаемая сумма помещается в остаток по заказу.
 * Бросает с текстом для человека, если нет.
 */
/**
 * Сколько из принятой суммы ложится на заказ, а сколько — излишек.
 *
 * Допуск в assertFitsRemainder пропускал до 20 % сверх остатка, и излишек
 * исчезал: строка по заказу больше остатка обрезалась в GREATEST(0, …) при
 * пересчёте долга, и «сдал наличные / учтено» не сходилось. Излишек теперь
 * пишется отдельной строкой по магазину (recordExcess): он вычитается из
 * долга по другим заказам, виден в истории и в кассе того, кто принял.
 */
export function splitExcess(orderTotal: number, priorPaid: number, amount: number): { onOrder: number; excess: number } {
  const remaining = Math.max(0, orderTotal - priorPaid);
  const onOrder = Math.min(amount, remaining);
  return { onOrder: Number(onOrder.toFixed(2)), excess: Number((amount - onOrder).toFixed(2)) };
}

export async function recordExcess(
  tx: Tx, tenantId: number, shopId: number, orderNumber: string, excess: number, createdBy: number,
): Promise<void> {
  await tx.insert(payments).values({
    tenantId, shopId, orderId: null,
    amount: excess.toFixed(2), type: "payment",
    notes: `Излишек сверх остатка по заказу ${orderNumber}`,
    createdBy,
    paidAt: new Date(),
  });
}

export function assertFitsRemainder(orderTotal: number, priorPaid: number, amount: number): void {
  const remaining = orderTotal - priorPaid;
  if (remaining <= 0) {
    throw new Error(
      `По заказу уже принято ${priorPaid} из ${orderTotal} — принимать больше нечего. ` +
      `Если деньги действительно получены, проведите их как оплату магазину, а не по этому заказу.`,
    );
  }
  if (amount > remaining * CASH_ROUNDING_TOLERANCE) {
    throw new Error(
      `Сумма ${amount} больше остатка по заказу (${remaining}` +
      `${priorPaid > 0 ? `, уже принято ${priorPaid}` : ""}).`,
    );
  }
}
