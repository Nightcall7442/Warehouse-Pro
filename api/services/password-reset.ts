import { randomBytes, createHash } from "crypto";
import { passwordResetTokens, users, tenants } from "@db/schema";
import { eq, and, gt, isNull, sql } from "drizzle-orm";
import { hashPassword } from "../auth/password";
import { sendEmail } from "../lib/mailer";
import { logger } from "../lib/logger";

type Db = ReturnType<typeof import("../queries/connection").getDb>;

const TOKEN_EXPIRY_HOURS = 1;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const RATE_LIMIT_MAX = 3;

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

/**
 * Экранирование того, что попадает в письмо как разметка.
 *
 * В письмо подставляются имя пользователя и название организации, а название
 * организации приходит с публичной формы регистрации — то есть его пишет кто
 * угодно. Без экранирования «<a href="...">Ваш банк</a>» в названии
 * превращается в настоящую ссылку внутри письма, которое отправил доверенный
 * адрес платформы.
 */
function htmlEscape(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export const PasswordResetService = {
  /**
   * Request a password reset. Always returns success to prevent user enumeration.
   *
   * ── Почему по всем строкам, а не по первой ──────────────────────────────
   *
   * Один и тот же адрес живёт в нескольких организациях законно: вход
   * (/api/login) это прямо поддерживает и спрашивает, в какую из них войти.
   * Здесь же стояло `.limit(1)` без ORDER BY, то есть выбиралась произвольная
   * строка из нескольких.
   *
   * Что из этого выходило в поле: руководитель организации B заводит своему
   * курьеру адрес директора организации A — проверка уникальности в
   * user-router смотрит только внутри B и пропускает. Директор A жмёт «забыли
   * пароль», база отдаёт строку курьера B, и токен выпускается на чужой
   * аккаунт. Директор A переходит по ссылке из СВОЕГО письма, задаёт пароль —
   * и меняется пароль курьера организации B, а самому директору вход по-
   * прежнему закрыт. Ни одна из сторон при этом не видит, что произошло.
   *
   * Теперь обрабатываются все аккаунты с этим адресом: на каждый выпускается
   * свой токен и уходит своё письмо, и в письме названа организация — иначе
   * человек с двумя аккаунтами не поймёт, какую из ссылок открывать. Ответ
   * по-прежнему всегда { success: true }: перечисление адресов закрыто тем же,
   * чем и было.
   */
  async request(db: Db, email: string, appUrl: string): Promise<{ success: true }> {
    const accounts = await db.select({
      id:       users.id,
      name:     users.name,
      tenantId: users.tenantId,
      orgName:  tenants.name,
    })
      .from(users)
      .leftJoin(tenants, eq(users.tenantId, tenants.id))
      .where(eq(users.email, email));

    for (const user of accounts) {
      const recentCount = await db.select({ count: passwordResetTokens.id })
        .from(passwordResetTokens)
        .where(and(
          eq(passwordResetTokens.userId, user.id),
          gt(passwordResetTokens.createdAt, new Date(Date.now() - RATE_LIMIT_WINDOW_MS)),
        ));

      if (recentCount.length >= RATE_LIMIT_MAX) {
        // Лимит на аккаунт, а не на адрес: иначе три запроса по одному
        // аккаунту закрывали бы восстановление владельцу второго.
        logger.warn("Password reset rate limited", { userId: user.id });
        continue;
      }

      const rawToken = randomBytes(32).toString("hex");
      const tokenHash = sha256(rawToken);
      const expiresAt = new Date(Date.now() + TOKEN_EXPIRY_HOURS * 60 * 60 * 1000);

      await db.insert(passwordResetTokens).values({
        userId: user.id,
        tokenHash,
        expiresAt,
      });

      const resetUrl = `${appUrl}/reset-password?token=${rawToken}`;
      const orgLine = user.orgName
        ? `<p>Организация: <b>${htmlEscape(user.orgName)}</b>.</p>`
        : "";
      try {
        await sendEmail({
          to: email,
          subject: "Сброс пароля — Warehouse Pro",
          html: `
            <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
              <h2 style="color:#111">Сброс пароля</h2>
              <p>Здравствуйте, ${htmlEscape(user.name || "")}.</p>
              ${orgLine}
              <p>Вы запросили сброс пароля. Нажмите кнопку ниже, чтобы создать новый пароль:</p>
              <a href="${resetUrl}"
                 style="display:inline-block;margin:20px 0;padding:12px 24px;background:#4f46e5;color:#fff;border-radius:6px;text-decoration:none;font-weight:bold">
                Сбросить пароль
              </a>
              <p style="color:#666;font-size:12px">Ссылка действительна ${TOKEN_EXPIRY_HOURS} час. Если вы не запрашивали сброс — просто проигнорируйте это письмо.</p>
            </div>
          `,
        });
      } catch (err) {
        logger.error("Failed to send password reset email", { userId: user.id, error: String(err) });
      }
    }

    return { success: true };
  },

  /**
   * Confirm password reset with token.
   */
  async confirm(db: Db, token: string, newPassword: string): Promise<{ success: true }> {
    const tokenHash = sha256(token);

    const [resetToken] = await db.select()
      .from(passwordResetTokens)
      .where(and(
        eq(passwordResetTokens.tokenHash, tokenHash),
        isNull(passwordResetTokens.usedAt),
        gt(passwordResetTokens.expiresAt, new Date()),
      )).limit(1);

    if (!resetToken) {
      throw new Error("Ссылка недействительна или уже использована.");
    }

    const newHash = await hashPassword(newPassword);

    await db.transaction(async (tx) => {
      await tx.update(users)
        .set({ passwordHash: newHash })
        .where(eq(users.id, resetToken.userId));

      await tx.update(users)
        .set({ tokenVersion: sql`COALESCE(${users.tokenVersion}, 0) + 1` })
        .where(eq(users.id, resetToken.userId));

      await tx.update(passwordResetTokens)
        .set({ usedAt: new Date() })
        .where(eq(passwordResetTokens.id, resetToken.id));
    });

    logger.info("Password reset completed", { userId: resetToken.userId });
    return { success: true };
  },
};

// Backward-compatible aliases
export const requestPasswordReset = PasswordResetService.request.bind(PasswordResetService);
export const confirmPasswordReset = PasswordResetService.confirm.bind(PasswordResetService);
