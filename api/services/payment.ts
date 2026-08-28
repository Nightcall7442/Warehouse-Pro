import { payments, shops } from "@db/schema";
import { eq, and, sql, desc } from "drizzle-orm";
import { sanitizeString } from "../lib/sanitize";
import { recalcShopDebt } from "./shop-debt";
import { isDuplicateEntry } from "../lib/db-errors";

type DrizzleInstance = ReturnType<typeof import("../queries/connection").getDb>;

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
