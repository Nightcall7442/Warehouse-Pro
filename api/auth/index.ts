import * as cookie from "cookie";
import { Session } from "@contracts/constants";
import { Errors } from "@contracts/errors";
import { verifySessionToken } from "./session";
import { isSessionRevoked } from "./revocation";
import { findUserById } from "../queries/users";
import { findTenantById } from "../queries/tenants";
import { cache } from "../lib/cache";
import type { Tenant, User } from "@db/schema";

/*
  Пользователь и организация — на каждый запрос.

  Каждый вызов делал два SELECT (users, tenants) — при 343 процедурах и
  экране, который за секунду зовёт десяток, это была почти половина
  обращений к базе. Теперь оба ответа живут в памяти процесса десять секунд:
  экран с десятью вызовами обходится одним чтением.

  Только в памяти, не в Redis: в строках есть даты, а JSON их превращает в
  строки. Сброс — рассылается репликам (lib/cache.ts), так что деактивация,
  «выйти отовсюду» и приостановка организации действуют сразу и везде;
  остальные правки (имя, телефон) доезжают в пределах десяти секунд.
  Отзыв сессии (jti) проверяется в Redis до кэша и кэша не касается.
*/
const AUTH_TTL_MS = 10_000;
const userKey = (id: number) => `auth:user:${id}`;
const tenantKey = (id: number) => `auth:tenant:${id}`;

/** Пользователь изменился так, что это влияет на вход: статус, роль, tokenVersion. */
export function invalidateAuthUser(userId: number): void { cache.invalidate(userKey(userId)); }
/** Организация приостановлена, удалена или сменила тариф. */
export function invalidateAuthTenant(tenantId: number): void { cache.invalidate(tenantKey(tenantId)); }

async function cachedUser(id: number) {
  const hit = cache.get<Awaited<ReturnType<typeof findUserById>>>(userKey(id));
  if (hit !== undefined) return hit;
  const row = await findUserById(id);
  cache.setLocal(userKey(id), row, AUTH_TTL_MS);
  return row;
}

async function cachedTenant(id: number) {
  const hit = cache.get<Awaited<ReturnType<typeof findTenantById>>>(tenantKey(id));
  if (hit !== undefined) return hit;
  const row = await findTenantById(id);
  cache.setLocal(tenantKey(id), row, AUTH_TTL_MS);
  return row;
}

/**
 * findUserById projects every column except the password hash, so an
 * authenticated request never carries one around — the two flows that need it
 * (login, change password) read it themselves.
 */
export type AuthenticatedUser = Omit<User, "passwordHash" | "totpSecret">;

export type AuthResult = {
  user: AuthenticatedUser;
  tenant: Tenant;
};

export async function authenticateRequest(headers: Headers): Promise<AuthResult> {
  // 1) Mobile / API clients: Authorization: Bearer <jwt>
  // 2) Web: httpOnly session cookie
  let token: string | undefined;

  const authHeader = headers.get("authorization") ?? headers.get("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    token = authHeader.slice(7).trim();
  } else {
    const cookies = cookie.parse(headers.get("cookie") || "");
    token = cookies[Session.cookieName];
  }

  if (!token) throw Errors.forbidden("Invalid authentication token.");

  const claim = await verifySessionToken(token);
  if (!claim)  throw Errors.forbidden("Invalid authentication token.");
  // Выход отзывает сессию: токен подписан верно, но им уже вышли.
  if (claim.jti && await isSessionRevoked(claim.jti)) throw Errors.forbidden("Session expired. Please re-login.");

  const user = await cachedUser(claim.userId);
  if (!user)   throw Errors.forbidden("User not found. Please re-login.");
  if (user.status !== "active") throw Errors.forbidden("Account is inactive.");

  // Token revocation: check if tokenVersion matches
  if (user.tokenVersion !== claim.tv) {
    throw Errors.forbidden("Session expired. Please re-login.");
  }

  const tenant = await cachedTenant(user.tenantId);
  if (!tenant || tenant.status !== "active") throw Errors.forbidden("Organisation is suspended.");

  return { user, tenant };
}

export { signSessionToken, verifySessionToken } from "./session";
