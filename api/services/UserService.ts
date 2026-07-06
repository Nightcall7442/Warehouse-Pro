import { users } from "@db/schema";
import { eq, like, and, sql, desc } from "drizzle-orm";
import { hashPassword, verifyPassword } from "../auth/password";
import { sanitizeString, sanitizeSearch } from "../lib/sanitize";
import { cache, CacheKeys, CacheTTL } from "../lib/cache";
import type { Role } from "@contracts/types";

type DrizzleInstance = ReturnType<typeof import("../queries/connection").getDb>;

export interface UserListFilters {
  page?: number;
  pageSize?: number;
  search?: string;
  role?: Role;
}

export interface UserCreateInput {
  name: string;
  email: string;
  password: string;
  phone?: string;
  role?: "ceo" | "operator" | "agent" | "supervisor" | "merchandiser" | "courier";
}

export interface UserUpdateInput {
  name?: string;
  phone?: string;
  role?: "ceo" | "operator" | "agent" | "supervisor" | "merchandiser" | "courier";
  status?: "active" | "inactive";
}

export const UserService = {
  async list(db: DrizzleInstance, tenantId: number, filters?: UserListFilters) {
    const page = filters?.page ?? 1;
    const pageSize = filters?.pageSize ?? 25;
    const offset = (page - 1) * pageSize;

    const cacheKey = CacheKeys.userList(tenantId, page, filters?.search, filters?.role);
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    const conditions = [eq(users.tenantId, tenantId)];
    if (filters?.search) conditions.push(like(users.name, `%${sanitizeSearch(filters.search)}%`));
    if (filters?.role) conditions.push(eq(users.role, filters.role));
    const where = and(...conditions);

    const [data, countResult] = await Promise.all([
      db.select({
        id: users.id,
        name: users.name,
        email: users.email,
        phone: users.phone,
        avatar: users.avatar,
        role: users.role,
        status: users.status,
        createdAt: users.createdAt,
        lastSignInAt: users.lastSignInAt,
      })
        .from(users)
        .where(where)
        .limit(pageSize)
        .offset(offset)
        .orderBy(desc(users.createdAt)),
      db.select({ count: sql<number>`count(*)` }).from(users).where(where),
    ]);

    const result = { data, total: Number(countResult[0]?.count ?? 0), page, pageSize };
    cache.set(cacheKey, result, CacheTTL.users);
    return result;
  },

  async getById(db: DrizzleInstance, tenantId: number, userId: number) {
    const cacheKey = CacheKeys.userDetail(tenantId, userId);
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    const [user] = await db.select({
      id: users.id,
      name: users.name,
      email: users.email,
      phone: users.phone,
      role: users.role,
      status: users.status,
      createdAt: users.createdAt,
      lastSignInAt: users.lastSignInAt,
      avatar: users.avatar,
      tenantId: users.tenantId,
    })
      .from(users)
      .where(and(eq(users.id, userId), eq(users.tenantId, tenantId)))
      .limit(1);

    const result = user ?? null;
    if (result) {
      cache.set(cacheKey, result, CacheTTL.users);
    }
    return result;
  },

  async create(db: DrizzleInstance, tenantId: number, data: UserCreateInput) {
    const sanitized = {
      ...data,
      name: sanitizeString(data.name),
      email: data.email.toLowerCase().trim(),
    };

    const passwordHash = await hashPassword(data.password);
    const [result] = await db.insert(users).values({
      tenantId,
      ...sanitized,
      passwordHash,
      role: data.role ?? "agent",
      status: "active",
    });

    cache.invalidatePrefix(`users:${tenantId}`);
    return { id: Number(result.insertId) };
  },

  async update(db: DrizzleInstance, tenantId: number, userId: number, data: UserUpdateInput) {
    const sanitized: Record<string, unknown> = { ...data };
    if (typeof data.name === "string") sanitized.name = sanitizeString(data.name);

    await db.update(users).set(sanitized)
      .where(and(eq(users.id, userId), eq(users.tenantId, tenantId)));

    cache.invalidatePrefix(`users:${tenantId}`);
    return { success: true };
  },

  async delete(db: DrizzleInstance, tenantId: number, userId: number) {
    await db.update(users).set({ status: "inactive" })
      .where(and(eq(users.id, userId), eq(users.tenantId, tenantId)));

    cache.invalidatePrefix(`users:${tenantId}`);
    return { success: true };
  },

  async changePassword(
    db: DrizzleInstance,
    tenantId: number,
    userId: number,
    currentPassword: string,
    newPassword: string
  ) {
    const [user] = await db.select({
      id: users.id,
      passwordHash: users.passwordHash,
    })
      .from(users)
      .where(and(eq(users.id, userId), eq(users.tenantId, tenantId)))
      .limit(1);

    if (!user) throw new Error("User not found");

    const valid = await verifyPassword(currentPassword, user.passwordHash);
    if (!valid) throw new Error("Current password is incorrect");

    const newHash = await hashPassword(newPassword);
    await db.update(users).set({ passwordHash: newHash })
      .where(and(eq(users.id, userId), eq(users.tenantId, tenantId)));

    return { success: true };
  },

  async resetPassword(db: DrizzleInstance, tenantId: number, userId: number, newPassword: string) {
    const newHash = await hashPassword(newPassword);
    await db.update(users).set({ passwordHash: newHash })
      .where(and(eq(users.id, userId), eq(users.tenantId, tenantId)));

    return { success: true };
  },
};
