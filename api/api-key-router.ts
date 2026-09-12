/**
 * API Key management router — CRUD for public REST API keys (Exclusive tier).
 * Only superadmin and ceo can manage API keys.
 */
import { z } from "zod";
import { createRouter, authedQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { apiKeys } from "../db/schema";
import { eq, and, desc } from "drizzle-orm";
import { createHash, randomBytes } from "crypto";
import { TRPCError } from "@trpc/server";
import { exportHealth, recentExports } from "./public/export-log";
import { recordAudit, auditActor } from "./services/audit-log";

const SCOPE_LIST = ["read", "write", "orders", "products", "stock", "shops", "webhooks"] as const;

function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

function generateApiKey(): { raw: string; hash: string; prefix: string } {
  const raw = "wp_live_" + randomBytes(24).toString("hex");
  return { raw, hash: hashKey(raw), prefix: raw.slice(0, 12) };
}

/** Ключи ведёт директор или суперадмин — правило файла с самого начала. */
function assertKeyManager(role: string): void {
  if (role !== "superadmin" && role !== "ceo") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Only CEO or SuperAdmin can manage API keys." });
  }
}

export const apiKeyRouter = createRouter({
  /*
    ── Состояние обмена за сутки ──────────────────────────────────────────

    Отвечает на единственный вопрос, который задают про интеграцию: «она
    работает?». До этого ответить было нечем — ни следа того, что мы отдали,
    ни того, чем ответили, и разговор с интегратором сводился к тому, кто
    увереннее.

    Показываются НАШИ факты: когда последний раз отдали удачно, с какой точки
    возобновления продолжат и что за отказ был последним. Сошлась ли сверка у
    получателя и не задвоил ли он строки — знает только он, и выдавать его
    выводы за свои нельзя.
  */
  exportHealth: authedQuery.query(async ({ ctx }) => {
    assertKeyManager(ctx.user.role);
    return exportHealth(ctx.user.tenantId);
  }),

  /** Последние обращения — список для разбора спора о пропаже. */
  exportLog: authedQuery
    .input(z.object({ limit: z.number().int().min(1).max(200).default(50) }).optional())
    .query(async ({ ctx, input }) => {
      assertKeyManager(ctx.user.role);
      return recentExports(ctx.user.tenantId, input?.limit ?? 50);
    }),

  /** List all API keys for current tenant */
  list: authedQuery.query(async ({ ctx }) => {
    // The three mutations below check this; the list did not, so every
    // authenticated user — agents included — could enumerate the company's
    // integration keys, their scopes and their prefixes. The module header
    // has always said CEO and superadmin only.
    if (ctx.user.role !== "superadmin" && ctx.user.role !== "ceo") {
      throw new TRPCError({ code: "FORBIDDEN", message: "Only CEO or SuperAdmin can manage API keys." });
    }
    const db = getDb();
    const rows = await db.select().from(apiKeys)
      .where(eq(apiKeys.tenantId, ctx.user.tenantId))
      .orderBy(desc(apiKeys.createdAt));
    return rows.map(r => ({ ...r, keyHash: undefined, keyPrefix: r.keyPrefix + "…" }));
  }),

  /** Create a new API key. Returns the raw key ONCE — it cannot be retrieved later. */
  create: authedQuery
    .input(z.object({
      name: z.string().min(1).max(100),
      scopes: z.array(z.enum(SCOPE_LIST)).min(1),
      rateLimit: z.number().min(10).max(10000).default(100),
      expiresInDays: z.number().min(1).max(3650).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "superadmin" && ctx.user.role !== "ceo") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only CEO or SuperAdmin can manage API keys." });
      }
      const db = getDb();
      const { raw, hash, prefix } = generateApiKey();
      const expiresAt = input.expiresInDays
        ? new Date(Date.now() + input.expiresInDays * 86_400_000)
        : null;

      await db.insert(apiKeys).values({
        tenantId: ctx.user.tenantId,
        name: input.name,
        keyHash: hash,
        keyPrefix: prefix,
        scopes: input.scopes.join(","),
        rateLimit: input.rateLimit,
        expiresAt,
      });

      // Ключ — вход в данные организации снаружи; кто и какой завёл — в журнал (сам ключ — нет).
      await recordAudit(db, { ...auditActor(ctx), action: "api_key.created", targetType: "api_key", meta: { name: input.name, prefix, scopes: input.scopes, expiresAt } });

      return { key: raw, prefix, name: input.name, scopes: input.scopes };
    }),

  /** Revoke (delete) an API key */
  revoke: authedQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "superadmin" && ctx.user.role !== "ceo") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only CEO or SuperAdmin can manage API keys." });
      }
      const db = getDb();
      await db.delete(apiKeys).where(
        and(eq(apiKeys.id, input.id), eq(apiKeys.tenantId, ctx.user.tenantId))
      );
      await recordAudit(db, { ...auditActor(ctx), action: "api_key.revoked", targetType: "api_key", targetId: input.id });
      return { ok: true };
    }),

  /** Update API key status (active/suspended) */
  setStatus: authedQuery
    .input(z.object({ id: z.number(), status: z.enum(["active", "inactive"]) }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "superadmin" && ctx.user.role !== "ceo") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only CEO or SuperAdmin can manage API keys." });
      }
      const db = getDb();
      await db.update(apiKeys)
        .set({ status: input.status })
        .where(and(eq(apiKeys.id, input.id), eq(apiKeys.tenantId, ctx.user.tenantId)));
      await recordAudit(db, { ...auditActor(ctx), action: "api_key.status", targetType: "api_key", targetId: input.id, meta: { status: input.status } });
      return { ok: true };
    }),
});
