import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createRouter, authedQuery, superAdminQuery } from "./middleware";
import { checkRateLimit, rateLimitSubject } from "./lib/rate-limit";
import {
  MAX_BODY, RETENTION_DAYS, hasSupportChat, requireSupportChat, threadMessages,
  unreadCount, markRead, postMessage, inbox, threadState, closeThread, purgeThreadNow,
} from "./services/support-chat";

/* ═══════════════════════════════════════════════════════════════════════════
   Чат поддержки: две стороны одного разговора.

   Сторона пользователя работает только со СВОИМ тредом — идентификаторы берутся
   из сессии, а не из запроса. Просить их у клиента было бы приглашением
   подставить чужой номер: любой вошедший читал бы переписку соседа.

   Сторона платформы (суперадмин) адресует тред явно — на то она и платформа.
   ═══════════════════════════════════════════════════════════════════════════ */

const bodyInput = z.object({ body: z.string().min(1).max(MAX_BODY) });

export const supportRouter = createRouter({
  /**
   * Мой разговор с поддержкой.
   *
   * Недоступность тарифа — это не ошибка, а состояние экрана: возвращается
   * признак, и страница показывает, что даёт Exclusive. Бросать здесь отказ
   * значило бы, что человек на тарифе Pro видит красную плашку сбоя вместо
   * объяснения.
   */
  thread: authedQuery
    .input(z.object({ before: z.number().int().positive().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const available = await hasSupportChat(ctx.tenant.id);
      /*
        Обе ветки отдают ОДИН набор полей.

        Иначе клиент получает объединение двух разных форм, и обращение к
        `closedAt` не проходит проверку типов ни в одной ветке — хотя на
        не-Exclusive экран до разговора и не доходит. Форма ответа не должна
        зависеть от тарифа: от него зависит содержимое.
      */
      if (!available) {
        return {
          available, messages: [], hasMore: false, unread: 0,
          closedAt: null, closedBy: null, purgeAt: null, retentionDays: RETENTION_DAYS,
        };
      }

      const [{ messages, hasMore }, unread, state] = await Promise.all([
        threadMessages(ctx.tenant.id, ctx.user.id, input?.before),
        unreadCount(ctx.tenant.id, ctx.user.id, true),
        threadState(ctx.tenant.id, ctx.user.id),
      ]);
      return { available, messages, hasMore, unread, ...state, retentionDays: RETENTION_DAYS };
    }),

  /**
   * Непрочитанные ответы поддержки — для значка в меню.
   *
   * Отдельно от `thread`, потому что спрашивается часто и всем, а история
   * нужна только на самом экране.
   */
  unread: authedQuery.query(async ({ ctx }) => {
    /*
      Признак доступности отдаётся вместе со счётчиком: по нему меню решает,
      показывать ли пункт вообще. Отдельным запросом это было бы два обращения
      на каждую отрисовку боковой панели ради одного и того же ответа.

      Суперадмин исключён здесь, а не в меню: он и есть та самая поддержка, и
      ссылка «написать в поддержку» вела бы его к самому себе.
    */
    const available = ctx.user.role !== "superadmin" && await hasSupportChat(ctx.tenant.id);
    if (!available) return { available, count: 0 };
    return { available, count: await unreadCount(ctx.tenant.id, ctx.user.id, true) };
  }),

  send: authedQuery
    .input(bodyInput)
    .mutation(async ({ ctx, input }) => {
      await requireSupportChat(ctx.tenant.id);

      /*
        Своя мера частоты, помимо общей. Поддержка — это живой человек на том
        конце, и десяток сообщений в минуту от одного отправителя ему не
        помогает, а мешает читать остальных.
      */
      const subject = rateLimitSubject(ctx.req, `user:${ctx.user.id}`);
      if (!(await checkRateLimit(subject, { windowMs: 60_000, limit: 10, namespace: "support-send" }))) {
        throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Слишком часто. Подождите минуту." });
      }

      return postMessage({
        tenantId: ctx.tenant.id,
        userId: ctx.user.id,
        fromPlatform: false,
        authorId: ctx.user.id,
        body: input.body,
      });
    }),

  /**
   * Завершить свой разговор.
   *
   * Закрывать может и клиент, и поддержка — решение владельца. Переписка после
   * этого живёт ещё неделю и стирается; передумали — достаточно написать снова,
   * разговор откроется заново.
   *
   * Тариф здесь НЕ проверяется намеренно: организация могла съехать с
   * Exclusive, и запретить ей закрыть собственный разговор значило бы держать
   * её переписку у себя ровно потому, что она перестала платить.
   */
  close: authedQuery.mutation(async ({ ctx }) => {
    await closeThread(ctx.tenant.id, ctx.user.id, "client");
    return { ok: true };
  }),

  /** Я прочитал ответы поддержки. */
  markRead: authedQuery.mutation(async ({ ctx }) => {
    if (!(await hasSupportChat(ctx.tenant.id))) return { ok: true };
    await markRead(ctx.tenant.id, ctx.user.id, true);
    return { ok: true };
  }),

  // ── Сторона платформы ─────────────────────────────────────────────────────

  inbox: superAdminQuery.query(() => inbox()),

  threadOf: superAdminQuery
    .input(z.object({
      tenantId: z.number().int().positive(),
      userId: z.number().int().positive(),
      before: z.number().int().positive().optional(),
    }))
    .query(async ({ input }) => {
      const { messages, hasMore } = await threadMessages(input.tenantId, input.userId, input.before);
      return { messages, hasMore };
    }),

  reply: superAdminQuery
    .input(z.object({
      tenantId: z.number().int().positive(),
      userId: z.number().int().positive(),
    }).merge(bodyInput))
    .mutation(async ({ ctx, input }) => {
      /*
        Тариф проверяется и здесь. Организация могла съехать с Exclusive, пока
        письмо висело непрочитанным: отвечать в чат, которого у неё больше нет,
        значит писать в пустоту — человек ответа не увидит.
      */
      await requireSupportChat(input.tenantId);
      return postMessage({
        tenantId: input.tenantId,
        userId: input.userId,
        fromPlatform: true,
        authorId: ctx.user.id,
        body: input.body,
      });
    }),

  /** Поддержка закрывает решённый вопрос. */
  closeThread: superAdminQuery
    .input(z.object({ tenantId: z.number().int().positive(), userId: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      await closeThread(input.tenantId, input.userId, "platform");
      return { ok: true };
    }),

  /**
   * Стереть переписку немедленно.
   *
   * Обычный порядок — завершить и подождать неделю. Эта ручка нужна для
   * случая, когда ждать нельзя: человек прислал в чат номер карты, паспорт
   * или пароль. Возврата нет, поэтому вызывается только с подтверждением на
   * экране и только суперадмином.
   */
  purgeNow: superAdminQuery
    .input(z.object({ tenantId: z.number().int().positive(), userId: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const { messages } = await purgeThreadNow(input.tenantId, input.userId);
      return { ok: true, messages };
    }),

  /** Поддержка прочитала обращения этого человека. */
  markThreadRead: superAdminQuery
    .input(z.object({ tenantId: z.number().int().positive(), userId: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      await markRead(input.tenantId, input.userId, false);
      return { ok: true };
    }),
});
