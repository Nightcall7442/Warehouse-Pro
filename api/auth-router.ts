import { z } from "zod";
import { createRouter, publicQuery, authedQuery } from "./middleware";
import { requestPasswordReset, confirmPasswordReset } from "./services/password-reset";
import { checkRateLimit, rateLimitSubject } from "./lib/rate-limit";
import { TRPCError } from "@trpc/server";
import { env } from "./lib/env";

export const authRouter = createRouter({
  /** Return current authenticated user */
  me: authedQuery.query(({ ctx }) => ctx.user),

  /** Request password reset — always returns success to prevent user enumeration */
  requestPasswordReset: publicQuery
    .input(z.object({ email: z.string().email() }))
    .mutation(async ({ input, ctx }) => {
      // Per email address: the point is to stop one mailbox being flooded, and
      // the address is the only thing here the server can actually identify.
      const subject = rateLimitSubject(ctx.req, `email:${input.email.trim().toLowerCase()}`);
      if (!(await checkRateLimit(subject, { windowMs: 60_000, limit: 5, namespace: "forgotPassword" }))) {
        throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Слишком много запросов. Попробуйте позже." });
      }

      // Use configured app URL to prevent host header injection
      const appUrl = env.appUrl ?? "http://localhost:3000";

      await requestPasswordReset(ctx.db, input.email, appUrl);
      return { success: true };
    }),

  /** Confirm password reset with token */
  confirmPasswordReset: publicQuery
    .input(z.object({
      token:       z.string().min(64).max(64),
      newPassword: z.string().min(8, "Пароль должен быть не менее 8 символов"),
    }))
    .mutation(async ({ input, ctx }) => {
      // P0-11 FIX: Rate limit password reset confirmation
      // Per reset token: guessing a 64-char token is what this limit defends
      // against, and each guess names the token it is guessing.
      const subject = rateLimitSubject(ctx.req, `token:${input.token.slice(0, 16)}`);
      if (!(await checkRateLimit(subject, { windowMs: 15 * 60_000, limit: 5, namespace: "confirmReset" }))) {
        throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Слишком много запросов. Попробуйте позже." });
      }
      return confirmPasswordReset(ctx.db, input.token, input.newPassword);
    }),
});
