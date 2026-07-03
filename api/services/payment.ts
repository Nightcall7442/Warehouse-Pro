import { payments, shops } from "@db/schema";
import { eq, and, sql, desc } from "drizzle-orm";
import { sanitizeString } from "../lib/sanitize";

type DrizzleInstance = ReturnType<typeof import("../queries/connection").getDb>;

export interface AddPaymentInput {
  shopId: number;
  amount: string;
  type?: "payment" | "debt";
  notes?: string;
  createdBy: number;
}

export const PaymentService = {
  async addPayment(db: DrizzleInstance, tenantId: number, input: AddPaymentInput) {
    const { shopId, amount, type = "payment", notes, createdBy } = input;

    // #FIX3: Validate amount
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      throw new Error("Сумма платежа должна быть положительным числом");
    }

    await db.transaction(async (tx) => {
      // Verify shop exists and belongs to tenant
      const [shop] = await tx.select({ id: shops.id, debt: shops.debt })
        .from(shops)
        .where(and(eq(shops.id, shopId), eq(shops.tenantId, tenantId)))
        .limit(1);
      if (!shop) {
        throw new Error("Магазин не найден");
      }

      // #FIX3: Warn if overpayment
      if (type === "payment" && amt > Number(shop.debt)) {
        // Allow but log — don't block
      }

      await tx.insert(payments).values({
        tenantId,
        shopId,
        amount: amt.toFixed(2),
        type,
        notes: notes ? sanitizeString(notes) : undefined,
        createdBy,
      });

      if (type === "payment") {
        const newDebt = Math.max(0, Number(shop.debt) - amt);
        await tx.update(shops).set({ debt: String(newDebt) })
          .where(and(eq(shops.id, shopId), eq(shops.tenantId, tenantId)));
      } else {
        await tx.update(shops).set({ debt: sql`${shops.debt} + ${amt}` })
          .where(and(eq(shops.id, shopId), eq(shops.tenantId, tenantId)));
      }
    });

    return { success: true };
  },

  async getPaymentHistory(db: DrizzleInstance, tenantId: number, shopId: number) {
    return db.select()
      .from(payments)
      .where(and(eq(payments.shopId, shopId), eq(payments.tenantId, tenantId)))
      .orderBy(desc(payments.createdAt))
      .limit(20);
  },
};
