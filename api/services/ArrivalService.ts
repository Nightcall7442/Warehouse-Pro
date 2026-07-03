import { arrivals, arrivalItems, products } from "@db/schema";
import { eq, and, sql, desc } from "drizzle-orm";
import { sanitizeString } from "../lib/sanitize";

type Db = ReturnType<typeof import("../queries/connection").getDb>;

export interface ArrivalListFilters {
  page?: number;
  pageSize?: number;
  status?: "pending" | "unloading" | "completed";
}

export interface ArrivalCreateInput {
  truckId?: string;
  driverName?: string;
  driverPhone?: string;
  arrivalDate: string;
  fuelCost?: string;
  tollCost?: string;
  otherCost?: string;
  notes?: string;
  items?: Array<{ productId: number; quantity: string; condition?: string }>;
}

export interface ArrivalUpdateInput {
  truckId?: string;
  driverName?: string;
  driverPhone?: string;
  status?: "pending" | "unloading" | "completed";
  fuelCost?: string;
  tollCost?: string;
  otherCost?: string;
  notes?: string;
}

export const ArrivalService = {
  async list(db: Db, tenantId: number, filters?: ArrivalListFilters) {
    const page = filters?.page ?? 1;
    const pageSize = filters?.pageSize ?? 25;
    const offset = (page - 1) * pageSize;

    const conditions = [eq(arrivals.tenantId, tenantId)];
    if (filters?.status) conditions.push(eq(arrivals.status, filters.status));
    const where = and(...conditions);

    const [data, countResult] = await Promise.all([
      db.select({
        id: arrivals.id, arrivalNumber: arrivals.arrivalNumber, truckId: arrivals.truckId,
        driverName: arrivals.driverName, status: arrivals.status,
        totalExpense: arrivals.totalExpense, arrivalDate: arrivals.arrivalDate,
        arrivalTime: arrivals.arrivalTime, createdAt: arrivals.createdAt,
      }).from(arrivals).where(where).limit(pageSize).offset(offset).orderBy(desc(arrivals.createdAt)),
      db.select({ count: sql<number>`count(*)` }).from(arrivals).where(where),
    ]);

    return { data, total: Number(countResult[0]?.count ?? 0), page, pageSize };
  },

  async getById(db: Db, tenantId: number, arrivalId: number) {
    const [arrival] = await db.select({
      id: arrivals.id, arrivalNumber: arrivals.arrivalNumber, truckId: arrivals.truckId,
      driverName: arrivals.driverName, driverPhone: arrivals.driverPhone, status: arrivals.status,
      fuelCost: arrivals.fuelCost, tollCost: arrivals.tollCost, otherCost: arrivals.otherCost,
      totalExpense: arrivals.totalExpense, arrivalDate: arrivals.arrivalDate,
      arrivalTime: arrivals.arrivalTime, unloadingTime: arrivals.unloadingTime,
      notes: arrivals.notes, createdAt: arrivals.createdAt,
    }).from(arrivals)
      .where(and(eq(arrivals.id, arrivalId), eq(arrivals.tenantId, tenantId))).limit(1);
    if (!arrival) return null;

    const items = await db.select({
      id: arrivalItems.id, quantity: arrivalItems.quantity,
      condition: arrivalItems.condition, notes: arrivalItems.notes,
      productId: arrivalItems.productId,
      productName: products.name, productCode: products.code,
    })
      .from(arrivalItems)
      .leftJoin(products, eq(arrivalItems.productId, products.id))
      .where(eq(arrivalItems.arrivalId, arrival.id));

    return { ...arrival, items };
  },

  async create(db: Db, tenantId: number, data: ArrivalCreateInput) {
    const raw = crypto.randomUUID().replace(/-/g, "");
    const arrivalNumber = `ARR-${raw.slice(0, 12).toUpperCase()}`;
    const totalExpense = (Number(data.fuelCost ?? "0") + Number(data.tollCost ?? "0") + Number(data.otherCost ?? "0")).toFixed(2);

    const [result] = await db.insert(arrivals).values({
      tenantId, arrivalNumber,
      truckId: data.truckId ? sanitizeString(data.truckId) : undefined,
      driverName: data.driverName ? sanitizeString(data.driverName) : undefined,
      driverPhone: data.driverPhone,
      arrivalDate: new Date(data.arrivalDate),
      fuelCost: data.fuelCost ?? "0.00",
      tollCost: data.tollCost ?? "0.00",
      otherCost: data.otherCost ?? "0.00",
      totalExpense,
      notes: data.notes ? sanitizeString(data.notes) : undefined,
      status: "pending",
    });

    const arrivalId = Number(result.insertId);

    if (data.items && data.items.length > 0) {
      await db.insert(arrivalItems).values(data.items.map(item => ({
        arrivalId,
        productId: item.productId,
        quantity: item.quantity,
        condition: item.condition ? sanitizeString(item.condition) : undefined,
      })));
    }

    return { id: arrivalId, arrivalNumber };
  },

  async update(db: Db, tenantId: number, arrivalId: number, data: ArrivalUpdateInput) {
    const { ...updateData } = data;

    if (data.fuelCost || data.tollCost || data.otherCost) {
      const [existing] = await db.select().from(arrivals)
        .where(and(eq(arrivals.id, arrivalId), eq(arrivals.tenantId, tenantId))).limit(1);
      if (existing) {
        const fuel = Number(data.fuelCost ?? existing.fuelCost);
        const toll = Number(data.tollCost ?? existing.tollCost);
        const other = Number(data.otherCost ?? existing.otherCost);
        await db.update(arrivals).set({ ...updateData, totalExpense: (fuel + toll + other).toFixed(2) })
          .where(and(eq(arrivals.id, arrivalId), eq(arrivals.tenantId, tenantId)));
        return { success: true };
      }
    }

    await db.update(arrivals).set(updateData)
      .where(and(eq(arrivals.id, arrivalId), eq(arrivals.tenantId, tenantId)));
    return { success: true };
  },

  async delete(db: Db, tenantId: number, arrivalId: number) {
    const [existing] = await db.select().from(arrivals)
      .where(and(eq(arrivals.id, arrivalId), eq(arrivals.tenantId, tenantId))).limit(1);
    if (!existing) throw new Error("Приход не найден");

    await db.delete(arrivalItems).where(eq(arrivalItems.arrivalId, arrivalId));
    await db.delete(arrivals).where(and(eq(arrivals.id, arrivalId), eq(arrivals.tenantId, tenantId)));
    return { success: true };
  },
};
