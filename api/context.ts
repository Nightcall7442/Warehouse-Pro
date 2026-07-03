import type { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
import type { User, Tenant } from "@db/schema";
import { authenticateRequest } from "./auth";
import { getDb } from "./queries/connection";

type DrizzleInstance = ReturnType<typeof getDb>;

export type TrpcContext = {
  req:        Request;
  resHeaders: Headers;
  user?:      User;
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
