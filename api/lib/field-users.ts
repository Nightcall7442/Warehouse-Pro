import { and, eq, inArray, sql } from "drizzle-orm";
import { users } from "@db/schema";
import type { getDb } from "../queries/connection";
import { FIELD_ROLES } from "../../contracts/pricing";

type Db = ReturnType<typeof getDb>;

/*
  Полевые сотрудники — те, за кого платят (contracts/pricing.ts).

  Правило то же, что у countFieldUsers в контракте: активные агенты, курьеры и
  мерчендайзеры. Отключённый не считается — войти он не может. Здесь — SQL,
  чтобы не тащить в память всех людей ради одного числа. Списки консоли и
  панель владельца считают тем же условием прямо в своём GROUP BY.
*/

/** Сколько активных полевых в организации. */
export async function countFieldUsersOf(db: Pick<Db, "select">, tenantId: number): Promise<number> {
  const [row] = await db.select({ c: sql<number>`count(*)` }).from(users)
    .where(and(eq(users.tenantId, tenantId), eq(users.status, "active"), inArray(users.role, [...FIELD_ROLES])));
  return Number(row?.c ?? 0);
}

