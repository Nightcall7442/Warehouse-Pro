import { TRPCError } from "@trpc/server";
import { ShopService } from "../services/ShopService";
import type { TrpcContext } from "../context";
import type { ShopCreateInput, ShopUpdateInput } from "../services/ShopService";

function mapError(err: unknown): never {
  const msg = err instanceof Error ? err.message : "Unknown error";
  throw new TRPCError({ code: "BAD_REQUEST", message: msg });
}

export const ShopController = {
  async list(ctx: TrpcContext, input?: { page?: number; pageSize?: number; search?: string; city?: string; district?: string; agentId?: number }) {
    try {
      return await ShopService.list(ctx.db, ctx.tenant!.id, input);
    } catch (err) {
      mapError(err);
    }
  },

  async getById(ctx: TrpcContext, input: { id: number }) {
    try {
      const shop = await ShopService.getById(ctx.db, ctx.tenant!.id, input.id);
      if (!shop) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Магазин не найден" });
      }
      return shop;
    } catch (err) {
      if (err instanceof TRPCError) throw err;
      mapError(err);
    }
  },

  async create(ctx: TrpcContext, input: ShopCreateInput) {
    try {
      return await ShopService.create(ctx.db, ctx.tenant!.id, input);
    } catch (err) {
      mapError(err);
    }
  },

  async update(ctx: TrpcContext, input: { id: number } & ShopUpdateInput) {
    try {
      const { id, ...data } = input;
      return await ShopService.update(ctx.db, ctx.tenant!.id, id, data);
    } catch (err) {
      mapError(err);
    }
  },

  async delete(ctx: TrpcContext, input: { id: number }) {
    try {
      return await ShopService.delete(ctx.db, ctx.tenant!.id, input.id);
    } catch (err) {
      mapError(err);
    }
  },
};
