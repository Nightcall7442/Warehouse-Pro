import { z } from "zod";
import { randomUUID, randomBytes, createHash } from "crypto";
import { TRPCError } from "@trpc/server";
import { recordAudit } from "./services/audit-log";
import { createRouter, publicQuery, adminQuery, superAdminQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { tenants, users, settings, orders, products, shops, subscriptions, warehouses, apiKeys } from "@db/schema";
import { eq, and, ne, sql, count, sum } from "drizzle-orm";
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
  return { slug, message: "Organisation created. You can now sign in." };
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

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export const tenantRouter = createRouter({
  // ── Публичная регистрация ──────────────────────────────────────────────────
  register: publicQuery
    .input(z.object({
      orgName:  z.string().min(2).max(100),
      name:     z.string().min(2).max(100),
      email:    z.string().email(),
      password: z.string().min(8),
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

      await db.transaction(async (tx) => {
        const [tenantResult] = await tx.insert(tenants).values({
          slug, name: input.orgName, plan: "trial", status: "active",
          trialEndsAt: trialEnds,
        });
        const tenantId = Number(tenantResult.insertId);
        await tx.insert(users).values({
          tenantId, name: input.name, email: input.email,
          passwordHash, role: "ceo", status: "active", lastSignInAt: new Date(),
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
      });

      // Суперадмину — сразу, а не в вечерней сводке: новую организацию
      // встречают в первый день, потом она либо работает, либо ушла.
      void notifyAdmin(tgMessages.newRegistration(input.orgName, input.email));

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
      const existing = await db.select({ id: users.id }).from(users)
        .where(eq(users.email, input.email)).limit(1);
      if (existing.length) throw new TRPCError({ code: "CONFLICT", message: "Email already registered." });

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

  /** Список всех тенантов с основной статистикой */
  list: superAdminQuery.query(async () => {
    const db = getDb();

    const allTenants = await listTenants();

    // Статистика: кол-во юзеров и заказов на тенант одним запросом
    const userCounts = await db
      .select({ tenantId: users.tenantId, cnt: count(users.id) })
      .from(users)
      .groupBy(users.tenantId);

    const orderStats = await db
      .select({
        tenantId: orders.tenantId,
        cnt:      count(orders.id),
        total:    sum(orders.total),
      })
      .from(orders)
      .groupBy(orders.tenantId);

    const userMap  = Object.fromEntries(userCounts.map(r  => [r.tenantId,  r.cnt]));
    const orderMap = Object.fromEntries(orderStats.map(r => [r.tenantId, { cnt: r.cnt, total: r.total ?? "0" }]));

    return allTenants.map(t => ({
      ...t,
      userCount:  Number(userMap[t.id]  ?? 0),
      orderCount: Number(orderMap[t.id]?.cnt   ?? 0),
      orderTotal: Number(orderMap[t.id]?.total ?? 0),
    }));
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
      const trialEndsAt   = new Date(Date.now() + input.trialDays * 86_400_000);
      const planExpiresAt = input.plan !== "trial"
        ? new Date(Date.now() + 30 * 86_400_000)
        : null;

      let tenantId: number;
      await db.transaction(async (tx) => {
        const [r] = await tx.insert(tenants).values({
          slug, name: input.orgName, plan: input.plan,
          status: "active", trialEndsAt, planExpiresAt: planExpiresAt ?? undefined,
          ownerEmail: input.ownerEmail,
        });
        tenantId = Number(r.insertId);

        await tx.insert(users).values({
          tenantId, name: input.ownerName, email: input.ownerEmail,
          passwordHash, role: "ceo", status: "active", lastSignInAt: new Date(),
        });
        await tx.insert(settings).values({ tenantId, companyName: input.orgName });
      });

      // Create trial subscription for admin-created tenant
      const subTrialEnds = new Date(Date.now() + 14 * 86_400_000);
      await db.insert(subscriptions).values({
        id: randomUUID(),
        tenantId: tenantId!,
        plan: "trial",
        status: "trialing",
        trialEndsAt: subTrialEnds,
        currentPeriodEnds: subTrialEnds,
      }).catch((err) => {
        logger.error("Failed to create trial subscription for admin-created tenant", { tenantId: tenantId!, error: err instanceof Error ? err.message : String(err) });
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
      const db          = getDb();
      const planExpires = new Date(Date.now() + input.expiryDays * 86_400_000);

      await db.transaction(async (tx) => {
        await tx.update(tenants)
          .set({ plan: input.plan, planExpiresAt: planExpires, updatedAt: new Date() })
          .where(eq(tenants.id, input.tenantId));
        await tx.update(subscriptions)
          .set({ plan: input.plan, status: "active", currentPeriodEnds: planExpires, updatedAt: new Date() })
          .where(eq(subscriptions.tenantId, input.tenantId));
      });

      return { success: true };
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
      return { success: true };
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
    .mutation(async ({ input }) => {
      const db           = getDb();
      const passwordHash = await hashPassword(input.newPassword);
      await db.update(users)
        .set({ passwordHash, updatedAt: new Date() })
        .where(and(eq(users.id, input.userId), eq(users.tenantId, input.tenantId)));
      return { success: true };
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
