import { randomBytes, createHash } from "crypto";
import { passwordResetTokens, users } from "@db/schema";
import { eq, and, gt, isNull } from "drizzle-orm";
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

export const PasswordResetService = {
  /**
   * Request a password reset. Always returns success to prevent user enumeration.
   */
  async request(db: Db, email: string, appUrl: string): Promise<{ success: true }> {
    const [user] = await db.select({ id: users.id, name: users.name })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (user) {
      const recentCount = await db.select({ count: passwordResetTokens.id })
        .from(passwordResetTokens)
        .where(and(
          eq(passwordResetTokens.userId, user.id),
          gt(passwordResetTokens.createdAt, new Date(Date.now() - RATE_LIMIT_WINDOW_MS)),
        ));

      if (recentCount.length >= RATE_LIMIT_MAX) {
        logger.warn("Password reset rate limited", { userId: user.id });
        return { success: true };
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
      try {
        await sendEmail({
          to: email,
          subject: "Сброс пароля — Warehouse Pro",
          html: `
            <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
              <h2 style="color:#111">Сброс пароля</h2>
              <p>Здравствуйте, ${user.name || ""}.</p>
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
