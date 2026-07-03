import { TRPCError } from "@trpc/server";
import { UserService } from "../services/UserService";
import type { TrpcContext } from "../context";
import type { UserCreateInput, UserUpdateInput } from "../services/UserService";

function mapError(err: unknown): never {
  const msg = err instanceof Error ? err.message : "Unknown error";
  throw new TRPCError({ code: "BAD_REQUEST", message: msg });
}

export const UserController = {
  async list(ctx: TrpcContext, input?: { page?: number; pageSize?: number; search?: string; role?: string }) {
    try {
      return await UserService.list(ctx.db, ctx.tenant!.id, input);
    } catch (err) {
      mapError(err);
    }
  },

  async getById(ctx: TrpcContext, input: { id: number }) {
    try {
      const user = await UserService.getById(ctx.db, ctx.tenant!.id, input.id);
      if (!user) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Пользователь не найден" });
      }
      return user;
    } catch (err) {
      if (err instanceof TRPCError) throw err;
      mapError(err);
    }
  },

  async create(ctx: TrpcContext, input: UserCreateInput) {
    try {
      return await UserService.create(ctx.db, ctx.tenant!.id, input);
    } catch (err) {
      mapError(err);
    }
  },

  async update(ctx: TrpcContext, input: { id: number } & UserUpdateInput) {
    try {
      const { id, ...data } = input;
      return await UserService.update(ctx.db, ctx.tenant!.id, id, data);
    } catch (err) {
      mapError(err);
    }
  },

  async delete(ctx: TrpcContext, input: { id: number }) {
    try {
      return await UserService.delete(ctx.db, ctx.tenant!.id, input.id);
    } catch (err) {
      mapError(err);
    }
  },

  async changePassword(
    ctx: TrpcContext,
    input: { currentPassword: string; newPassword: string },
  ) {
    try {
      return await UserService.changePassword(
        ctx.db,
        ctx.tenant!.id,
        ctx.user!.id,
        input.currentPassword,
        input.newPassword,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      if (msg.includes("incorrect")) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: msg });
      }
      mapError(err);
    }
  },
};
