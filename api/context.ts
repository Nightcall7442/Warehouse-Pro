import type { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
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
  } catch {
    // Public routes (login, signup) don't require auth
  }
  return ctx;
}
