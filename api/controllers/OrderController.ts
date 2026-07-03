import { TRPCError } from "@trpc/server";
import { OrderService } from "../services/order";
import type { TrpcContext } from "../context";

function mapError(err: unknown): never {
  const msg = err instanceof Error ? err.message : "Unknown error";
  throw new TRPCError({ code: "BAD_REQUEST", message: msg });
}

export const OrderController = {
  async list(
    ctx: TrpcContext,
    input?: { status?: string; agentId?: number; page?: number; pageSize?: number; search?: string },
  ) {
    try {
      return await OrderService.list(ctx.db, ctx.tenant!.id, input ?? {}, {
        userId: ctx.user!.id,
        userRole: ctx.user!.role as string,
      });
    } catch (err) {
      mapError(err);
    }
  },

  async getById(ctx: TrpcContext, input: { id: number }) {
    try {
      const order = await OrderService.getById(ctx.db, ctx.tenant!.id, input.id, {
        userId: ctx.user!.id,
        userRole: ctx.user!.role as string,
      });
      if (!order) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Заказ не найден" });
      }
      return order;
    } catch (err) {
      if (err instanceof TRPCError) throw err;
      mapError(err);
    }
  },

  async create(
    ctx: TrpcContext,
    input: { shopId: number; items: Array<{ productId: number; quantity: string; unitPrice: string }>; notes?: string; discount?: string },
  ) {
    try {
      return await OrderService.create(ctx.db, ctx.tenant!.id, ctx.user!.id, input);
    } catch (err) {
      mapError(err);
    }
  },

  async cancel(ctx: TrpcContext, input: { id: number }) {
    try {
      return await OrderService.cancel(ctx.db, ctx.tenant!.id, input.id, {
        userId: ctx.user!.id,
        userRole: ctx.user!.role as string,
      });
    } catch (err) {
      mapError(err);
    }
  },

  async updateStatus(
    ctx: TrpcContext,
    input: { id: number; status: "new" | "processing" | "completed" | "cancelled" },
  ) {
    try {
      return await OrderService.updateStatus(ctx.db, ctx.tenant!.id, input.id, input.status);
    } catch (err) {
      mapError(err);
    }
  },
};
