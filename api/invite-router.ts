import { z } from "zod";
import { randomBytes } from "crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createRouter, adminQuery, publicQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { invites, users, tenants } from "@db/schema";
import { hashPassword } from "./auth/password";
import { sendInviteEmail } from "./lib/mailer";
import { env } from "./lib/env";
import { logger } from "./lib/logger";
import { INVITE_EXPIRY_MS } from "./lib/constants";

export const inviteRouter = createRouter({
  /** CEO sends an invitation email */
  send: adminQuery
    .input(z.object({
      email: z.string().email(),
      role:  z.enum(["ceo", "operator", "agent", "supervisor", "merchandiser", "courier"]),
    }))
    .mutation(async ({ input, ctx }) => {
      const db       = getDb();
      const tenantId = ctx.tenant.id;

      // Check not already a user
      const [exists] = await db.select().from(users)
        .where(eq(users.email, input.email)).limit(1);
      if (exists) {
        throw new TRPCError({ code: "CONFLICT", message: "Email уже зарегистрирован." });
      }

      const token     = randomBytes(32).toString("hex");
      const expiresAt = new Date(Date.now() + INVITE_EXPIRY_MS);

      await db.insert(invites).values({
        id:        randomBytes(16).toString("hex"),
        tenantId,
        email:     input.email,
        role:      input.role,
        token,
        expiresAt,
        createdBy: ctx.user.id,
      });

      const acceptUrl = `${env.appUrl}/invite/${token}`;

      // Send non-blocking
      sendInviteEmail(
        input.email,
        ctx.user.name,
        ctx.tenant.name,
        input.role,
        acceptUrl,
      ).catch((err) => logger.error("invite email send failed", { error: err instanceof Error ? err.message : String(err) }));

      return { success: true, acceptUrl };
    }),

  /** Verify invite token (called on /invite/:token page load) */
  verify: publicQuery
    .input(z.object({ token: z.string() }))
    .query(async ({ input }) => {
      const db  = getDb();
      const now = new Date();

      const [invite] = await db.select({
        id:         invites.id,
        email:      invites.email,
        role:       invites.role,
        expiresAt:  invites.expiresAt,
        acceptedAt: invites.acceptedAt,
        tenantId:   invites.tenantId,
      })
        .from(invites)
        .where(and(eq(invites.token, input.token), gt(invites.expiresAt, now)))
        .limit(1);

      if (!invite) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Приглашение недействительно или истекло." });
      }
      if (invite.acceptedAt) {
        throw new TRPCError({ code: "CONFLICT", message: "Приглашение уже принято." });
      }

      const [tenant] = await db.select({ name: tenants.name })
        .from(tenants).where(eq(tenants.id, invite.tenantId)).limit(1);

      return { email: invite.email, role: invite.role, orgName: tenant?.name ?? "" };
    }),

  /** Accept invite — creates user + marks invite as accepted */
  accept: publicQuery
    .input(z.object({
      token:    z.string(),
      name:     z.string().min(2),
      password: z.string().min(8),
    }))
    .mutation(async ({ input }) => {
      const db  = getDb();
      const now = new Date();

      const [invite] = await db.select()
        .from(invites)
        .where(and(eq(invites.token, input.token), gt(invites.expiresAt, now), isNull(invites.acceptedAt)))
        .limit(1);

      if (!invite) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Приглашение недействительно или истекло." });
      }

      const passwordHash = await hashPassword(input.password);

      await db.transaction(async (tx) => {
        await tx.insert(users).values({
          tenantId:     invite.tenantId,
          name:         input.name,
          email:        invite.email,
          passwordHash,
          role:         invite.role,
          status:       "active",
          lastSignInAt: new Date(),
        });

        await tx.update(invites)
          .set({ acceptedAt: now })
          .where(eq(invites.token, input.token));
      });

      return { success: true };
    }),

  /** List pending invites for tenant */
  list: adminQuery.query(async ({ ctx }) => {
    const db = getDb();
    return db.select({
      id:        invites.id,
      email:     invites.email,
      role:      invites.role,
      expiresAt: invites.expiresAt,
      acceptedAt:invites.acceptedAt,
      createdAt: invites.createdAt,
    })
      .from(invites)
      .where(eq(invites.tenantId, ctx.tenant.id))
      .orderBy(invites.createdAt);
  }),
});
