import type { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
import { TRPCError } from "@trpc/server";
import { isAppError } from "@contracts/errors";
import type { Tenant } from "@db/schema";
import { authenticateRequest, type AuthenticatedUser } from "./auth";
import { getDb } from "./queries/connection";

type DrizzleInstance = ReturnType<typeof getDb>;

export type TrpcContext = {
  req:        Request;
  resHeaders: Headers;
  user?:      AuthenticatedUser;
  tenant?:    Tenant;
  correlationId?: string;
  db:         DrizzleInstance;
};

export async function createContext(
  opts: FetchCreateContextFnOptions & { resHeaders?: Headers },
): Promise<TrpcContext> {
  const resHeaders = opts.resHeaders ?? new Headers();
  const ctx: TrpcContext = { req: opts.req, resHeaders, db: getDb() };
  try {
    const auth  = await authenticateRequest(opts.req.headers);
    ctx.user    = auth.user;
    ctx.tenant  = auth.tenant;
  } catch (e) {
    // Отказ по самому токену — обычное дело: на публичных путях (вход,
    // регистрация) его просто нет, и запрос идёт дальше без пользователя.
    if (!isAppError(e)) {
      // А это уже не «токен негодный», а «не удалось проверить»: база не
      // ответила, пул исчерпан, запрос упёрся в таймаут. Раньше оба случая
      // сходились в один — ctx.user пустой, requireAuth отвечает 401. Мобильный
      // клиент по 401 СТИРАЕТ сессию, поэтому секундная заминка базы
      // выбрасывала агента из аккаунта посреди дня, и войти он мог только
      // вручную, заново набрав пароль.
      //
      // Теперь такой сбой отвечает 500: клиент показывает ошибку и повторяет
      // запрос, сессия остаётся на месте.
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Не удалось проверить сессию. Повторите попытку.",
        cause: e,
      });
    }
  }
  return ctx;
}
