import { TRPCError } from "@trpc/server";
import { DashboardService } from "../services/DashboardService";
import type { TrpcContext } from "../context";

function mapError(err: unknown): never {
  const msg = err instanceof Error ? err.message : "Unknown error";
  throw new TRPCError({ code: "BAD_REQUEST", message: msg });
}

export const DashboardController = {
  async getOverview(ctx: TrpcContext) {
    try {
      return await DashboardService.getOverview(ctx.db, ctx.tenant!.id);
    } catch (err) {
      mapError(err);
    }
  },

  async getRevenueTrend(ctx: TrpcContext, input?: { days?: number }) {
    try {
      return await DashboardService.getRevenueTrend(ctx.db, ctx.tenant!.id, input?.days);
    } catch (err) {
      mapError(err);
    }
  },

  async getOrderTrend(ctx: TrpcContext, input?: { days?: number }) {
    try {
      return await DashboardService.getOrderTrend(ctx.db, ctx.tenant!.id, input?.days);
    } catch (err) {
      mapError(err);
    }
  },
};
