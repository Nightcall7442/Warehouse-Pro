import { TRPCError } from "@trpc/server";
import { ProductService } from "../services/ProductService";
import type { TrpcContext } from "../context";
import type { ProductCreateInput, ProductUpdateInput } from "../services/ProductService";

function mapError(err: unknown): never {
  const msg = err instanceof Error ? err.message : "Unknown error";
  throw new TRPCError({ code: "BAD_REQUEST", message: msg });
}

export const ProductController = {
  async list(ctx: TrpcContext, input?: { page?: number; pageSize?: number; search?: string; category?: string }) {
    try {
      return await ProductService.list(ctx.db, ctx.tenant!.id, input);
    } catch (err) {
      mapError(err);
    }
  },

  async getById(ctx: TrpcContext, input: { id: number }) {
    try {
      const product = await ProductService.getById(ctx.db, ctx.tenant!.id, input.id);
      if (!product) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Товар не найден" });
      }
      return product;
    } catch (err) {
      if (err instanceof TRPCError) throw err;
      mapError(err);
    }
  },

  async create(ctx: TrpcContext, input: ProductCreateInput) {
    try {
      return await ProductService.create(ctx.db, ctx.tenant!.id, input);
    } catch (err) {
      mapError(err);
    }
  },

  async update(ctx: TrpcContext, input: { id: number } & ProductUpdateInput) {
    try {
      const { id, ...data } = input;
      return await ProductService.update(ctx.db, ctx.tenant!.id, id, data);
    } catch (err) {
      mapError(err);
    }
  },

  async delete(ctx: TrpcContext, input: { id: number }) {
    try {
      return await ProductService.delete(ctx.db, ctx.tenant!.id, input.id);
    } catch (err) {
      mapError(err);
    }
  },
};
