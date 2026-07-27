import { z } from "zod";
import { createRouter, publicQuery, authedQuery } from "./middleware";
import { requestPasswordReset, confirmPasswordReset } from "./services/password-reset";
import { checkRateLimit, getClientIp } from "./lib/rate-limit";
import { TRPCError } from "@trpc/server";
import { env } from "./lib/env";

export const authRouter = createRouter({
  /** Return current authenticated user */
  me: authedQuery.query(({ ctx }) => ctx.user),

  /** Request password reset — always returns success to prevent user enumeration */
  requestPasswordReset: publicQuery
    .input(z.object({ email: z.string().email() }))
    .mutation(async ({ input, ctx }) => {
      const ip = getClientIp(ctx.req);
      if (!checkRateLimit(ip, { windowMs: 60_000, limit: 5, namespace: "forgotPassword" })) {
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
      return confirmPasswordReset(ctx.db, input.token, input.newPassword);
    }),
});
