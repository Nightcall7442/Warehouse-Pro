export function from1CDate(date1C: string | Date): Date {
  const d = typeof date1C === "string" ? new Date(date1C) : date1C;
  return d;
}

export function to1CDate(date: Date): string {
  return date.toISOString().replace("Z", "");
}

export function normalizeMoney(value: string | number): string {
  return Number(value).toFixed(2);
}

export interface Product1C {
  Ref_Key: string;
  Code: string;
  Description: string;
  Price: number;
  Unit: string;
  Category?: string;
}

export function mapProduct1C(item: Product1C) {
  return {
    externalId: item.Ref_Key,
    name: item.Description,
    code: item.Code,
    unitPrice: normalizeMoney(item.Price),
    unit: item.Unit || "шт",
    category: item.Category || null,
  };
}

export interface OrderWP {
  id: number;
  orderNumber: string;
  createdAt: Date;
  shopExternalId: string;
  items: Array<{
    productExternalId: string;
    quantity: number;
    unitPrice: number;
  }>;
}

export function mapOrder1C(order: OrderWP) {
  return {
    Number: order.orderNumber,
    Date: to1CDate(order.createdAt),
    Контрагент_Key: order.shopExternalId,
    Товары: order.items.map((item) => ({
      Номенклатура_Key: item.productExternalId,
      Количество: item.quantity,
      Цена: normalizeMoney(item.unitPrice),
    })),
  };
}

export function sanitizeText(input: string): string {
  return input
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "")
    .normalize("NFC");
}

const UNIT_MAP: Record<string, string> = {
  "шт": "pcs",
  "кг": "kg",
  "л": "l",
  "м": "m",
  "ящ": "box",
  "уп": "pack",
};

export function mapUnit(unit1C: string): "kg" | "l" | "pcs" | "box" | "pack" | "m" {
  const lower = unit1C.toLowerCase().trim();
  return (UNIT_MAP[lower] ?? "pcs") as "kg" | "l" | "pcs" | "box" | "pack" | "m";
}
