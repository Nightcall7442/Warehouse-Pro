/**
 * API Key management router — CRUD for public REST API keys (Exclusive tier).
 * Only superadmin and ceo can manage API keys.
 */
import { z } from "zod";
import { createRouter, authedQuery } from "./middleware";
import { apiKeys } from "../db/schema";
import { eq, and, desc } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { generateApiKey } from "./lib/api-key";

const SCOPE_LIST = ["read", "write", "orders", "products", "stock", "shops", "webhooks"] as const;

export const apiKeyRouter = createRouter({
  /** List all API keys for current tenant */
  list: authedQuery.query(async ({ ctx }) => {
    const db = ctx.db;
    const rows = await db.select().from(apiKeys)
      .where(eq(apiKeys.tenantId, ctx.user.tenantId))
      .orderBy(desc(apiKeys.createdAt));
    // Never expose either hash: the lookup hash is enough to impersonate a key
    // against the DB, and the Argon2 hash is offline-crackable material.
    return rows.map(r => ({
      ...r,
      keyHash: undefined,
      keySecretHash: undefined,
      keyPrefix: r.keyPrefix + "…",
    }));
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
      const db = ctx.db;
      const { raw, lookupHash, secretHash, prefix } = await generateApiKey();
      const expiresAt = input.expiresInDays
        ? new Date(Date.now() + input.expiresInDays * 86_400_000)
        : null;

      await db.insert(apiKeys).values({
        tenantId: ctx.user.tenantId,
        name: input.name,
        keyHash: lookupHash,
        keySecretHash: secretHash,
        keyPrefix: prefix,
        scopes: input.scopes.join(","),
        rateLimit: input.rateLimit,
        expiresAt,
      });

      return { key: raw, prefix, name: input.name, scopes: input.scopes };
    }),

  /** Revoke (delete) an API key */
  revoke: authedQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "superadmin" && ctx.user.role !== "ceo") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only CEO or SuperAdmin can manage API keys." });
      }
      const db = ctx.db;
      await db.delete(apiKeys).where(
        and(eq(apiKeys.id, input.id), eq(apiKeys.tenantId, ctx.user.tenantId))
      );
      return { ok: true };
    }),

  /** Update API key status (active/suspended) */
  setStatus: authedQuery
    .input(z.object({ id: z.number(), status: z.enum(["active", "inactive"]) }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "superadmin" && ctx.user.role !== "ceo") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only CEO or SuperAdmin can manage API keys." });
      }
      const db = ctx.db;
      await db.update(apiKeys)
        .set({ status: input.status })
        .where(and(eq(apiKeys.id, input.id), eq(apiKeys.tenantId, ctx.user.tenantId)));
      return { ok: true };
    }),
});
