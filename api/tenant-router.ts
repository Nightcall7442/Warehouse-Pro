import { inBackground } from "./lib/graceful-shutdown";
import { z } from "zod";
import { slugify, offboardConfirmWord } from "@contracts/tenant-slug";
import { randomUUID, randomBytes, createHash } from "crypto";
import { TRPCError } from "@trpc/server";
import { recordAudit } from "./services/audit-log";
import { createRouter, publicQuery, adminQuery, authedQuery, superAdminQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { tenants, users, settings, orders, products, shops, subscriptions, warehouses, apiKeys } from "@db/schema";
import { eq, and, ne, sql, count, sum, max } from "drizzle-orm";
import { hashPassword } from "./auth/password";
import { findTenantBySlug, listTenants } from "./queries/tenants";
import { seedSandbox, SANDBOX_ORDER_COUNT } from "./services/sandbox";
import { checkRateLimit, getClientIp, rateLimitSubject } from "./lib/rate-limit";
import { logger } from "./lib/logger";
import { checkPlanLimits } from "./lib/plan-limits";
import { sendEmail } from "./lib/mailer";
import { env } from "./lib/env";
import { notifyAdmin, tgMessages } from "./telegram-router";

import { rowsOf } from "./lib/db-rows";
import { PLAN_PRICES_UZS, type PlanKey } from "@contracts/constants";
import { checkTotpStepUp } from "./auth/step-up";
import { countTenantRows, offboardTenant, TenantNotSuspendedError } from "./services/tenant-offboard";
import { setManualAccessFor } from "./services/manual-access";
import { invalidateAuthTenant, invalidateAuthUser } from "./auth";
import { invalidateSubscriptionAccess } from "./lib/feature-gating";
import { sendVerification } from "./services/email-verification";
import { normalizeUzPhone, PHONE_ERROR, SIGNUP_ANSWERS, composeSignupSource, describeSignupSource } from "@contracts/signup";
/**
 * Ограничения на публичную регистрацию.
 *
 * Раньше здесь был один лимит, и ключом ему служил getClientIp(ctx.req). Тот
 * возвращает null, пока не задан TRUSTED_PROXY_COUNT — а он не задан, это
 * умолчание и это же деплой. checkRateLimit(null) пропускает всё, поэтому
 * ограничения на регистрацию не существовало вовсе: скрипт мог гнать заявки
 * подряд без счёта.
 *
 * Теперь считаем по тому, что сервер знает наверняка: по адресу и по названию
 * организации. Лимит по IP оставлен третьим — он заработает сам, как только
 * прокси будет описан, и не мешает, пока не описан.
 */
const REGISTER_IP_RATE_LIMIT    = { windowMs: 60 * 60 * 1000, limit: 20, namespace: "register" };
const REGISTER_EMAIL_RATE_LIMIT = { windowMs: 60 * 60 * 1000, limit: 5,  namespace: "registerEmail" };
const REGISTER_ORG_RATE_LIMIT   = { windowMs: 60 * 60 * 1000, limit: 5,  namespace: "registerOrg" };

/**
 * Ответ на заявку о регистрации — один и тот же, занят адрес или нет.
 *
 * С 21.09.2026 обе ветки честно говорят «письмо ушло»: свободному адресу —
 * ссылка подтверждения, занятому — «на этот адрес уже есть аккаунт». Вход
 * до подтверждения закрыт (services/email-verification.ts).
 *
 * Это не косметика, а сама суть правки: пока на занятый адрес приходил
 * CONFLICT «Email already registered», а на свободный — успех, неаутентифи-
 * цированный скрипт превращал форму регистрации в справочник «у кого на
 * платформе есть аккаунт». Список сотрудников организаций-клиентов
 * прогонялся через неё целиком, и на выходе получалась готовая цель для
 * фишинга и подбора паролей на /api/login.
 *
 * Собрано в одну функцию, чтобы две ветки не разъехались при следующей
 * правке: разойдись они хоть текстом сообщения, различие вернётся.
 */
function registrationAccepted(slug: string) {
  return { slug, message: "Письмо отправлено. Откройте ссылку из него, чтобы подтвердить адрес и войти." };
}

/**
 * Письмо тому, кто попытался зарегистрироваться на уже занятый адрес.
 *
 * Раз ответ формы одинаковый, узнать правду человек должен из почты — иначе
 * владелец адреса будет ждать организацию, которой не появилось. Заодно это
 * сигнал самому владельцу: кто-то называл его адрес на форме регистрации.
 *
 * Ошибка отправки гасится здесь: sendEmail в проде пробрасывает исключение
 * дальше, а исключение на этой ветке — это снова отличие от успешной, то есть
 * ровно та утечка, которую письмо и закрывает.
 */
async function notifyEmailAlreadyRegistered(email: string, appUrl: string): Promise<void> {
  try {
    await sendEmail({
      to: email,
      subject: "Warehouse Pro — на этот адрес уже есть аккаунт",
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
          <h2 style="color:#111">Регистрация не требуется</h2>
          <p>На форме регистрации Warehouse Pro был указан этот адрес, но аккаунт с ним уже существует.</p>
          <p>Если это были вы — просто войдите: <a href="${appUrl}/login">${appUrl}/login</a>.
             Забыли пароль — воспользуйтесь восстановлением на странице входа.</p>
          <p style="color:#666;font-size:12px">Если вы ничего не отправляли, ничего делать не нужно: новая организация не создана и ваш пароль не менялся.</p>
        </div>
      `,
    });
  } catch (err) {
    logger.error("Failed to send 'email already registered' notice", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Телефон с формы регистрации → +998XXXXXXXXX, иначе отказ одним понятным
 * текстом (contracts/signup.ts).
 *
 * `optional()` здесь не значит «можно без телефона»: без него zod 4 выдал бы
 * своё «Неверный формат поля», и человек не понял бы, чего от него хотят.
 * Пустое поле и кривой номер получают один и тот же отказ с подсказкой.
 */
const signupPhone = z.string().max(40).optional().transform((raw, ctx) => {
  const phone = normalizeUzPhone(raw);
  if (!phone) {
    ctx.addIssue({ code: "custom", message: PHONE_ERROR.ru });
    return z.NEVER;
  }
  return phone;
});

/**
 * Новая регистрация — владельцу платформы в Telegram, с телефоном ссылкой tel:.
 *
 * Принимает ли Telegram ссылку tel: в разметке сообщения, в документации не
 * сказано, а проверить на боевом боте отсюда нельзя. Если он откажет всему
 * сообщению, регистрация пропадёт из чата молча — ровно то, ради чего телефон
 * и спрашивают. Поэтому отказ повторяется без ссылки: номер в международном
 * виде Telegram и сам делает нажимаемым.
 *
 * Ошибки не бросает: регистрация уже лежит в tenants, и сбой Telegram её не
 * отменяет — это просто уведомление.
 */
async function announceRegistration(card: Parameters<typeof tgMessages.newRegistration>[0]): Promise<void> {
  try {
    if (await notifyAdmin(tgMessages.newRegistration(card))) return;
    await notifyAdmin(tgMessages.newRegistration({ ...card, phoneAsText: true }));
  } catch (err) {
    logger.error("registration notice failed", { error: err instanceof Error ? err.message : String(err) });
  }
}


export const tenantRouter = createRouter({
  // ── Публичная регистрация ──────────────────────────────────────────────────
  register: publicQuery
    .input(z.object({
      orgName:  z.string().min(2).max(100),
      name:     z.string().min(2).max(100),
      email:    z.string().email(),
      password: z.string().min(8),
      phone:    signupPhone,
      /*
        «Откуда узнали» и метки из адреса страницы. Всё необязательно: не
        ответил — регистрация та же. Метки чистятся при записи
        (composeSignupSource), здесь — только потолок длины.

        Не прошло потолок — поле отбрасывается (`catch`), а не отказ всей
        форме: метку из рекламной ссылки человек не видел и исправить не
        может, и «ref слишком длинное» стоило бы нам регистрации.
      */
      source: z.object({
        answer:    z.enum(SIGNUP_ANSWERS).optional().catch(undefined),
        utmSource: z.string().max(200).optional().catch(undefined),
        ref:       z.string().max(200).optional().catch(undefined),
      }).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const emailKey = input.email.trim().toLowerCase();
      const orgKey   = input.orgName.trim().toLowerCase();

      const tooMany = new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Too many registration attempts." });
      if (!(await checkRateLimit(rateLimitSubject(ctx.req, `email:${emailKey}`), REGISTER_EMAIL_RATE_LIMIT))) throw tooMany;
      if (!(await checkRateLimit(rateLimitSubject(ctx.req, `org:${orgKey}`), REGISTER_ORG_RATE_LIMIT))) throw tooMany;
      if (!(await checkRateLimit(getClientIp(ctx.req), REGISTER_IP_RATE_LIMIT))) throw tooMany;

      const db = getDb();
      let slug = slugify(input.orgName);
      const base = slug;
      let attempt = 1;
      while (await findTenantBySlug(slug)) {
        if (attempt > 100) throw new TRPCError({ code: "CONFLICT", message: "Unable to generate unique slug." });
        slug = `${base}-${attempt++}`;
      }

      // Хеширование до ветвления, а не после: оно занимает сотни миллисекунд и
      // на фоне остальных запросов заметно. Останься оно только на ветке
      // «адрес свободен» — ответы двух веток различались бы временем, и
      // перечисление адресов вернулось бы через секундомер, хотя тексты
      // ответов совпадают.
      const passwordHash = await hashPassword(input.password);

      const existing = await db.select({ id: users.id }).from(users)
        .where(eq(users.email, input.email)).limit(1);
      if (existing.length) {
        // Организация не создаётся, пароль существующего аккаунта не трогается —
        // просто письмо владельцу адреса. Ответ ниже такой же, как у успеха.
        await notifyEmailAlreadyRegistered(input.email, env.appUrl ?? "http://localhost:3000");
        logger.warn("Registration attempt on an existing email", { slug });
        return registrationAccepted(slug);
      }

      const trialEnds = new Date(Date.now() + 14 * 86_400_000);
      const signupSource = composeSignupSource(input.source);

      const userId = await db.transaction(async (tx) => {
        /*
          Телефон и почта — в карточку организации: по ним перезванивают и по
          заявке на тариф (billing-router, callbackContact), и из панели
          владельца. Раньше здесь не было ни того ни другого, и заявка
          приходила с «📞 не указан». Организация новая — почта владельца у
          неё заведомо пуста.
        */
        const [tenantResult] = await tx.insert(tenants).values({
          slug, name: input.orgName, plan: "trial", status: "active",
          trialEndsAt: trialEnds,
          ownerPhone: input.phone, ownerEmail: input.email,
          signupSource,
        });
        const tenantId = Number(tenantResult.insertId);
        // Адрес с публичной формы никто не проверял — вход закрыт до ссылки
        // из письма. Все прочие пути создания человека берут умолчание
        // «подтверждён» (см. схему).
        const [userResult] = await tx.insert(users).values({
          tenantId, name: input.name, email: input.email,
          passwordHash, role: "ceo", status: "active", lastSignInAt: new Date(),
          emailVerifiedAt: null,
        });
        await tx.insert(settings).values({ tenantId, companyName: input.orgName });
        // Create default warehouse so products get stock rows
        await tx.insert(warehouses).values({
          tenantId, name: "Основной склад", isDefault: true, status: "active",
        });
        // P1-13 FIX: Create trial subscription inside the transaction to prevent tenant without subscription
        await tx.insert(subscriptions).values({
          id: randomUUID(),
          tenantId,
          plan: "trial",
          status: "trialing",
          trialEndsAt: trialEnds,
          currentPeriodEnds: trialEnds,
        });
        return Number(userResult.insertId);
      });

      /*
        Суперадмину — сразу и ДО письма, а не в вечерней сводке: новую
        организацию встречают звонком в первый час, потом она либо работает,
        либо ушла. Письмо подтверждения может уйти в спам или не уйти вовсе —
        телефон в чате владельца от этого не зависит.
      */
      inBackground(announceRegistration({
        org: input.orgName, email: input.email, phone: input.phone,
        source: describeSignupSource(signupSource),
      }));

      await sendVerification(input.email, input.name, input.orgName, env.appUrl ?? "http://localhost:3000", userId);

      return registrationAccepted(slug);
    }),

  // ── Текущий тенант ─────────────────────────────────────────────────────────
  /*
    Ручка «текущая организация» жила здесь и не вызывалась ниоткуда: те же
    поля приходят вместе с auth.me, которым экраны и пользуются. Второй ответ
    на тот же вопрос однажды разойдётся с первым.
  */

  // ── Invite user внутри тенанта ─────────────────────────────────────────────
  inviteUser: adminQuery
    .input(z.object({
      name:     z.string().min(2).max(100),
      email:    z.string().email(),
      password: z.string().min(8),
      role:     z.enum(["ceo", "operator", "agent", "supervisor", "merchandiser", "courier"]),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      // Внутри своей организации, не по всей платформе (оракул — аудит 20.09.2026).
      const existing = await db.select({ id: users.id }).from(users)
        .where(and(eq(users.email, input.email), eq(users.tenantId, ctx.tenant.id))).limit(1);
      if (existing.length) throw new TRPCError({ code: "CONFLICT", message: "Этот адрес уже есть среди сотрудников вашей организации." });

      const limits = await checkPlanLimits(db, ctx.tenant.id, 'users');
      if (!limits.allowed) {
        throw new TRPCError({ code: 'FORBIDDEN', message: `Достигнут лимит пользователей (${limits.current}/${limits.limit})` });
      }

      const passwordHash = await hashPassword(input.password);
      await db.insert(users).values({
        tenantId: ctx.tenant.id, name: input.name, email: input.email,
        passwordHash, role: input.role, status: "active", lastSignInAt: new Date(),
      });
      return { success: true };
    }),

  // ══════════════════════════════════════════════════════════════════════════
  // SUPER ADMIN endpoints
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Список всех организаций — для раздела «Организации» консоли платформы.
   *
   * ── Что было ──────────────────────────────────────────────────────────────
   *
   * Счётчики за всё время (люди, заказы, сумма) и подписка. Чтобы понять,
   * работает ли клиент сейчас, приходилось открывать карточку: ни заказов за
   * месяц, ни последней активности, ни телефона, ни ИНН — а искать клиента
   * владелец платформы чаще всего начинает именно по ним.
   *
   * ── Что добавлено ─────────────────────────────────────────────────────────
   *
   * Заказы и выручка за 30 дней (без отменённых и удалённых), последний заказ,
   * последний вход, телефон и почта для связи (из карточки, иначе директора —
   * то же правило, что в панели владельца), ИНН из реквизитов. Прежние поля
   * не тронуты: старые копии страницы читают их как раньше.
   *
   * Всё — шестью сгруппированными запросами на весь список, без запроса на
   * организацию: заказы одним проходом по (tenant_id, created_at) — прежние
   * счётчики за всё время и новые за 30 дней в одном GROUP BY; «30 дней» —
   * NOW() самой базы, чтобы граница не зависела от часового пояса сервера.
   */
  list: superAdminQuery.query(async () => {
    const db = getDb();

    const [allTenants, userStats, orderStats, subs, ceos, innRows] = await Promise.all([
      listTenants(),
      // Люди: сколько и когда кто-то входил последним. max() построителя, а не
      // сырой SQL — drizzle сам читает время как UTC (см. services/owner-panel).
      db.select({ tenantId: users.tenantId, cnt: count(users.id), lastLogin: max(users.lastSignInAt) })
        .from(users)
        .groupBy(users.tenantId),
      db.select({
        tenantId:  orders.tenantId,
        cnt:       count(orders.id),
        total:     sum(orders.total),
        lastOrder: max(orders.createdAt),
        cnt30:     sql<string>`SUM(${orders.createdAt} >= NOW() - INTERVAL 30 DAY AND ${orders.deletedAt} IS NULL AND ${orders.status} <> 'cancelled')`,
        total30:   sql<string>`SUM(CASE WHEN ${orders.createdAt} >= NOW() - INTERVAL 30 DAY AND ${orders.deletedAt} IS NULL AND ${orders.status} <> 'cancelled' THEN ${orders.total} ELSE 0 END)`,
      })
        .from(orders)
        .groupBy(orders.tenantId),
      /*
        Подписка — то, что на деле пускает в работу (lib/feature-gating.ts).
        Без неё список судил по tenants.trial_ends_at, который у организации
        с сайта остаётся навсегда, и платящий клиент горел красным «Trial истёк».
      */
      db.select({
        tenantId: subscriptions.tenantId, status: subscriptions.status, plan: subscriptions.plan,
        trialEndsAt: subscriptions.trialEndsAt, currentPeriodEnds: subscriptions.currentPeriodEnds,
      })
        .from(subscriptions),
      // Контакт на случай, если у организации своего нет (заведена до сбора телефона).
      db.select({ tenantId: users.tenantId, phone: users.phone, email: users.email })
        .from(users).where(eq(users.role, "ceo")).orderBy(users.id),
      db.select({ tenantId: settings.tenantId, inn: settings.companyInn }).from(settings),
    ]);

    const userMap  = new Map(userStats.map(r => [Number(r.tenantId), r]));
    const orderMap = new Map(orderStats.map(r => [Number(r.tenantId), r]));
    const subMap   = new Map(subs.map(({ tenantId, ...s }) => [Number(tenantId), s]));
    const innMap   = new Map(innRows.map(r => [Number(r.tenantId), r.inn]));
    const ceoMap   = new Map<number, { phone: string | null; email: string }>();
    for (const c of ceos) if (!ceoMap.has(Number(c.tenantId))) ceoMap.set(Number(c.tenantId), { phone: c.phone, email: c.email });
    const asDate = (v: unknown): Date | null => (v ? new Date(v as string | Date) : null);
    const { clientFlags } = await import("./services/owner-panel");
    const now = new Date();

    return allTenants.map(t => {
      const u = userMap.get(t.id);
      const o = orderMap.get(t.id);
      const ceo = ceoMap.get(t.id);
      const lastOrderAt = asDate(o?.lastOrder);
      const lastLoginAt = asDate(u?.lastLogin);
      const latest = [lastOrderAt, lastLoginAt].filter((d): d is Date => d !== null)
        .reduce<Date | null>((a, d) => (!a || d > a ? d : a), null);
      const lastActivityAt = latest ?? t.createdAt;
      const sub = subMap.get(t.id);
      const plan = (sub?.plan ?? t.plan) as PlanKey;
      const trialEnds = sub?.trialEndsAt ?? t.trialEndsAt ?? null;
      /*
        Сегменты для фильтров консоли — тем же правилом, что панель владельца
        (services/owner-panel, clientFlags): плитка «Молчат 5+ дней» и фильтр
        с тем же названием обязаны показывать одних и тех же. Клиент — не
        песочница и не приостановленная (системную listTenants уже убрал).
      */
      const client = !t.isSandbox && t.status === "active";
      const f = clientFlags({
        plan, subStatus: sub?.status ?? null, subPeriodEnds: sub?.currentPeriodEnds ?? null, trialEnds, lastActivityAt,
      }, now);
      return {
        ...t,
        userCount:  Number(u?.cnt ?? 0),
        orderCount: Number(o?.cnt ?? 0),
        orderTotal: Number(o?.total ?? 0),
        subscription: subMap.get(t.id) ?? null,
        // Деньги — целыми сумами: копейки в списке никому не нужны, а дробь
        // из DECIMAL расползается по ячейкам.
        orders30:   Number(o?.cnt30 ?? 0),
        revenue30:  Math.round(Number(o?.total30 ?? 0)),
        lastOrderAt,
        lastLoginAt,
        lastActivityAt,
        segment: {
          client,
          paying:       client && f.isPaying,
          trial:        client && sub?.status === "trialing",
          trialLive:    client && f.trialLive,
          renewalDays:  client ? f.renewalDays : null,
          silentDays:   client ? f.silentDays : null,
          active7:      client && f.active7,
          price:        client && f.isPaying ? PLAN_PRICES_UZS[plan] ?? 0 : 0,
        },
        // `||`, а не `??`: пустая строка в карточке — тоже «нет телефона».
        contactPhone: t.ownerPhone || ceo?.phone || null,
        contactEmail: t.ownerEmail || ceo?.email || null,
        inn: innMap.get(t.id) || null,
      };
    });
  }),

  /**
   * Докупить места или товары сверх тарифа.
   *
   * У арендатора на Basic кончились пятьдесят позиций номенклатуры, а переходить
   * на Pro ради десяти новых незачем. Раньше выход был один — поднять тариф
   * целиком; теперь суперадмин добавляет ровно столько, сколько нужно.
   *
   * Задаётся ИТОГОВОЕ число докупленного, а не «добавить ещё N»: так значение
   * в поле совпадает с тем, что видно на экране, и повторное нажатие ничего не
   * удваивает. Ноль возвращает арендатора к тарифному пределу.
   *
   * Потолок в тысячу — от промаха на клавиатуре: «5000» вместо «500» это
   * двадцать пять миллионов сум в месяц, и заметят это не сразу.
   */
  setExtraLimits: superAdminQuery
    .input(z.object({
      tenantId: z.number().int().positive(),
      extraUsers: z.number().int().min(0).max(1000),
      extraProducts: z.number().int().min(0).max(1000),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const [tenant] = await db.select({ id: tenants.id })
        .from(tenants).where(eq(tenants.id, input.tenantId)).limit(1);
      if (!tenant) throw new TRPCError({ code: "NOT_FOUND", message: "Организация не найдена" });

      await db.update(tenants)
        .set({ extraUsers: input.extraUsers, extraProducts: input.extraProducts })
        .where(eq(tenants.id, input.tenantId));

      /*
        Кто и когда раздал места — вопрос денег, и ответ на него должен
        остаться. Тариф меняют через updatePlan, и там запись в журнал уже есть.
      */
      await recordAudit(db, {
        tenantId: input.tenantId,
        actorId: ctx.user.id,
        actorName: ctx.user.name,
        action: "tenant.extra_limits",
        targetType: "tenant",
        targetId: input.tenantId,
        meta: { extraUsers: input.extraUsers, extraProducts: input.extraProducts },
      });

      return { extraUsers: input.extraUsers, extraProducts: input.extraProducts };
    }),

  /** Детальный профиль одного тенанта */
  getDetail: superAdminQuery
    .input(z.object({ tenantId: z.number() }))
    .query(async ({ input }) => {
      const db = getDb();

      const [tenant] = await db.select({
        id: tenants.id, slug: tenants.slug, name: tenants.name, plan: tenants.plan,
        status: tenants.status, trialEndsAt: tenants.trialEndsAt, planExpiresAt: tenants.planExpiresAt,
        ownerEmail: tenants.ownerEmail, ownerPhone: tenants.ownerPhone,
        maxUsers: tenants.maxUsers, maxProducts: tenants.maxProducts, maxOrdersMonth: tenants.maxOrdersMonth,
        extraUsers: tenants.extraUsers, extraProducts: tenants.extraProducts,
        manualEnabledAt: tenants.manualEnabledAt,
        createdAt: tenants.createdAt, updatedAt: tenants.updatedAt,
      }).from(tenants).where(eq(tenants.id, input.tenantId)).limit(1);
      if (!tenant) throw new TRPCError({ code: "NOT_FOUND", message: "Tenant not found." });

      const [subscription, tenantUsers, orderStat, productStat, shopStat] = await Promise.all([
        db.select({
          id: subscriptions.id, plan: subscriptions.plan, status: subscriptions.status,
          trialEndsAt: subscriptions.trialEndsAt, currentPeriodEnds: subscriptions.currentPeriodEnds,
        }).from(subscriptions).where(eq(subscriptions.tenantId, input.tenantId)).limit(1),
        db.select({
          id: users.id, name: users.name, email: users.email,
          role: users.role, status: users.status, lastSignInAt: users.lastSignInAt,
          createdAt: users.createdAt,
        }).from(users).where(eq(users.tenantId, input.tenantId)),
        db.select({ cnt: count(orders.id), total: sum(orders.total) })
          .from(orders).where(eq(orders.tenantId, input.tenantId)),
        db.select({ cnt: count(products.id) })
          .from(products).where(eq(products.tenantId, input.tenantId)),
        db.select({ cnt: count(shops.id) })
          .from(shops).where(eq(shops.tenantId, input.tenantId)),
      ]);

      // Заказы по месяцам (последние 6)
      const monthlyOrders = await db.execute(sql`
        SELECT
          DATE_FORMAT(created_at, '%Y-%m') AS month,
          COUNT(*) AS cnt,
          COALESCE(SUM(total), 0) AS total
        FROM orders
        WHERE tenant_id = ${input.tenantId}
          AND created_at >= DATE_SUB(NOW(), INTERVAL 6 MONTH)
        GROUP BY month
        ORDER BY month ASC
      `);

      return {
        tenant,
        subscription: subscription ?? null,
        users:        tenantUsers,
        stats: {
          orders:   Number(orderStat[0]?.cnt   ?? 0),
          revenue:  Number(orderStat[0]?.total ?? 0),
          products: Number(productStat[0]?.cnt ?? 0),
          shops:    Number(shopStat[0]?.cnt    ?? 0),
        },
        monthlyOrders: rowsOf<{ month: string; cnt: string; total: string }>(monthlyOrders).map(r => ({
          month:   r.month,
          orders:  Number(r.cnt),
          revenue: Number(r.total),
        })),
      };
    }),

  /** Создать тенант вручную (суперадмин) */
  create: superAdminQuery
    .input(z.object({
      orgName:       z.string().min(2).max(100),
      ownerName:     z.string().min(2).max(100),
      ownerEmail:    z.string().email(),
      ownerPassword: z.string().min(8),
      plan:          z.enum(["trial", "basic", "pro", "exclusive"]).default("trial"),
      trialDays:     z.number().min(1).max(365).default(14),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();

      let slug = slugify(input.orgName);
      const base = slug;
      let attempt = 1;
      while (await findTenantBySlug(slug)) {
        if (attempt > 100) throw new TRPCError({ code: "CONFLICT", message: "Unable to generate unique slug." });
        slug = `${base}-${attempt++}`;
      }

      const existing = await db.select({ id: users.id }).from(users)
        .where(eq(users.email, input.ownerEmail)).limit(1);
      if (existing.length) throw new TRPCError({ code: "CONFLICT", message: "Email already registered." });

      const passwordHash  = await hashPassword(input.ownerPassword);
      /*
        Тариф и срок — одни и те же в обеих таблицах.

        Раньше в tenants писались выбранный тариф и срок, а подписка
        заводилась всегда пробной на 14 дней. Пускает в работу подписка
        (lib/feature-gating.ts), поэтому организацию, созданную как Pro или с
        пробным на 30 дней, запирало на пятнадцатый день — а карточка
        показывала «Pro, 30 дн.».

        Подписка — в той же транзакции: снаружи её сбой гасился в журнал, и
        организация без подписки оставалась запертой с первого входа.
      */
      const isTrial       = input.plan === "trial";
      const trialEndsAt   = isTrial ? new Date(Date.now() + input.trialDays * 86_400_000) : null;
      const planExpiresAt = isTrial ? null : new Date(Date.now() + 30 * 86_400_000);

      let tenantId: number;
      await db.transaction(async (tx) => {
        const [r] = await tx.insert(tenants).values({
          slug, name: input.orgName, plan: input.plan,
          status: "active", trialEndsAt, planExpiresAt,
          ownerEmail: input.ownerEmail,
        });
        tenantId = Number(r.insertId);

        await tx.insert(users).values({
          tenantId, name: input.ownerName, email: input.ownerEmail,
          passwordHash, role: "ceo", status: "active", lastSignInAt: new Date(),
        });
        await tx.insert(settings).values({ tenantId, companyName: input.orgName });
        await tx.insert(subscriptions).values({
          id: randomUUID(), tenantId, plan: input.plan,
          status: isTrial ? "trialing" : "active",
          trialEndsAt, currentPeriodEnds: trialEndsAt ?? planExpiresAt,
        });
      });

      return { success: true, slug, tenantId: tenantId! };
    }),

  /* ═════════════════════════════════════════════════════════════════════════
     Песочница для интеграторов.

     ── Зачем ────────────────────────────────────────────────────────────────

     Чужая сторона, которая подключается к выгрузке, обязана где-то проверить
     листание, снимок и отказы 401/403/429. Без песочницы она проверяет это на
     боевых данных настоящего арендатора — с его суммами и телефонами его
     магазинов на чужом экране. ТЗ BEKDRINKS запрещает это прямым текстом
     (пункт 13) и требует отдельную среду (16-6).

     ── Что здесь заводится ──────────────────────────────────────────────────

     Отдельная организация с пометкой песочницы, выдуманными данными и своим
     ключом. Тариф — Exclusive с дальним сроком, потому что выгрузка продаётся
     как его возможность и иначе ключ получил бы 403 при первом же запросе; за
     деньги это не считается: подписка заводится вручную и Stripe не трогает.

     ── Чем это не может стать ───────────────────────────────────────────────

     Способом залить выдумку в живого арендатора: seedSandbox отказывается
     работать где угодно, кроме ПУСТОЙ организации с пометкой песочницы, и
     ничего не удаляет.

     Ключ отдаётся ОДИН раз — как и обычный. Хранится только его отпечаток,
     показать повторно нечего.
     ═════════════════════════════════════════════════════════════════════════ */
  createSandbox: superAdminQuery
    .input(z.object({
      /* Кому её выдаём — попадёт в название, чтобы песочницы не путались
         между собой, когда интеграторов станет несколько. */
      partnerName:   z.string().min(2).max(60),
      ownerEmail:    z.string().email(),
      ownerPassword: z.string().min(8),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();

      let slug = slugify(`sandbox ${input.partnerName}`);
      const base = slug;
      let attempt = 1;
      while (await findTenantBySlug(slug)) {
        if (attempt > 100) throw new TRPCError({ code: "CONFLICT", message: "Не удалось подобрать адрес песочницы." });
        slug = `${base}-${attempt++}`;
      }

      const existing = await db.select({ id: users.id }).from(users)
        .where(eq(users.email, input.ownerEmail)).limit(1);
      if (existing.length) throw new TRPCError({ code: "CONFLICT", message: "Этот адрес уже занят." });

      const name = `Песочница — ${input.partnerName}`;
      const passwordHash = await hashPassword(input.ownerPassword);
      // Год: достаточно на подключение и приёмку, и не «навсегда» — брошенная
      // песочница перестанет отвечать сама.
      const expiresAt = new Date(Date.now() + 365 * 86_400_000);

      let tenantId: number;
      await db.transaction(async (tx) => {
        const [t] = await tx.insert(tenants).values({
          slug, name, plan: "exclusive", status: "active",
          planExpiresAt: expiresAt, ownerEmail: input.ownerEmail,
          isSandbox: true,
        });
        tenantId = Number(t.insertId);

        await tx.insert(users).values({
          tenantId, name: `${input.partnerName} (интегратор)`, email: input.ownerEmail,
          passwordHash, role: "ceo", status: "active", lastSignInAt: new Date(),
        });
        await tx.insert(settings).values({ tenantId, companyName: name });
        await tx.insert(subscriptions).values({
          id: randomUUID(), tenantId, plan: "exclusive",
          status: "active", currentPeriodEnds: expiresAt,
        });
      });

      // Данные — вне сделки: их триста двадцать заказов с позициями, и держать
      // на это время открытую транзакцию незачем. Если заполнение сорвётся,
      // останется пустая песочница — то есть ровно то состояние, которое
      // seedSandbox умеет заполнить повторно.
      const contents = await seedSandbox(db, tenantId!);

      /*
        Ключ с приметой «test», а не «live».

        Проверяется он отпечатком, и приставка ни на что не влияет технически.
        Влияет она на человека: ключ живёт в настройках у чужой стороны, и
        перепутать там песочницу с боем — это отчёт по выдуманным числам,
        отправленный заказчику.
      */
      const raw = "wp_test_" + randomBytes(24).toString("hex");
      await db.insert(apiKeys).values({
        tenantId: tenantId!,
        name: `Песочница ${input.partnerName}`,
        keyHash: createHash("sha256").update(raw).digest("hex"),
        keyPrefix: raw.slice(0, 12),
        scopes: "read",
        // Тот же потолок, что у боевого ключа по умолчанию: испытание 429
        // должно упираться в ту же стену, что и настоящая работа.
        rateLimit: 60,
        expiresAt,
      });

      await recordAudit(db, {
        tenantId: tenantId!,
        actorId: ctx.user.id,
        actorName: ctx.user.name,
        action: "tenant.sandbox.create",
        targetType: "tenant",
        targetId: tenantId!,
        meta: { slug, partner: input.partnerName, orders: contents.orders },
      });

      return {
        tenantId: tenantId!,
        slug,
        name,
        /* Один раз. Дальше показать нечего — хранится только отпечаток. */
        key: raw,
        expiresAt,
        contents,
        orderCount: SANDBOX_ORDER_COUNT,
      };
    }),

  /** Обновить тариф */
  updatePlan: superAdminQuery
    .input(z.object({
      tenantId:   z.number(),
      plan:       z.enum(["trial", "basic", "pro", "exclusive"]),
      expiryDays: z.number().min(1).max(3650).default(30),
    }))
    .mutation(async ({ input }) => {
      const db  = getDb();
      const now = new Date();
      /*
        Продление считается от конца ОПЛАЧЕННОГО, если он ещё впереди.

        Раньше — всегда от сегодня: клиент, заплативший за неделю до конца,
        терял эту неделю. Пробные дни не оплачены и не переносятся: переход с
        пробного на платный идёт от дня включения.
      */
      const [sub] = await db.select({ status: subscriptions.status, ends: subscriptions.currentPeriodEnds })
        .from(subscriptions).where(eq(subscriptions.tenantId, input.tenantId)).limit(1);
      const paidUntil   = sub?.status === "active" && sub.ends && sub.ends > now ? sub.ends : now;
      const planExpires = new Date(paidUntil.getTime() + input.expiryDays * 86_400_000);

      await db.transaction(async (tx) => {
        await tx.update(tenants)
          .set({ plan: input.plan, planExpiresAt: planExpires, updatedAt: new Date() })
          .where(eq(tenants.id, input.tenantId));
        await tx.update(subscriptions)
          .set({ plan: input.plan, status: "active", currentPeriodEnds: planExpires, updatedAt: new Date() })
          .where(eq(subscriptions.tenantId, input.tenantId));
      });
      // Заплатившего пускаем сразу, а не через минуту кеша доступа.
      invalidateSubscriptionAccess(input.tenantId);

      return { success: true, planExpiresAt: planExpires };
    }),

  /** Приостановить / активировать */
  setStatus: superAdminQuery
    .input(z.object({
      tenantId: z.number(),
      status:   z.enum(["active", "suspended"]),
    }))
    .mutation(async ({ input }) => {
      await getDb().update(tenants)
        .set({ status: input.status, updatedAt: new Date() })
        .where(eq(tenants.id, input.tenantId));
      // Приостановка действует на следующий же запрос, а не через десять секунд.
      invalidateAuthTenant(input.tenantId);
      return { success: true };
    }),

  /**
   * Руководство дистрибьютора — выдать или забрать у организации.
   *
   * Платная книга, решение владельца платформы по каждой организации; второй
   * путь — команда /manual в Telegram (api/telegram/bot.ts). Оба зовут
   * setManualAccessFor, чтобы журнал и сброс кэша сессии были одни на двоих.
   */
  setManualAccess: superAdminQuery
    .input(z.object({ tenantId: z.number().int().positive(), enabled: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      const r = await setManualAccessFor(input.tenantId, input.enabled, { id: ctx.user.id, name: ctx.user.name });
      if (!r) throw new TRPCError({ code: "NOT_FOUND", message: "Организация не найдена" });
      return r;
    }),

  /** Есть ли у моей организации руководство — по нему меню показывает «Справку». */
  manualAccess: authedQuery.query(({ ctx }) => ({
    available: ctx.user.role === "superadmin" || Boolean(ctx.tenant.manualEnabledAt),
  })),

  /** Что будет стёрто при уходе организации — по таблицам. */
  offboardPreview: superAdminQuery
    .input(z.object({ tenantId: z.number() }))
    .query(async ({ input }) => {
      const db = getDb();
      const [t] = await db.select({ id: tenants.id, name: tenants.name, slug: tenants.slug, status: tenants.status })
        .from(tenants).where(eq(tenants.id, input.tenantId)).limit(1);
      if (!t) throw new TRPCError({ code: "NOT_FOUND", message: "Организация не найдена" });
      const rows = await countTenantRows(db, t.id);
      return { tenant: t, rows, total: Object.values(rows).reduce((a, b) => a + b, 0) };
    }),

  /*
    Уход организации: стереть всё её из базы (services/tenant-offboard.ts).

    Три замка, и все проверяются здесь, а не на экране: организация должна
    быть приостановлена (значит, решение уже принималось однажды), slug
    набран руками, код второго фактора — здесь и сейчас. Сессия
    суперадмина живёт 30 дней; без кода украденной куки хватило бы.
  */
  offboard: superAdminQuery
    .input(z.object({
      tenantId:    z.number(),
      confirmSlug: z.string().min(1),
      totpCode:    z.string().min(1, "Введите код из приложения-аутентификатора"),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const [t] = await db.select({ id: tenants.id, name: tenants.name, slug: tenants.slug, status: tenants.status })
        .from(tenants).where(eq(tenants.id, input.tenantId)).limit(1);
      if (!t) throw new TRPCError({ code: "NOT_FOUND", message: "Организация не найдена" });
      if (t.status !== "suspended") throw new TRPCError({ code: "PRECONDITION_FAILED", message: new TenantNotSuspendedError().message });
      const word = offboardConfirmWord(t);
      if (input.confirmSlug.trim() !== word) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Для подтверждения наберите точно: ${word}` });
      }
      const step = await checkTotpStepUp(db, ctx.user.id, input.totpCode);
      if (!step.ok) {
        throw new TRPCError({ code: step.code === "TOTP_NOT_ENROLLED" ? "FORBIDDEN" : "UNAUTHORIZED", message: step.message });
      }

      let result;
      try {
        result = await offboardTenant(db, t.id);
      } catch (e) {
        if (e instanceof TenantNotSuspendedError) throw new TRPCError({ code: "PRECONDITION_FAILED", message: e.message });
        throw e;
      }
      invalidateAuthTenant(t.id);
      logger.warn("tenant offboarded by superadmin", { tenantId: t.id, slug: t.slug, by: ctx.user.id, total: result.total });
      inBackground(notifyAdmin(tgMessages.tenantOffboarded(t.name, t.slug, ctx.user.name, result.total)));
      return { success: true, ...result };
    }),

  /** Продлить trial */
  extendTrial: superAdminQuery
    .input(z.object({
      tenantId: z.number(),
      days:     z.number().min(1).max(365),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const [tenant] = await db.select({ trialEndsAt: tenants.trialEndsAt })
        .from(tenants).where(eq(tenants.id, input.tenantId)).limit(1);

      const base    = tenant?.trialEndsAt && tenant.trialEndsAt > new Date()
        ? tenant.trialEndsAt
        : new Date();
      const newDate = new Date(base.getTime() + input.days * 86_400_000);

      await db.transaction(async (tx) => {
        await tx.update(tenants)
          .set({ trialEndsAt: newDate, updatedAt: new Date() })
          .where(eq(tenants.id, input.tenantId));
        await tx.update(subscriptions)
          .set({ trialEndsAt: newDate, updatedAt: new Date() })
          .where(eq(subscriptions.tenantId, input.tenantId));
      });

      return { success: true, trialEndsAt: newDate };
    }),

  /** Сбросить пароль владельца */
  resetOwnerPassword: superAdminQuery
    .input(z.object({
      tenantId:    z.number(),
      userId:      z.number(),
      newPassword: z.string().min(8),
    }))
    .mutation(async ({ input, ctx }) => {
      const db           = getDb();
      const passwordHash = await hashPassword(input.newPassword);
      // Сессии по старому паролю гаснут (tokenVersion) — как при смене
      // пароля самим человеком; и след в журнале организации (аудит 20.09.2026).
      await db.update(users)
        .set({ passwordHash, updatedAt: new Date(), tokenVersion: sql`COALESCE(${users.tokenVersion}, 0) + 1` })
        .where(and(eq(users.id, input.userId), eq(users.tenantId, input.tenantId)));
      invalidateAuthUser(input.userId);
      await recordAudit(db, {
        tenantId: input.tenantId, actorId: ctx.user.id, actorName: ctx.user.name,
        action: "user.password_reset_by_admin", targetType: "user", targetId: input.userId,
        meta: { by: "superadmin" },
      });
      return { success: true };
    }),

  /**
   * Сменить логин (почту входа) сотруднику организации — по просьбе клиента.
   *
   * Сам директор может сделать это в «Сотрудниках» → «Передать доступ», но
   * туда ещё надо войти: клиент, потерявший доступ к старой почте, пишет
   * владельцу платформы. Почта уникальна внутри организации; в другой
   * организации тот же адрес допустим — вход спросит, куда. Сессии по старому
   * логину гасятся сразу (tokenVersion), пароль не меняется. Если сменили
   * почту владельца — она же в карточке организации (tenants.ownerEmail).
   */
  changeUserLogin: superAdminQuery
    .input(z.object({
      tenantId: z.number().int().positive(),
      userId:   z.number().int().positive(),
      email:    z.string().trim().toLowerCase().email().max(320),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const [target] = await db.select({ id: users.id, name: users.name, email: users.email, role: users.role })
        .from(users).where(and(eq(users.id, input.userId), eq(users.tenantId, input.tenantId))).limit(1);
      if (!target) throw new TRPCError({ code: "NOT_FOUND", message: "Сотрудник не найден в этой организации" });
      if (target.email === input.email) return { email: input.email, unchanged: true };
      const [taken] = await db.select({ id: users.id })
        .from(users).where(and(eq(users.tenantId, input.tenantId), eq(users.email, input.email))).limit(1);
      if (taken) throw new TRPCError({ code: "CONFLICT", message: "Такая почта уже есть у другого сотрудника этой организации" });

      await db.update(users)
        .set({ email: input.email, tokenVersion: sql`COALESCE(${users.tokenVersion}, 0) + 1`, updatedAt: new Date() })
        .where(and(eq(users.id, input.userId), eq(users.tenantId, input.tenantId)));
      invalidateAuthUser(input.userId);
      const [tenant] = await db.select({ ownerEmail: tenants.ownerEmail }).from(tenants).where(eq(tenants.id, input.tenantId)).limit(1);
      if (tenant?.ownerEmail && tenant.ownerEmail.toLowerCase() === target.email.toLowerCase()) {
        await db.update(tenants).set({ ownerEmail: input.email, updatedAt: new Date() }).where(eq(tenants.id, input.tenantId));
        invalidateAuthTenant(input.tenantId);
      }
      await recordAudit(db, {
        tenantId: input.tenantId, actorId: ctx.user.id, actorName: ctx.user.name,
        action: "user.login_changed", targetType: "user", targetId: input.userId,
        meta: { userName: target.name, oldEmail: target.email, newEmail: input.email, by: "superadmin" },
      });
      return { email: input.email, unchanged: false };
    }),

  /** Общая сводка платформы */
  /*
    Кто чем пользуется — до того, как включать проверку тарифов.

    Тарифы обещают GPS, обмен с 1С, полную аналитику и брендирование платными
    возможностями, а код их не проверяет: разграничены только чат поддержки и
    API. Обещание, за которое берут деньги, должно быть подкреплено — но
    включать проверку вслепую на работающем продукте нельзя: у части
    организаций это отнимет функцию посреди рабочего дня.

    Отчёт показывает, у кого какой тариф и что в ходу, а главное — где
    пользуются тем, чего тариф не даёт. Решение по каждой такой строке за
    владельцем: поднять тариф, оставить как есть или закрыть.
  */
  featureUsage: superAdminQuery.query(async () => {
    const { collectFeatureUsage } = await import("./services/feature-usage");
    return collectFeatureUsage();
  }),

  /*
    Кто платит и кто уходит — панель владельца платформы (services/owner-panel).

    Только чтение и только суперадмину: здесь телефоны владельцев всех
    организаций и деньги платформы. Копия на минуту — страницу обновляют
    кнопкой, и семь агрегатов по всей базе на каждое нажатие незачем.
  */
  ownerPanel: superAdminQuery.query(async () => {
    const { ownerPanel } = await import("./services/owner-panel");
    return ownerPanel(getDb());
  }),

  platformStats: superAdminQuery.query(async () => {
    const db = getDb();

    // Исключаем системный тенант из всей статистики
    const [tenantStat] = await db.select({ total: count(tenants.id) }).from(tenants).where(ne(tenants.slug, "system"));
    const [userStat]   = await db.select({ total: count(users.id) }).from(users)
      .innerJoin(tenants, eq(users.tenantId, tenants.id))
      .where(ne(tenants.slug, "system"));
    const [orderStat]  = await db.select({ total: count(orders.id), revenue: sum(orders.total) }).from(orders);

    const byPlan = await db
      .select({ plan: tenants.plan, cnt: count(tenants.id) })
      .from(tenants).where(ne(tenants.slug, "system")).groupBy(tenants.plan);

    const byStatus = await db
      .select({ status: tenants.status, cnt: count(tenants.id) })
      .from(tenants).where(ne(tenants.slug, "system")).groupBy(tenants.status);

    // Новые тенанты по месяцам (последние 6, без системного)
    const growth = await db.execute(sql`
      SELECT DATE_FORMAT(created_at, '%Y-%m') AS month, COUNT(*) AS cnt
      FROM tenants
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL 6 MONTH)
        AND slug != 'system'
      GROUP BY month ORDER BY month ASC
    `);

    return {
      tenants:  Number(tenantStat?.total ?? 0),
      users:    Number(userStat?.total   ?? 0),
      orders:   Number(orderStat?.total  ?? 0),
      revenue:  Number(orderStat?.revenue ?? 0),
      byPlan:   Object.fromEntries(byPlan.map(r => [r.plan, Number(r.cnt)])),
      byStatus: Object.fromEntries(byStatus.map(r => [r.status, Number(r.cnt)])),
      growth:   rowsOf<{ month: string; cnt: string }>(growth).map(r => ({
        month: r.month, count: Number(r.cnt),
      })),
    };
  }),
});
