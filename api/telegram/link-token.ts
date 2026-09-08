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

export function createLinkToken(userId: number, now: number = Date.now()): string {
  const expires = now + LINK_TTL_MS;
  const payload = `${userId}.${expires}`;
  return `${payload}.${sign(payload)}`;
}

/**
 * Разобрать токен из `/start`.
 *
 * Возвращает идентификатор пользователя или причину отказа. Причина нужна не
 * ради красоты: «ссылка устарела» и «ссылка поддельная» — это два разных
 * ответа человеку, и первый чинится нажатием кнопки заново.
 */
export function readLinkToken(token: string, now: number = Date.now()):
  { ok: true; userId: number } | { ok: false; reason: "expired" | "invalid" } {
  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, reason: "invalid" };

  const [rawId, rawExp, signature] = parts;
  const payload = `${rawId}.${rawExp}`;
  const expected = sign(payload);

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
