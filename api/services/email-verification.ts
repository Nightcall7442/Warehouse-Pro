import { createHmac, timingSafeEqual } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { tenants, users } from "@db/schema";
import { env } from "../lib/env";
import { sendVerifyEmail } from "../lib/mailer";
import { logger } from "../lib/logger";

type Db = ReturnType<typeof import("../queries/connection").getDb>;

/**
 * Подтверждение почты при регистрации с сайта.
 *
 * ── Зачем ───────────────────────────────────────────────────────────────────
 *
 * Регистрация заводила директора на слово: адрес никто не проверял, и
 * директором чужого адреса становился любой — письма «пробный период
 * заканчивается» и сброс пароля уходили человеку, который ничего не
 * регистрировал. Решение владельца 21.09.2026: вход закрыт, пока по ссылке
 * из письма не пришли (users.email_verified_at).
 *
 * ── Почему без таблицы ──────────────────────────────────────────────────────
 *
 * Токен — подпись поверх идентификатора и срока, как у привязки Telegram
 * (telegram/link-token.ts). Хранить нечего и отзывать незачем:
 * подтверждение идемпотентно, а срок в три дня даёт письму дойти и
 * полежать. Повторное письмо выпускает свежий токен, старый остаётся годным
 * до своего срока — обе ссылки подтверждают один и тот же адрес.
 *
 * Нагрузка начинается с «ev.» — иначе токен привязки Telegram того же
 * человека (`<id>.<срок>.<подпись>`) подошёл бы и сюда: секрет один.
 */
export const VERIFY_TTL_MS = 3 * 24 * 60 * 60 * 1000;

function sign(payload: string): string {
  return createHmac("sha256", env.appSecret).update(payload).digest("base64url");
}

export function createEmailVerifyToken(userId: number, now: number = Date.now()): string {
  const payload = `ev.${userId}.${now + VERIFY_TTL_MS}`;
  return `${payload}.${sign(payload)}`;
}

export function readEmailVerifyToken(token: string, now: number = Date.now()):
  { ok: true; userId: number } | { ok: false; reason: "expired" | "invalid" } {
  const parts = token.split(".");
  if (parts.length !== 4 || parts[0] !== "ev") return { ok: false, reason: "invalid" };
  const [, rawId, rawExp, signature] = parts;
  const a = Buffer.from(signature);
  const b = Buffer.from(sign(`ev.${rawId}.${rawExp}`));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: "invalid" };
  const userId = Number(rawId);
  const expires = Number(rawExp);
  if (!Number.isInteger(userId) || userId <= 0 || !Number.isFinite(expires)) return { ok: false, reason: "invalid" };
  // Срок — после подписи: иначе по разнице ответов подпись подбирается.
  if (expires < now) return { ok: false, reason: "expired" };
  return { ok: true, userId };
}

export function verifyEmailUrl(appUrl: string, userId: number): string {
  return `${appUrl}/verify-email?token=${createEmailVerifyToken(userId)}`;
}

/** Письмо со ссылкой. Ошибка отправки гасится и пишется в журнал: регистрация уже прошла, письмо просят ещё раз. */
export async function sendVerification(to: string, name: string, orgName: string, appUrl: string, userId: number): Promise<void> {
  try {
    await sendVerifyEmail(to, name, orgName, verifyEmailUrl(appUrl, userId));
  } catch (err) {
    logger.error("Failed to send verification email", { userId, error: err instanceof Error ? err.message : String(err) });
  }
}

/** Подтвердить по ссылке из письма. Повтор безвреден. */
export async function confirmEmail(db: Db, token: string): Promise<{ ok: true }> {
  const read = readEmailVerifyToken(token);
  if (!read.ok) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: read.reason === "expired"
        ? "Ссылка устарела. Запросите новое письмо на странице входа."
        : "Ссылка недействительна.",
    });
  }
  await db.update(users)
    .set({ emailVerifiedAt: new Date() })
    .where(and(eq(users.id, read.userId), isNull(users.emailVerifiedAt)));
  return { ok: true };
}

/**
 * Письмо ещё раз — по адресу, всем неподтверждённым записям с ним.
 * Подтверждённым и несуществующим ничего не уходит; ответ у всех один.
 */
export async function resendVerification(db: Db, email: string, appUrl: string): Promise<void> {
  const pending = await db.select({ id: users.id, name: users.name, orgName: tenants.name })
    .from(users)
    .leftJoin(tenants, eq(users.tenantId, tenants.id))
    .where(and(eq(users.email, email), isNull(users.emailVerifiedAt)));
  for (const u of pending) {
    await sendVerification(email, u.name, u.orgName ?? "", appUrl, u.id);
  }
}
