import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "../lib/env";

/**
 * Токен привязки Telegram — подписанный и недолгий.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Ссылка «связать одним нажатием» собиралась так:
 *
 *     https://t.me/<бот>?start=<идентификатор пользователя>
 *
 * То есть в открытом виде и без подписи. Обработчика у неё не было вовсе, и
 * поэтому дыра не выстрелила: подключи кто-нибудь этот вебхук как есть — и
 * любой человек в интернете написал бы боту `/start 5`, привязав свой телефон
 * к пятому пользователю системы. Дальше он получал бы его уведомления, а на
 * тарифе с ответами бота — и остатки склада, и выручку чужой организации.
 *
 * ── Правило ─────────────────────────────────────────────────────────────────
 *
 * В ссылке едет не идентификатор, а подпись поверх него. Подделать её без
 * APP_SECRET нельзя, а срок жизни в четверть часа означает, что переслать
 * ссылку другу «на попробовать» бесполезно: к моменту, когда он нажмёт, она
 * уже мертва.
 *
 * Формат: `<userId>.<истекает>.<подпись>` — в параметре start у Telegram
 * допустимы латиница, цифры, дефис, подчёркивание и точка, поэтому подпись
 * кодируется base64url.
 */

/** Сколько живёт ссылка. Достаточно, чтобы дойти от настроек до Telegram. */
export const LINK_TTL_MS = 15 * 60 * 1000;

function sign(payload: string): string {
  return createHmac("sha256", env.appSecret).update(payload).digest("base64url");
}

/**
 * Подписанный токен человека: `<prefix><userId>.<истекает>.<подпись>`.
 * Общий для привязки Telegram (prefix "") и подтверждения почты ("ev.") —
 * секрет один, поэтому разные назначения различает только префикс.
 */
export function createSignedToken(prefix: string, userId: number, ttlMs: number, now: number = Date.now()): string {
  const payload = `${prefix}${userId}.${now + ttlMs}`;
  return `${payload}.${sign(payload)}`;
}

export const createLinkToken = (userId: number, now: number = Date.now()) => createSignedToken("", userId, LINK_TTL_MS, now);
export const readLinkToken = (token: string, now: number = Date.now()) => readSignedToken("", token, now);

/**
 * Разобрать токен из `/start` или из письма.
 *
 * Возвращает идентификатор пользователя или причину отказа. Причина нужна не
 * ради красоты: «ссылка устарела» и «ссылка поддельная» — это два разных
 * ответа человеку, и первый чинится нажатием кнопки заново.
 */
export function readSignedToken(prefix: string, token: string, now: number = Date.now()):
  { ok: true; userId: number } | { ok: false; reason: "expired" | "invalid" } {
  if (!token.startsWith(prefix)) return { ok: false, reason: "invalid" };
  const parts = token.slice(prefix.length).split(".");
  if (parts.length !== 3) return { ok: false, reason: "invalid" };

  const [rawId, rawExp, signature] = parts;
  const expected = sign(`${prefix}${rawId}.${rawExp}`);

  /*
    Сравнение постоянного времени. Обычное === выходит из цикла на первом
    несовпавшем байте, и по времени ответа подпись подбирается побайтно —
    приём старый и рабочий.
  */
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: "invalid" };

  const userId = Number(rawId);
  const expires = Number(rawExp);
  if (!Number.isInteger(userId) || userId <= 0 || !Number.isFinite(expires)) {
    return { ok: false, reason: "invalid" };
  }
  // Срок проверяется ПОСЛЕ подписи: иначе по разнице ответов можно отличить
  // «подпись верна, но просрочено» от «подпись неверна» и подбирать подпись.
  if (expires < now) return { ok: false, reason: "expired" };

  return { ok: true, userId };
}


/* ═══════════════════════════════════════════════════════════════════════════
   Код для связывания ГРУППЫ сотрудников.

   ── Чем отличается от личного ───────────────────────────────────────────────

   Личный токен несёт идентификатор человека: чат привязывается к нему одному.
   Групповой несёт организацию — потому что привязывается чат, а не человек, и
   получать события в нём будут все, кто в группе.

   Кто связал, тоже едет в токене: вопрос «кто добавил бота в наш чат» задают,
   и отвечать «не знаем» на него нельзя.

   ── Почему та же короткая жизнь ─────────────────────────────────────────────

   Четверть часа хватает открыть Telegram и вставить код в чат. Дольше —
   значит код успеет полежать в переписке, а он даёт право слить рабочие
   события организации в любой чат, куда его вставят.
   ═══════════════════════════════════════════════════════════════════════════ */

export function createGroupToken(tenantId: number, userId: number, now: number = Date.now()): string {
  const expires = now + LINK_TTL_MS;
  const payload = `g${tenantId}.${userId}.${expires}`;
  return `${payload}.${sign(payload)}`;
}

export function readGroupToken(token: string, now: number = Date.now()):
  { ok: true; tenantId: number; userId: number } | { ok: false; reason: "expired" | "invalid" } {
  const parts = token.split(".");
  if (parts.length !== 4) return { ok: false, reason: "invalid" };
  const [rawTenant, rawUser, rawExpires, signature] = parts;
  if (!rawTenant.startsWith("g")) return { ok: false, reason: "invalid" };

  const payload = `${rawTenant}.${rawUser}.${rawExpires}`;
  const expected = sign(payload);
  /*
    Сравнение постоянного времени — той же функцией, что и у личного токена.
    Обычное сравнение строк отвечает тем быстрее, чем раньше расходятся
    байты, и по времени ответа подпись подбирается.
  */
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: "invalid" };

  const expires = Number(rawExpires);
  if (!Number.isFinite(expires) || expires < now) return { ok: false, reason: "expired" };

  const tenantId = Number(rawTenant.slice(1));
  const userId = Number(rawUser);
  if (!Number.isInteger(tenantId) || tenantId <= 0) return { ok: false, reason: "invalid" };
  if (!Number.isInteger(userId) || userId <= 0) return { ok: false, reason: "invalid" };

  return { ok: true, tenantId, userId };
}
