import { eq } from "drizzle-orm";
import { users } from "@db/schema";
import { verifyTotp } from "../lib/totp";
import { open } from "../lib/secret-box";

/*
  Второй фактор «здесь и сейчас» перед необратимым действием.

  Сессия живёт 30 дней, и украденной куки хватало на выгрузку всей базы или
  удаление организации. Код из приложения подтверждает, что это сам человек
  в эту минуту. Без включённого второго фактора действие закрыто вовсе —
  включается в профиле.

  Возвращает результат, а не бросает: HTTP-ручка отвечает своим кодом,
  tRPC-процедура — своим (см. assertTotpStepUp).
*/
export type StepUpFailure = "TOTP_NOT_ENROLLED" | "TOTP_REQUIRED" | "TOTP_INVALID";
export type StepUp = { ok: true } | { ok: false; code: StepUpFailure; message: string };

export const STEP_UP_MESSAGES: Record<StepUpFailure, string> = {
  TOTP_NOT_ENROLLED: "Действие доступно только со вторым фактором — включите его в профиле",
  TOTP_REQUIRED: "Введите код из приложения-аутентификатора",
  TOTP_INVALID: "Неверный код подтверждения",
};

type Db = { select: ReturnType<typeof import("../queries/connection").getDb>["select"] };

export async function checkTotpStepUp(db: Db, userId: number, code: string | undefined): Promise<StepUp> {
  const [row] = await db.select({ totpSecret: users.totpSecret, totpEnabledAt: users.totpEnabledAt })
    .from(users).where(eq(users.id, userId)).limit(1);
  const fail = (c: StepUpFailure): StepUp => ({ ok: false, code: c, message: STEP_UP_MESSAGES[c] });
  if (!row?.totpSecret || !row.totpEnabledAt) return fail("TOTP_NOT_ENROLLED");
  if (!code?.trim()) return fail("TOTP_REQUIRED");
  if (!verifyTotp(open(row.totpSecret), code.trim())) return fail("TOTP_INVALID");
  return { ok: true };
}
