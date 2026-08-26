import { eq, and } from "drizzle-orm";
import * as schema from "@db/schema";
import type { InsertUser } from "@db/schema";
import { getDb } from "./connection";

export async function findUserById(id: number) {
  const rows = await getDb()
    .select({
      id: schema.users.id,
      tenantId: schema.users.tenantId,
      name: schema.users.name,
      email: schema.users.email,
      avatar: schema.users.avatar,
      phone: schema.users.phone,
      role: schema.users.role,
      status: schema.users.status,
      tokenVersion: schema.users.tokenVersion,
      pushToken: schema.users.pushToken,
      createdAt: schema.users.createdAt,
      updatedAt: schema.users.updatedAt,
      lastSignInAt: schema.users.lastSignInAt,
      telegramChatId: schema.users.telegramChatId,
    })
    .from(schema.users)
    .where(eq(schema.users.id, id))
    .limit(1);
  return rows.at(0) ?? null;
}

/** Returns user WITH passwordHash — only for auth flows (login, password change) */
export async function findUserByIdWithPassword(id: number) {
  const rows = await getDb()
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, id))
    .limit(1);
  return rows.at(0) ?? null;
}

/** Email is unique per tenant */
export async function findUserByEmail(tenantId: number, email: string) {
  const rows = await getDb()
    .select()
    .from(schema.users)
    .where(and(eq(schema.users.tenantId, tenantId), eq(schema.users.email, email)))
    .limit(1);
  return rows.at(0) ?? null;
}

/**
 * Сколько учётных записей с одним адресом рассматривать при входе.
 *
 * Каждый кандидат стоит одной проверки PBKDF2 со ста тысячами итераций, то есть
 * заметного времени. Без предела достаточно завести один адрес в десятках
 * организаций, чтобы вход по нему стал дорогим для сервера.
 *
 * Десять — с большим запасом: один человек в десяти организациях сразу это уже
 * не рабочий случай.
 */
const MAX_LOGIN_CANDIDATES = 10;

/**
 * Все учётные записи с этим адресом, во всех организациях.
 *
 * Раньше здесь стоял `.limit(1)` с сортировкой по id и пометкой «P1-14 FIX:
 * deterministic ordering». Порядок и правда стал предсказуемым — но беда была
 * не в порядке. Схема прямо разрешает повтор адреса между организациями
 * (uq_user_email_tenant по паре email + tenant_id, с комментарием «email
 * уникален внутри тенанта, но может повторяться в разных»), а вход брал строку
 * с наименьшим id и сверял пароль ТОЛЬКО с ней. Человек, заведённый под тем же
 * адресом во второй организации, получал «Неверный email или пароль» навсегда:
 * его правильный пароль сверялся с чужим хешем, и никакая попытка помочь не
 * могла — в интерфейсе это выглядит как «не помню пароль», а сброс пароля
 * ничего не менял.
 *
 * Возвращаются все, разбирается вызывающий: у разных людей пароли разные,
 * поэтому почти всегда подойдёт ровно одна запись и спрашивать ничего не нужно.
 */
export async function findUsersByEmailAnyTenant(email: string) {
  return getDb()
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, email))
    .orderBy(schema.users.id)
    .limit(MAX_LOGIN_CANDIDATES);
}

export async function createUser(data: InsertUser) {
  const [result] = await getDb().insert(schema.users).values(data);
  return findUserById(Number(result.insertId));
}

export async function updateUserLastSignIn(id: number) {
  await getDb()
    .update(schema.users)
    .set({ lastSignInAt: new Date() })
    .where(eq(schema.users.id, id));
}
